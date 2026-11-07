import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentKind, Subscription } from "@estela/shared";
import { money } from "@estela/shared";

import { undeliveredSpend, type BranchFacts, type CommitFact, type UndeliveredInput,
         type UndeliveredTurn } from "./undelivered.js";

/**
 * Gasto sin entrega. Datos inventados: el repo /r y sus ramas no existen.
 * Lo que no puede pasar: contar dos veces el mismo dinero, o llamar "sin
 * entrega" a algo que no se puede saber.
 */

const NOW = new Date("2026-11-06T12:00:00Z");
const DAY = 86_400_000;
const at = (daysAgo: number, minute = 0) => new Date(NOW.getTime() - daysAgo * DAY + minute * 60_000);

/** `n` turnos de un minuto, a 1 $ cada uno. */
function sesion(id: string, start: Date, n: number, branch: string | null, agent: AgentKind = "claude-code"): UndeliveredTurn[] {
  return Array.from({ length: n }, (_, i) => ({
    projectId: "web", sessionId: id, at: new Date(start.getTime() + i * 60_000), root: "/r",
    branch, microUsd: agent === "copilot" ? 0 : 1_000_000, agent,
  }));
}
const commit = (when: Date, branch: string | null = "main", root = "/r"): CommitFact => ({ root, at: when, branch });

function input(turns: UndeliveredTurn[], commits: CommitFact[], over: Partial<UndeliveredInput> = {},
               facts: Record<string, BranchFacts> = {}): UndeliveredInput {
  return {
    turns, commits, staleDays: 14, now: NOW, subscriptions: [], monthTotals: new Map(),
    branchFacts: (_root, branch) => facts[branch] ?? { merged: false, exists: true },
    ...over,
  };
}
const usd = (s: { consumption: { microUsd: number } }) => s.consumption.microUsd / 1e6;

// Un commit viejo para que haya "primer commit" y las sesiones se puedan juzgar.
const PRIMERO = commit(at(200));

test("una sesión con commit durante ella, o en los 30 min siguientes, entrega; la otra no", () => {
  const [r] = undeliveredSpend(input([
    ...sesion("con", at(30), 10, "main"),
    ...sesion("justo-despues", at(29), 10, "main"),
    ...sesion("sin", at(28), 10, "main"),
  ], [PRIMERO, commit(at(30, 5)), commit(at(29, 9 + 25))]));
  assert.equal(r!.sessionsWithoutCommit.count, 1);
  assert.equal(usd(r!.sessionsWithoutCommit), 10);
  assert.equal(usd(r!.total), 30);
});

test("un commit de otro repo no cuenta como entrega de esta sesión", () => {
  const [r] = undeliveredSpend(input(sesion("s", at(20), 5, "main"), [PRIMERO, commit(at(20, 2), "main", "/otro")]));
  assert.equal(r!.sessionsWithoutCommit.count, 1);
});

test("se separan las sesiones sin commit que luego sí lo tuvieron en su rama (dentro de N días)", () => {
  const [r] = undeliveredSpend(input([
    ...sesion("itera", at(40), 10, "feat/a"),
    ...sesion("tarde", at(39), 10, "feat/b"),
  ], [PRIMERO, commit(at(38), "feat/a"), commit(at(20), "feat/b")], {},
  { "feat/a": { merged: true, exists: false }, "feat/b": { merged: true, exists: false } }));
  assert.equal(r!.sessionsWithoutCommit.count, 2);
  assert.equal(r!.sessionsWithoutCommit.laterCommitted.count, 1, "feat/b tuvo su commit 19 días después: fuera de plazo");
});

test("antes del primer commit tuyo en el repo no se juzga: puede que commitearas con otro correo", () => {
  const [r] = undeliveredSpend(input([
    ...sesion("antes", at(60), 10, "main"),
    ...sesion("despues", at(30), 5, "main"),
  ], [commit(at(50))]));
  assert.equal(r!.unverifiable.count, 1);
  assert.equal(usd(r!.unverifiable), 10);
  assert.equal(r!.sessionsWithoutCommit.count, 1);
  assert.equal(usd(r!.undelivered), 5, "lo que no se puede juzgar no suma");

  const [nada] = undeliveredSpend(input(sesion("s", at(30), 5, "main"), []));
  assert.equal(nada!.unverifiable.count, 1, "un repo sin ningún commit tuyo: nada se puede juzgar");
  assert.equal(usd(nada!.undelivered), 0);
});

test("ramas: sin fusionar tras N días cuenta; abierta, borrada sin merge, fusionada o principal no", () => {
  const conCommit = (id: string, daysAgo: number, branch: string) =>
    ({ turns: sesion(id, at(daysAgo), 4, branch), commit: commit(at(daysAgo, 2), branch) });
  const casos = [conCommit("v", 30, "feat/vieja"), conCommit("n", 3, "feat/nueva"), conCommit("b", 40, "feat/borrada"),
                 conCommit("f", 40, "feat/fusionada"), conCommit("m", 40, "main")];
  const [r] = undeliveredSpend(input(casos.flatMap((c) => c.turns), [PRIMERO, ...casos.map((c) => c.commit)], {}, {
    "feat/vieja": { merged: false, exists: true },
    "feat/nueva": { merged: false, exists: true },
    "feat/borrada": { merged: false, exists: false },
    "feat/fusionada": { merged: true, exists: false },
  }));
  assert.deepEqual(r!.unmerged.branches.map((b) => [b.branch, b.idleDays]), [["feat/vieja", 29]]);
  assert.equal(usd(r!.unmerged), 4);
  assert.deepEqual(r!.notCounted.map((b) => [b.branch, b.state]).sort(),
    [["feat/borrada", "unknown"], ["feat/nueva", "open"]]);
  assert.equal(usd(r!.undelivered), 4);
});

test("un repo que ya no se puede leer deja sus ramas en desconocido", () => {
  const [r] = undeliveredSpend(input(sesion("s", at(30), 3, "feat/x"), [PRIMERO, commit(at(30, 1), "feat/x")], {},
    { "feat/x": { merged: false, exists: null } }));
  assert.equal(r!.unmerged.branches.length, 0);
  assert.equal(r!.notCounted[0]!.state, "unknown");
});

test("nada se cuenta dos veces: una sesión sin commit en una rama sin fusionar va a un solo bloque", () => {
  const [r] = undeliveredSpend(input([
    ...sesion("sin", at(40), 6, "feat/vieja"),
    ...sesion("con", at(39), 4, "feat/vieja"),
  ], [PRIMERO, commit(at(39, 2), "feat/vieja")]));
  assert.equal(usd(r!.sessionsWithoutCommit), 6);
  assert.equal(usd(r!.unmerged), 4, "solo lo que no estaba ya en la sesión sin commit");
  assert.equal(usd(r!.undelivered), 10);
  assert.ok(usd(r!.undelivered) <= usd(r!.total));
});

test("sesión que cruza dos ramas: cada turno a la suya", () => {
  const turns = [...sesion("s", at(40), 3, "feat/a"), ...sesion("s", new Date(at(40).getTime() + 3 * 60_000), 5, "feat/b")];
  const [r] = undeliveredSpend(input(turns, [PRIMERO, commit(at(40, 7), "feat/b")]));
  assert.equal(r!.sessionsWithoutCommit.count, 0, "es un solo rato, y tuvo commit");
  assert.deepEqual(r!.unmerged.branches.map((b) => [b.branch, usd(b)]).sort(), [["feat/a", 3], ["feat/b", 5]]);
});

test("el periodo mira el inicio de la sesión, pero la antigüedad de la rama mira todo", () => {
  const turns = [...sesion("vieja", at(60), 5, "feat/x"), ...sesion("reciente", at(5), 2, "feat/x")];
  const [r] = undeliveredSpend(input(turns, [PRIMERO, commit(at(60, 1), "feat/x"), commit(at(5, 1), "feat/x")],
    { from: "2026-09-01", to: "2026-09-30" }));
  assert.equal(usd(r!.total), 5);
  assert.equal(r!.unmerged.branches.length, 0, "la rama tuvo actividad hace 5 días: está abierta");
  assert.equal(r!.notCounted[0]!.state, "open");
});

test("dinero real con la cuota del mes, y Copilot marcado como coste desconocido", () => {
  const subs: Subscription[] = [{ id: "max", name: "Max", monthlyFee: money(10_000, "EUR"),
    effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null }];
  const turns = [...sesion("sin", new Date("2026-10-10T10:00:00Z"), 5, "main"),
                 ...sesion("cop", new Date("2026-10-11T10:00:00Z"), 5, "main", "copilot")];
  const [r] = undeliveredSpend(input(turns, [PRIMERO], {
    subscriptions: subs, monthTotals: new Map([["2026-10", { microUsd: 20_000_000 }]]) }));
  assert.deepEqual(r!.sessionsWithoutCommit.real, money(2_500, "EUR"), "5 $ de 20 $ del mes: un cuarto de 100 €");
  assert.equal(r!.unpricedAgents, true);
});
