import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AgentTurn, CommitRecord } from "@estela/shared";
import { localDate } from "@estela/shared";

import { openDatabase } from "../db/schema.js";
import * as store from "../db/store.js";
import { normalizePath } from "../paths.js";
import { commitOnlyBlocks, entryId, knownTurns, planEntries } from "./assign.js";
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

test("recuperando: el worktree va a su proyecto, y se cuenta cuánto se recuperó", () => {
  const { main, wt, db } = escenario();
  const blocks = sessionize([...sesion(main, dia(5), 30), ...sesion(wt, dia(5, 14), 30, "feature")]);
  const plan = planEntries(db, blocks);
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
  const plan = planEntries(db, sessionize(sesion(api, dia(6), 40)));
  assert.deepEqual(plan.entries.map((e) => e.entry.projectId), ["api"]);
  assert.equal(plan.recovered.size, 0);
});

test("un día aprobado o facturado no se toca: se informa con su fecha y sus horas", () => {
  const { main, wt, db } = escenario();
  // Lo de siempre, ya importado y aprobado el día 5.
  const antes = planEntries(db, sessionize(sesion(main, dia(5), 30)));
  for (const { entry } of antes.entries) store.saveTimeEntry(db, entry);
  db.prepare("UPDATE time_entries SET approved = 1 WHERE local_date = ?").run(localDate(dia(5)));
  // Y uno facturado el día 6.
  const otro = planEntries(db, sessionize(sesion(main, dia(6), 20)));
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
  const plan = planEntries(db, blocks);

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
  const plan = planEntries(db, sessionize([...sesion(main, dia(9), 30), ...sesion(wt, dia(9), 30)]));
  assert.equal(plan.recovered.size, 0);
  assert.equal(plan.entries.length, 1);
});

test("un commit de una sesión cuyo transcript ya se borró no genera horas otra vez", () => {
  // Visto con datos reales: Claude Code limpia sus transcripts antiguos. Al
  // reimportar, las sesiones de agosto ya no aparecían y sus commits parecían
  // trabajo sin agente: 3 h estimadas de un trabajo ya facturado.
  const { main, db } = escenario();
  const inicio = new Date(2026, 7, 20, 10, 0);
  const commit: CommitRecord = {
    repoPath: n(main), hash: "abc", at: new Date(2026, 7, 20, 10, 20), authorEmail: "yo@ejemplo.com",
    authorName: "Yo", branch: "fix/otra", subject: "feat: algo", linesAdded: 1, linesDeleted: 0, files: [],
  };

  assert.equal(commitOnlyBlocks(db, [commit], []).length, 1, "sin sesión conocida, el commit es lo único que hay");

  store.saveTurns(db, sesion(main, inicio, 30));
  assert.equal(commitOnlyBlocks(db, [commit], []).length, 0, "la sesión sigue en la base aunque no en el disco");
});

// `git log --all` desde un worktree trae toda la historia del repo, así que los
// mismos commits quedan guardados dos veces: bajo el repo y bajo el worktree.
test("una sesión en el repo tapa la copia del commit guardada bajo su worktree", () => {
  const { main, wt, db } = escenario();
  const inicio = dia(5);
  const commit: CommitRecord = {
    repoPath: n(wt), hash: "abc", at: new Date(inicio.getTime() + 20 * 60_000),
    authorEmail: "yo@x.com", authorName: "Yo", branch: "main", subject: "fix",
    linesAdded: 1, linesDeleted: 0, files: [],
  };
  const agente = sessionize(sesion(main, inicio, 30));
  assert.equal(commitOnlyBlocks(db, [commit], agente).length, 0, "sumaría 25 min estimados a una sesión medida");
});

test("una sesión en el worktree tapa el commit guardado bajo el repo", () => {
  const { main, wt, db } = escenario();
  const inicio = dia(5);
  const commit: CommitRecord = {
    repoPath: n(main), hash: "abc", at: new Date(inicio.getTime() + 20 * 60_000),
    authorEmail: "yo@x.com", authorName: "Yo", branch: "main", subject: "fix",
    linesAdded: 1, linesDeleted: 0, files: [],
  };
  const agente = sessionize(sesion(wt, inicio, 30));
  assert.equal(commitOnlyBlocks(db, [commit], agente).length, 0);
});

test("una sesión en otro repo a la misma hora no tapa el commit", () => {
  const { base, main, db } = escenario();
  const otro = join(base, "otro");
  mkdirSync(join(otro, ".git"), { recursive: true });
  const inicio = dia(5);
  const commit: CommitRecord = {
    repoPath: n(main), hash: "abc", at: new Date(inicio.getTime() + 20 * 60_000),
    authorEmail: "yo@x.com", authorName: "Yo", branch: "main", subject: "fix",
    linesAdded: 1, linesDeleted: 0, files: [],
  };
  const agente = sessionize(sesion(otro, inicio, 30));
  assert.equal(commitOnlyBlocks(db, [commit], agente).length, 1);
});

/** Lo que hace cada importación, sin el escaneo: planear y guardar. */
function importar(db: ReturnType<typeof escenario>["db"], blocks: ReturnType<typeof sessionize>) {
  const plan = planEntries(db, blocks);
  for (const { entry } of plan.entries) store.saveTimeEntry(db, entry);
  store.deleteStaleEntries(db, plan.stale);
  return plan;
}

const filas = (db: ReturnType<typeof escenario>["db"]) =>
  store.getTimeEntries(db, "web").map((e) => `${e.branch}:${Math.round(e.seconds / 60)}`).sort();

test("cambiar de rama a mitad de sesión reparte el rato entre las dos, sin contarlo dos veces", () => {
  const { main, db } = escenario();
  const antes = sesion(main, dia(5), 60, "a");
  importar(db, sessionize(antes));
  assert.deepEqual(filas(db), ["a:61"]);

  // Sigue la misma sesión en otra rama: "a" llega hasta el primer turno de "b",
  // y el total es el mismo rato de reloj (91 min) que antes iba entero a "b".
  const plan = importar(db, sessionize([...antes, ...sesion(main, dia(5, 11), 30, "b")]));
  assert.deepEqual(plan.stale, []);
  assert.deepEqual(filas(db), ["a:60", "b:31"]);
});

test("en un día cerrado, el bloque partido por la rama se queda como estaba", () => {
  // Facturado con el bloque entero en "b": partirlo ahora crearía "a" al lado
  // y esas horas contarían dos veces.
  for (const cerrar of ["approved = 1", "adjust_reason = 'x'", "invoice_id = 'f'"]) {
    const { main, db } = escenario();
    const turnos = [...sesion(main, dia(5), 60, "a"), ...sesion(main, dia(5, 11), 30, "b")];
    const [a, b] = sessionize(turnos);
    const entero = { ...a!, branch: "b", endedAt: b!.endedAt, seconds: 91 * 60 };
    store.saveTimeEntry(db, planEntries(db, [entero]).entries[0]!.entry);
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`UPDATE time_entries SET ${cerrar}`);
    const plan = importar(db, sessionize(turnos));
    assert.deepEqual(plan.protectedDuplicates, [], cerrar);
    assert.deepEqual(filas(db), ["b:91"], cerrar);
  }
});

test("una imputación aprobada, ajustada o facturada no se retira nunca: se avisa", () => {
  for (const proteger of ["approved = 1", "adjust_reason = 'x'", "invoice_id = 'f'"]) {
    const { main, db } = escenario();
    const antes = sesion(main, dia(5), 60, "a");
    importar(db, sessionize(antes));
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`UPDATE time_entries SET ${proteger}`);
    const plan = importar(db, sessionize([...antes, ...sesion(main, dia(5, 11), 30, "b")]));
    assert.deepEqual(plan.stale, [], proteger);
    assert.equal(plan.protectedDuplicates.length, 1, proteger);
    assert.equal(store.getTimeEntries(db, "web").length, 2, proteger);
  }
});

test("el trabajo de otra rama a otra hora no se retira", () => {
  const { main, db } = escenario();
  const a = sesion(main, dia(5), 60, "a");
  importar(db, sessionize(a));
  // La rama "a" desaparece del plan (por ejemplo, se cambió el proyecto de la
  // sesión), pero nada más cubre esas horas: se quedan.
  const plan = importar(db, sessionize(sesion(main, dia(5, 15), 30, "b")));
  assert.deepEqual(plan.stale, []);
  assert.deepEqual(filas(db), ["a:61", "b:31"]);
});

test("la sesión de un worktree borrado no se retira aunque otra sesión la cubra", () => {
  const { base, main, wt, db } = escenario();
  const sesionWt = sesion(wt, dia(5), 60, "feature");
  store.saveTimeEntry(db, planEntries(db, sessionize(sesionWt)).entries[0]!.entry);
  // El worktree ya no existe: su sesión se queda sin proyecto, pero sigue ahí.
  rmSync(wt, { recursive: true });
  void base;
  const plan = importar(db, sessionize([...sesionWt, ...sesion(main, dia(5), 90, "main")]));
  assert.deepEqual(plan.stale, []);
  assert.deepEqual(filas(db), ["feature:61", "main:91"]);
});

test("otro proyecto a la misma hora no cubre nada", () => {
  const { base, main, db } = escenario();
  const otro = join(base, "otro");
  mkdirSync(otro);
  store.upsertProject(db, { id: "otro", clientId: "c", name: "Otro", repoPaths: [n(otro)], billable: true,
    roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  const a = sesion(main, dia(5), 60, "a");
  importar(db, sessionize(a));
  const plan = importar(db, sessionize([...sesion(otro, dia(5), 120, "x"), ...sesion(main, dia(5, 15), 10, "b")]));
  assert.deepEqual(plan.stale, []);
});

test("knownTurns: lo guardado sigue contando, y lo recién leído manda", () => {
  const { main, wt, db } = escenario();
  const guardados = sesion(main, dia(5), 3);
  store.saveTurns(db, guardados);
  // Mismo turno, pero el lector ahora sabe devolverlo a su carpeta.
  const leido = { ...guardados[0]!, repoPath: n(wt) };
  const todos = knownTurns(db, [leido]);
  assert.equal(todos.length, 3);
  assert.equal(todos.find((t) => t.turnId === leido.turnId)!.repoPath, n(wt));
});

const reparto = (db: ReturnType<typeof escenario>["db"], turnos: AgentTurn[]) => {
  const plan = planEntries(db, sessionize(turnos));
  return { plan, min: Object.fromEntries(plan.entries.map((e) => [e.entry.branch, e.entry.seconds / 60])) };
};

test("dos ramas a la vez cuentan el tiempo real, repartido entre las dos", () => {
  const { main, wt, db } = escenario();
  const { min, plan } = reparto(db, [...sesion(main, dia(5), 60, "a"), ...sesion(wt, dia(5), 60, "b")]);
  assert.deepEqual(min, { a: 30.5, b: 30.5 });
  assert.equal(plan.entries[0]!.entry.agentSeconds, plan.entries[0]!.entry.seconds);
});

test("solo se reparte el rato que coincide", () => {
  const { main, wt, db } = escenario();
  // a: 10:00-11:02, b: 10:30-11:32. Coinciden 32 min de un total de 92.
  const { min } = reparto(db, [...sesion(main, dia(5), 61, "a"), ...sesion(wt, new Date(dia(5).getTime() + 30 * 60_000), 61, "b")]);
  assert.deepEqual(min, { a: 30 + 16, b: 16 + 30 });
});

test("una detrás de otra no se reparte nada", () => {
  const { main, wt, db } = escenario();
  const { min } = reparto(db, [...sesion(main, dia(5), 60, "a"), ...sesion(wt, dia(5, 14), 60, "b")]);
  assert.deepEqual(min, { a: 61, b: 61 });
});

test("el coste de IA no se reparte: se gastó entero en cada rama", () => {
  const { main, wt, db } = escenario();
  const solo = reparto(db, sesion(main, dia(5), 60, "a")).plan.entries[0]!.entry.aiCost;
  const juntas = reparto(db, [...sesion(main, dia(6), 60, "a"), ...sesion(wt, dia(6), 60, "b")]).plan;
  assert.deepEqual(juntas.entries[0]!.entry.aiCost, solo);
});

test("dos proyectos a la vez no se reparten: cada cliente tiene su hora", () => {
  const { base, main, db } = escenario();
  const otro = join(base, "otro");
  mkdirSync(otro);
  store.upsertProject(db, { id: "otro", clientId: "c", name: "Otro", repoPaths: [n(otro)], billable: true,
    roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  const { min } = reparto(db, [...sesion(main, dia(5), 60, "a"), ...sesion(otro, dia(5), 60, "b")]);
  assert.deepEqual(min, { a: 61, b: 61 });
});

test("una rama que cae entera dentro de una imputación aprobada no genera horas", () => {
  const { base, main, db } = escenario();
  const api = join(base, "api");
  mkdirSync(api);
  store.upsertProject(db, { id: "web", clientId: "c", name: "Web", repoPaths: [n(main), n(api)], billable: true,
    roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  const a = sesion(main, dia(5), 60, "a");
  importar(db, sessionize(a));
  db.exec("UPDATE time_entries SET approved = 1");
  const plan = importar(db, sessionize([...a, ...sesion(api, dia(5), 30, "b")]));
  assert.deepEqual(filas(db), ["a:61"], "b no suma: ese rato ya está dado por bueno");
  assert.equal(plan.entries.some((e) => e.entry.branch === "b"), false);
});

test("una imputación ajustada conserva su cifra, y lo medido refleja el reparto", () => {
  const { main, wt, db } = escenario();
  const a = sesion(main, dia(5), 60, "a");
  importar(db, sessionize(a));
  db.exec("UPDATE time_entries SET seconds = 6000, adjust_reason = 'precio pactado', adjusted_at = '2026-10-05T00:00:00Z'");
  importar(db, sessionize([...a, ...sesion(wt, dia(5), 60, "b")]));
  const fila = db.prepare("SELECT seconds, measured_seconds FROM time_entries WHERE branch = 'a'").get() as Record<string, number>;
  assert.equal(fila["seconds"], 6000);
  assert.equal(fila["measured_seconds"], 30.5 * 60);
});

test("una sesión que la regla 2 deja fuera no le resta tiempo a la otra", () => {
  const { main, wt, db } = escenario();
  const a = sesion(main, dia(5), 60, "a");
  importar(db, sessionize(a));
  db.exec("UPDATE time_entries SET approved = 1");
  const plan = planEntries(db, sessionize([...a, ...sesion(wt, dia(5), 60, "b")]));
  assert.equal(plan.blocked.length, 1);
  assert.deepEqual(plan.entries.map((e) => [e.entry.branch, e.entry.seconds / 60]), [["a", 61]]);
});

test("repartir es estable: importar dos veces da lo mismo", () => {
  const { main, wt, db } = escenario();
  const turnos = [...sesion(main, dia(5), 60, "a"), ...sesion(wt, dia(5), 60, "b")];
  importar(db, sessionize(turnos));
  const una = filas(db);
  importar(db, sessionize(turnos));
  assert.deepEqual(filas(db), una);
});

test("un proyecto archivado no capta horas ni cambia las que tenía", () => {
  const { main, db } = escenario();
  importar(db, sessionize(sesion(main, dia(5), 30)));
  store.archiveProject(db, "web");
  const plan = importar(db, sessionize([...sesion(main, dia(5), 30), ...sesion(main, dia(6), 30)]));
  assert.deepEqual(plan.entries, []);
  assert.deepEqual(plan.stale, []);
  assert.deepEqual(filas(db), ["main:31"]);

  store.restoreProject(db, "web");
  importar(db, sessionize([...sesion(main, dia(5), 30), ...sesion(main, dia(6), 30)]));
  assert.equal(filas(db).length, 2, "lo trabajado mientras tanto vuelve al restaurar");
});

