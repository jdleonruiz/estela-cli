import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AgentTurn } from "@estela/shared";
import { localDate } from "@estela/shared";

import { openDatabase } from "../db/schema.js";
import * as store from "../db/store.js";
import { normalizePath } from "../paths.js";
import { entryId, planEntries } from "./assign.js";
import { sessionize } from "./sessionize.js";

/**
 * Las reglas de la recuperación de horas por raíz git, en el sitio donde se
 * deciden. Esto acaba en facturas: lo que no puede pasar es mover horas de un
 * proyecto a otro, o cambiar un día que alguien ya aprobó o facturó.
 */

const n = (p: string) => normalizePath(p);

/** main/ es un repo registrado como "web"; wt/ es un worktree suyo, sin registrar. */
function escenario() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "estela-assign-")));
  const main = join(base, "web");
  mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
  writeFileSync(join(main, ".git", "worktrees", "wt", "commondir"), "../..\n");
  const wt = join(base, "web-wt");
  mkdirSync(wt);
  writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);

  const db = openDatabase(":memory:");
  store.upsertClient(db, { id: "c", name: "C", currency: "EUR" });
  store.upsertProject(db, { id: "web", clientId: "c", name: "Web", repoPaths: [n(main)], billable: true,
    roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  return { base, main, wt, db };
}

let k = 0;
/** Turnos seguidos de un minuto, en `cwd`, desde `start`. */
function sesion(cwd: string, start: Date, minutos: number, branch = "main"): AgentTurn[] {
  return Array.from({ length: minutos }, (_, i) => ({
    agent: "claude-code" as const, turnId: `t${k++}`, sessionId: `s-${cwd}`,
    at: new Date(start.getTime() + i * 60_000), model: "claude-sonnet-4-6",
    repoPath: n(cwd), branch, producerVersion: null,
    tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite5m: 0, cacheWrite1h: 0 },
  }));
}

const dia = (d: number, h = 10) => new Date(2026, 9, d, h, 0);

test("sin recuperar: el worktree se queda sin proyecto, como antes", () => {
  const { main, wt, db } = escenario();
  const blocks = sessionize([...sesion(main, dia(5), 30), ...sesion(wt, dia(5, 14), 30, "feature")]);
  const plan = planEntries(db, blocks, { recover: false });
  assert.deepEqual(plan.entries.map((e) => e.entry.branch), ["main"]);
  assert.equal(plan.unassigned, 1);
});

test("recuperando: el worktree va a su proyecto, y se cuenta cuánto se recuperó", () => {
  const { main, wt, db } = escenario();
  const blocks = sessionize([...sesion(main, dia(5), 30), ...sesion(wt, dia(5, 14), 30, "feature")]);
  const plan = planEntries(db, blocks, { recover: true });
  const feature = plan.entries.find((e) => e.entry.branch === "feature")!;
  assert.equal(feature.entry.projectId, "web");
  assert.equal(feature.entry.id, entryId("web", localDate(dia(5)), "feature"));
  assert.ok(feature.recoveredSeconds > 0);
  assert.equal(plan.recovered.get("web"), feature.recoveredSeconds);
  assert.equal(plan.unassigned, 0);
  // Lo que ya estaba asignado no gana ni pierde nada.
  assert.equal(plan.entries.find((e) => e.entry.branch === "main")!.recoveredSeconds, 0);
});

test("nunca mueve horas de un proyecto a otro: la carpeta registrada manda sobre la raíz git", () => {
  // `web/packages/api` es su propio proyecto aunque su raíz git sea la de web.
  const { main, db } = escenario();
  const api = join(main, "packages", "api");
  mkdirSync(api, { recursive: true });
  store.upsertProject(db, { id: "api", clientId: "c", name: "API", repoPaths: [n(api)], billable: true,
    roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  const plan = planEntries(db, sessionize(sesion(api, dia(6), 40)), { recover: true });
  assert.deepEqual(plan.entries.map((e) => e.entry.projectId), ["api"]);
  assert.equal(plan.recovered.size, 0);
});

test("un día aprobado o facturado no se toca: se informa con su fecha y sus horas", () => {
  const { main, wt, db } = escenario();
  // Lo de siempre, ya importado y aprobado el día 5.
  const antes = planEntries(db, sessionize(sesion(main, dia(5), 30)), { recover: false });
  for (const { entry } of antes.entries) store.saveTimeEntry(db, entry);
  db.prepare("UPDATE time_entries SET approved = 1 WHERE local_date = ?").run(localDate(dia(5)));
  // Y uno facturado el día 6.
  const otro = planEntries(db, sessionize(sesion(main, dia(6), 20)), { recover: false });
  for (const { entry } of otro.entries) store.saveTimeEntry(db, entry);
  db.prepare(`INSERT INTO invoices (id, number, client_id, project_id, issued_at, cutoff_at, period_start,
    currency, subtotal_minor, total_minor, total_seconds, lines_json) VALUES ('inv1', 'INF-1', 'c', 'web', ?, ?, ?, 'EUR', 0, 0, 0, '[]')`)
    .run(dia(8).toISOString(), dia(6, 23).toISOString(), dia(1).toISOString());
  db.prepare("UPDATE time_entries SET invoice_id = 'inv1' WHERE local_date = ?").run(localDate(dia(6)));

  const blocks = sessionize([
    ...sesion(main, dia(5), 30),                         // lo que ya había
    ...sesion(wt, dia(5, 14), 30),                       // worktree, misma rama y día aprobado: se fusionaría
    ...sesion(wt, dia(6, 15), 25, "fix"),                // worktree en día facturado
    ...sesion(wt, dia(7, 9), 45, "feature"),             // worktree en día libre
  ]);
  const plan = planEntries(db, blocks, { recover: true });

  // El día 5 se guarda exactamente como estaba: sin los minutos del worktree.
  const del5 = plan.entries.find((e) => e.entry.id === entryId("web", localDate(dia(5)), "main"))!;
  assert.equal(del5.entry.seconds, antes.entries[0]!.entry.seconds);
  // El 6 no gana una imputación nueva; el 7 sí.
  assert.ok(!plan.entries.some((e) => e.entry.id === entryId("web", localDate(dia(6)), "fix")));
  assert.ok(plan.entries.some((e) => e.entry.id === entryId("web", localDate(dia(7)), "feature")));

  assert.deepEqual(plan.blocked.map((b) => [b.projectId, b.day]).sort(),
    [["web", localDate(dia(5))], ["web", localDate(dia(6))]]);
  assert.ok(plan.blocked.every((b) => b.seconds > 0));
  assert.deepEqual([...plan.recovered.keys()], ["web"], "solo lo del día 7");
});

test("una sesión del worktree a la misma hora que la del repo no suma nada: se unen intervalos", () => {
  // Dos sesiones a la vez son la misma persona: import une los intervalos, y
  // recuperar no puede contar dos veces el mismo rato.
  const { main, wt, db } = escenario();
  const plan = planEntries(db, sessionize([...sesion(main, dia(9), 30), ...sesion(wt, dia(9), 30)]), { recover: true });
  assert.equal(plan.recovered.size, 0);
  assert.equal(plan.entries.length, 1);
});
