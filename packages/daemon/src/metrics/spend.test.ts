import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AgentTurn, Subscription, TimeEntry } from "@estela/shared";
import { money } from "@estela/shared";

import { planEntries } from "../billing/assign.js";
import { sessionize } from "../billing/sessionize.js";
import { openDatabase } from "../db/schema.js";
import * as store from "../db/store.js";
import { normalizePath } from "../paths.js";
import { costOfTurn } from "../pricing/cost.js";
import type { MergeRecord } from "../watchers/git.js";
import { spendByUnit, type SpendInput, type SpendProject } from "./spend.js";

/**
 * Coste de IA por entrega. Todo con datos inventados: el cliente "Acme" y sus
 * ramas no existen. Lo que no puede pasar es repartir a ojo: lo que no tiene
 * base va a "sin atribuir", entero.
 */

const REPO = "/tmp/acme-web";
const PROJECT: SpendProject = {
  id: "web", name: "Web", clientId: "acme", clientName: "Acme", repoPaths: [REPO],
  tracker: { system: "github", prefixes: [] },
};

let n = 0;
function entry(over: Partial<TimeEntry> & { usd: number; minutes: number; day?: string }): TimeEntry {
  const startedAt = new Date(`${over.day ?? "2026-10-05"}T10:00:00Z`);
  return {
    id: `e${n++}`, projectId: "web", startedAt,
    endedAt: new Date(startedAt.getTime() + over.minutes * 60_000), seconds: over.minutes * 60,
    description: "", billable: true, invoiceId: null, aiCost: { microUsd: over.usd * 1_000_000 },
    agentSeconds: 0, commitHashes: [], agents: ["claude-code"], source: "agent", kind: "development",
    branch: null, workItems: [], ...over,
  };
}

function merge(sourceBranch: string, ref: string | null, repoPath = REPO): MergeRecord {
  return { repoPath, hash: `m${n++}`, at: new Date("2026-10-20T12:00:00Z"), sourceBranch, ref, subject: "" };
}

function input(entries: TimeEntry[], over: Partial<SpendInput> = {}): SpendInput {
  return { entries, projects: [PROJECT], merges: [], subscriptions: [], monthTotals: new Map(), ...over };
}

test("por rama: cada rama con sus horas y su coste, y sin rama va a sin atribuir", () => {
  const [r] = spendByUnit(input([
    entry({ branch: "feat/12-login", usd: 3, minutes: 60 }),
    entry({ branch: "feat/12-login", usd: 1, minutes: 30, day: "2026-10-06" }),
    entry({ branch: "fix/pagos", usd: 2, minutes: 45 }),
    entry({ branch: null, usd: 5, minutes: 20, source: "manual", agents: [] }),
  ]), "branch");

  assert.deepEqual(r!.units.map((u) => [u.key, u.seconds / 60, u.consumption.microUsd / 1e6]), [
    ["feat/12-login", 90, 4],
    ["fix/pagos", 45, 2],
    [null, 20, 5],
  ]);
  assert.equal(r!.total.consumption.microUsd, 11_000_000, "el total cuadra con la suma, sin atribuir incluido");
  assert.deepEqual(r!.units[0]!.basis, ["agent-branch"]);
});

test("la rama de un bloque sin agente se marca como aproximada", () => {
  const [r] = spendByUnit(input([entry({ branch: "fix/pagos", usd: 0, minutes: 30, agents: [] })]), "branch");
  assert.deepEqual(r!.units[0]!.basis, ["commit-branch"]);
});

test("por ticket: en qué se basa cada atribución", () => {
  const [r] = spendByUnit(input([
    entry({ branch: "feat/12-login", workItems: ["github:12"], usd: 3, minutes: 60 }),
    entry({ branch: "main", workItems: ["github:40"], usd: 1, minutes: 10 }),
    entry({ branch: "spike", workItems: ["github:7"], workItemsManual: true, usd: 1, minutes: 10 }),
    entry({ branch: "feat/buscador", usd: 2, minutes: 30 }),
    entry({ branch: "experimento", usd: 4, minutes: 50 }),
  ], { merges: [merge("feat/buscador", "github:31")] }), "item");

  const por = new Map(r!.units.map((u) => [u.key, u]));
  assert.deepEqual(por.get("github:12")!.basis, ["branch-name"]);
  assert.deepEqual(por.get("github:40")!.basis, ["commit-message"]);
  assert.deepEqual(por.get("github:7")!.basis, ["manual"]);
  assert.deepEqual(por.get("github:31")!.basis, ["merge"], "sin ticket, el PR del merge");
  assert.equal(por.get(null)!.consumption.microUsd, 4_000_000, "lo que no tiene ticket ni PR, entero");
  assert.deepEqual(por.get(null)!.branches, ["experimento"]);
});

test("un PR no sustituye a un ticket ya conocido: se enseña al lado", () => {
  const [r] = spendByUnit(input([
    entry({ branch: "feat/12-login", workItems: ["github:12"], usd: 3, minutes: 60 }),
  ], { merges: [merge("feat/12-login", "github:15")] }), "item");
  assert.equal(r!.units[0]!.key, "github:12");
  assert.deepEqual(r!.units[0]!.prs, ["github:15"]);
});

test("PR fusionado con squash: sin merge en git, la rama queda sin PR", () => {
  // GitHub solo deja "Login (#9)" en main: de ahí no se sabe qué rama fue. La
  // rama sigue atribuida por su nombre; el PR queda para cuando se lea GitHub.
  const entries = [entry({ branch: "feat/login", usd: 3, minutes: 60 })];
  const [porRama] = spendByUnit(input(entries), "branch");
  assert.equal(porRama!.units[0]!.key, "feat/login");
  assert.deepEqual(porRama!.units[0]!.prs, []);
  const [porTicket] = spendByUnit(input(entries), "item");
  assert.equal(porTicket!.units[0]!.key, null);
});

test("rama borrada: el merge se guardó al importar y la sigue uniendo con su PR", () => {
  // Que la rama ya no exista no cambia nada: los merges y las imputaciones
  // viven en la base, no en las referencias de git.
  const [r] = spendByUnit(input([entry({ branch: "feat/borrada", usd: 2, minutes: 20 })],
    { merges: [merge("feat/borrada", "github:50")] }), "item");
  assert.equal(r!.units[0]!.key, "github:50");
});

test("los merges de otro repo no se cuelan", () => {
  const [r] = spendByUnit(input([entry({ branch: "feat/x", usd: 1, minutes: 10 })],
    { merges: [merge("feat/x", "github:3", "/tmp/otro")] }), "item");
  assert.equal(r!.units[0]!.key, null);
});

test("dinero real: la cuota del mes por la parte de TODO el consumo del mes", () => {
  const subs: Subscription[] = [{ id: "max", name: "Max", monthlyFee: money(10_000, "EUR"),
    effectiveFrom: new Date("2026-10-01T00:00:00Z"), effectiveTo: null }];
  // 100 € al mes; la máquina consumió 20 $ en octubre, este proyecto 5 $.
  const [r] = spendByUnit(input([
    entry({ branch: "a", usd: 4, minutes: 10 }),
    entry({ branch: "b", usd: 1, minutes: 10 }),
    entry({ branch: "c", usd: 2, minutes: 10, day: "2026-09-30" }),
  ], { subscriptions: subs, monthTotals: new Map([["2026-10", { microUsd: 20_000_000 }],
                                                  ["2026-09", { microUsd: 4_000_000 }]]) }), "branch");
  const por = new Map(r!.units.map((u) => [u.key, u]));
  assert.deepEqual(por.get("a")!.real, money(2_000, "EUR"));
  assert.deepEqual(por.get("b")!.real, money(500, "EUR"));
  assert.equal(por.get("c")!.real, null, "septiembre no tenía cuota");
  assert.equal(por.get("c")!.realPartial, true);
  assert.deepEqual(r!.total.real, money(2_500, "EUR"));
  assert.equal(r!.total.realPartial, true);
});

test("sin suscripción no hay dinero real, y Copilot se marca como coste desconocido", () => {
  const [r] = spendByUnit(input([entry({ branch: "a", usd: 0, minutes: 30, agents: ["copilot"] })]), "branch");
  assert.equal(r!.units[0]!.real, null);
  assert.equal(r!.units[0]!.unpricedAgents, true);
  assert.equal(r!.total.unpricedAgents, true);
});

// ---------------------------------------------------------------------------
// Del transcript al informe, por el mismo camino que `estela import`.
// ---------------------------------------------------------------------------

function turnos(cwd: string, start: Date, minutos: number, branch: string, session: string): AgentTurn[] {
  return Array.from({ length: minutos }, (_, i) => ({
    agent: "claude-code" as const, turnId: `${session}-${branch}-${i}`, sessionId: session,
    at: new Date(start.getTime() + i * 60_000), model: "claude-sonnet-4-6",
    repoPath: normalizePath(cwd), branch, producerVersion: null,
    tokens: { input: 1000 * (i + 1), output: 500, cacheRead: 2000, cacheWrite5m: 0, cacheWrite1h: 0 },
  }));
}

function repoTemporal() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "estela-spend-")));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "src", "ui"), { recursive: true });
  const db = openDatabase(":memory:");
  store.upsertClient(db, { id: "acme", name: "Acme", currency: "EUR" });
  store.upsertProject(db, { id: "web", clientId: "acme", name: "Web", repoPaths: [normalizePath(root)],
    billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  return { root, db };
}

const micro = (ts: readonly AgentTurn[]) =>
  ts.reduce((s, t) => s + costOfTurn(t.tokens, t.model, t.at)!.microUsd, 0);

test("sesión que cruza dos ramas, en una subcarpeta: cada rama con el coste exacto de sus turnos", () => {
  const { root, db } = repoTemporal();
  // La sesión se abrió en src/ui (subcarpeta del repo) y cambió de rama sin pausa.
  const cwd = join(root, "src", "ui");
  const a = turnos(cwd, new Date(2026, 9, 5, 10), 40, "feat/12-login", "s1");
  const b = turnos(cwd, new Date(2026, 9, 5, 10, 45), 20, "fix/pagos", "s1");

  const plan = planEntries(db, sessionize([...a, ...b]));
  for (const { entry: e } of plan.entries) store.saveTimeEntry(db, e);
  const entries = store.getTimeEntries(db, "web");

  const [r] = spendByUnit({ entries, projects: [{ ...PROJECT, repoPaths: [normalizePath(root)] }],
    merges: [], subscriptions: [], monthTotals: new Map() }, "branch");
  const por = new Map(r!.units.map((u) => [u.key, u]));
  assert.equal(por.get("feat/12-login")!.consumption.microUsd, micro(a));
  assert.equal(por.get("fix/pagos")!.consumption.microUsd, micro(b));
  assert.equal(por.has(null), false);
  // "a" hasta el primer turno de "b" (45 min) y "b" con su cola: el mismo rato de reloj.
  assert.equal(por.get("feat/12-login")!.seconds, 45 * 60);
  assert.equal(por.get("fix/pagos")!.seconds, 21 * 60);
});
