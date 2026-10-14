import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentKind, AgentTurn, TokenUsage } from "@estela/shared";

import { openDatabase } from "../db/schema.js";
import * as store from "../db/store.js";
import { loadQuotaReport } from "../quota.js";
import {
  breakdown, buildQuota, compareWithHistory, fiveHourWindows, officialWindow, quotaToJson, sameStretch, weekStart, windowAt,
  type QuotaBucket, type QuotaTurn,
} from "./quota.js";

/**
 * "¿Qué proyecto se come mi cuota?"
 *
 * Lo que no puede fallar: que un turno repetido cuente dos veces (inflaría a un
 * proyecto), que la semana empiece donde no es, y que se compare con un
 * historial que no existe. Todo lo demás es presentación.
 */

const tok = (total: number, over: Partial<TokenUsage> = {}): TokenUsage =>
  ({ input: 0, output: 0, cacheRead: total, cacheWrite5m: 0, cacheWrite1h: 0, ...over });

const turno = (at: string, repoPath: string | null, total: number, agent: AgentKind = "claude-code"): QuotaTurn =>
  ({ agent, at: new Date(at), repoPath, tokens: tok(total) });

const porCarpeta = (repoPath: string | null): QuotaBucket =>
  repoPath ? { kind: "project", projectId: repoPath, projectName: repoPath } : { kind: "none" };

/** Fechas en hora local: los tests no dependen de la zona de quien los corre. */
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

// ── La semana ───────────────────────────────────────────────────────────

test("la semana empieza el lunes a las 00:00 en hora local, también un domingo por la noche", () => {
  // 2026-10-11 es domingo; 2026-10-05, lunes.
  assert.deepEqual(weekStart(local(2026, 10, 11, 23, 59)), local(2026, 10, 5));
  assert.deepEqual(weekStart(local(2026, 10, 5, 0, 0)), local(2026, 10, 5), "el propio lunes a medianoche");
  assert.deepEqual(weekStart(local(2026, 10, 7, 15, 0)), local(2026, 10, 5));
});

test("cambio de semana: lo del domingo por la noche no cuenta en la semana que empieza el lunes", () => {
  const now = local(2026, 10, 12, 0, 30); // lunes 00:30
  const r = buildQuota({
    turns: [
      { agent: "claude-code", at: local(2026, 10, 11, 23, 50), repoPath: "/a", tokens: tok(1000) },
      { agent: "claude-code", at: local(2026, 10, 12, 0, 10), repoPath: "/b", tokens: tok(10) },
    ],
    firstTurnAt: new Map(), now, bucketOf: porCarpeta,
  });
  const semana = r.agents[0]!.week;
  assert.deepEqual(semana.rows.map((x) => x.bucket.kind === "project" && x.bucket.projectId), ["/b"]);
  assert.equal(semana.total.total, 10);
  // Pero la ventana de 5 h sí cruza la medianoche: la cuota no sabe de semanas.
  assert.equal(r.agents[0]!.window!.total.total, 1010);
});

test("la semana del cambio de hora sigue empezando el lunes a las 00:00", () => {
  // En Madrid, el domingo 25 de octubre de 2026 tiene 25 horas. Restar 7×24 h
  // dejaría el "lunes" a las 23:00 del domingo.
  const antes = process.env["TZ"];
  process.env["TZ"] = "Europe/Madrid";
  try {
    const lunes = weekStart(local(2026, 10, 28, 12));
    assert.equal(lunes.getDay(), 1);
    assert.equal(lunes.getHours(), 0);
    const atras = sameStretch(local(2026, 10, 28, 12), 1);
    assert.equal(atras.start.getDay(), 1);
    assert.equal(atras.start.getHours(), 0, "el lunes anterior, a medianoche y no a las 23:00 del domingo");
    assert.equal(atras.end.getDay(), 3);
    assert.equal(atras.end.getHours(), 12);
  } finally {
    if (antes === undefined) delete process.env["TZ"]; else process.env["TZ"] = antes;
  }
});

test("el mismo tramo de semanas anteriores: de lunes 00:00 al mismo día y hora", () => {
  const t = sameStretch(local(2026, 10, 7, 15, 0), 2); // miércoles 15:00, dos semanas atrás
  assert.deepEqual(t.start, local(2026, 9, 21));
  assert.deepEqual(t.end, local(2026, 9, 23, 15, 0));
});

// ── La ventana de 5 h ───────────────────────────────────────────────────

test("una ventana empieza con el primer turno después de que acabe la anterior y dura 5 h", () => {
  const w = fiveHourWindows([
    local(2026, 10, 7, 9, 0), local(2026, 10, 7, 13, 59), // misma ventana
    local(2026, 10, 7, 14, 0),                             // justo al cerrar: nueva
    local(2026, 10, 7, 18, 30),                            // dentro de la segunda
  ]);
  assert.deepEqual(w.map((x) => [x.start.getHours(), x.end.getHours()]), [[9, 14], [14, 19]]);
});

test("ventana abierta ahora, o la hora en que acabó la última", () => {
  const veces = [local(2026, 10, 7, 9, 0), local(2026, 10, 7, 10, 0)];
  const abierta = windowAt(veces, local(2026, 10, 7, 12, 0));
  assert.deepEqual(abierta.current?.start, local(2026, 10, 7, 9, 0));
  assert.equal(abierta.lastEnded, null);

  const cerrada = windowAt(veces, local(2026, 10, 7, 16, 0));
  assert.equal(cerrada.current, null);
  assert.deepEqual(cerrada.lastEnded, local(2026, 10, 7, 14, 0));

  assert.deepEqual(windowAt([], local(2026, 10, 7, 16, 0)), { current: null, lastEnded: null });
});

// ── Reparto ─────────────────────────────────────────────────────────────

test("el reparto va de mayor a menor, con su porcentaje, y suma bien los cinco campos", () => {
  const now = local(2026, 10, 7, 12);
  const r = buildQuota({
    turns: [
      { agent: "claude-code", at: local(2026, 10, 7, 10), repoPath: "/a",
        tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite5m: 4, cacheWrite1h: 5 } },
      turno("2026-10-06T10:00:00", "/b", 45),
    ],
    firstTurnAt: new Map(), now, bucketOf: porCarpeta,
  });
  const w = r.agents[0]!.week;
  assert.deepEqual(w.rows.map((x) => x.usage.total), [45, 15]);
  assert.deepEqual(w.rows[1]!.usage, { input: 1, output: 2, cacheRead: 3, cacheWrite: 9, total: 15 });
  assert.equal(w.rows[0]!.share, 0.75);
  assert.equal(w.total.total, 60);
});

test("un proyecto sin actividad en el periodo no sale en la tabla", () => {
  const db = openDatabase(":memory:");
  try {
    store.upsertClient(db, { id: "c", name: "C", currency: "EUR" });
    for (const [id, repo] of [["activo", "/repos/activo"], ["parado", "/repos/parado"]] as const) {
      store.upsertProject(db, { id, clientId: "c", name: id, repoPaths: [repo], billable: true,
        roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
    }
    store.saveTurns(db, [turnoGuardado("t1", "/repos/activo", "2026-10-07T10:00:00")]);
    const r = loadQuotaReport(db, local(2026, 10, 7, 12));
    const ids = r.agents[0]!.week.rows.map((x) => x.bucket.kind === "project" ? x.bucket.projectId : "?");
    assert.deepEqual(ids, ["activo"]);
  } finally { db.close(); }
});

test("un turno fuera de cualquier proyecto cuenta, a nombre de su carpeta, y uno sin carpeta también", () => {
  const db = openDatabase(":memory:");
  try {
    store.saveTurns(db, [
      turnoGuardado("t1", "/home/yo/notas", "2026-10-07T10:00:00"),
      { ...turnoGuardado("t2", null, "2026-10-07T10:05:00") },
    ]);
    const filas = loadQuotaReport(db, local(2026, 10, 7, 12)).agents[0]!.week.rows.map((x) => x.bucket);
    assert.deepEqual(filas, [{ kind: "folder", folder: "notas", path: "/home/yo/notas" }, { kind: "none" }]);
  } finally { db.close(); }
});

test("deduplicación: el mismo turno leído dos veces cuenta una sola vez", () => {
  // Es la garantía de los lectores (por message.id en Claude Code) y de la
  // clave primaria de agent_turns. La cuota no la repite: la hereda.
  const db = openDatabase(":memory:");
  try {
    const t = turnoGuardado("msg_01ABC", "/repo", "2026-10-07T10:00:00", 1000);
    store.saveTurns(db, [t, t]);
    store.saveTurns(db, [t]);
    const r = loadQuotaReport(db, local(2026, 10, 7, 12));
    assert.equal(r.agents[0]!.week.total.total, 1000);
  } finally { db.close(); }
});

// ── Agentes ─────────────────────────────────────────────────────────────

test("Claude Code y Codex van por separado; Copilot queda fuera y se dice", () => {
  const now = local(2026, 10, 7, 12);
  const r = buildQuota({
    turns: [
      turno("2026-10-07T10:00:00", "/a", 100, "claude-code"),
      turno("2026-10-07T10:00:00", "/a", 7, "codex"),
      turno("2026-10-07T10:00:00", "/a", 999_999, "copilot"),
    ],
    firstTurnAt: new Map(), now, bucketOf: porCarpeta,
  });
  assert.deepEqual(r.agents.map((a) => [a.agent, a.week.total.total]), [["claude-code", 100], ["codex", 7]]);
  assert.equal(r.copilotExcluded, true);
});

test("un agente sin actividad no aparece; sin Copilot no se menciona", () => {
  const r = buildQuota({
    turns: [turno("2026-10-07T10:00:00", "/a", 100, "claude-code")],
    firstTurnAt: new Map(), now: local(2026, 10, 7, 12), bucketOf: porCarpeta,
  });
  assert.deepEqual(r.agents.map((a) => a.agent), ["claude-code"]);
  assert.equal(r.copilotExcluded, false);
});

// ── Historial ───────────────────────────────────────────────────────────

const semanal = (n: number) => Array.from({ length: n }, (_, i) => ({ at: sameStretch(local(2026, 10, 7, 15), i + 1).start, total: 100 }));

test("semana sin historial: no se compara, y se dice cuántas semanas hay", () => {
  const now = local(2026, 10, 7, 15);
  // El primer turno es de hace 10 días: solo una semana completa anterior.
  const c = compareWithHistory([], local(2026, 9, 28, 9), now);
  assert.deepEqual(c, { status: "insufficient", completeWeeks: 1, weeks: 4 });
  // Sin ningún turno guardado, ninguna.
  assert.deepEqual(compareWithHistory([], null, now), { status: "insufficient", completeWeeks: 0, weeks: 4 });
});

test("con cuatro semanas de historial, media del mismo tramo; una semana vacía cuenta como cero", () => {
  const now = local(2026, 10, 7, 15); // miércoles
  const veces = [
    ...semanal(3),                                       // 100 en cada una de las tres últimas
    { at: local(2026, 10, 6, 10), total: 150 },          // esta semana
    { at: local(2026, 10, 1, 9), total: 9999 },          // jueves de la semana pasada: fuera del tramo
  ];
  // La cuarta semana atrás está cubierta (el primer turno es anterior) pero vacía.
  const c = compareWithHistory(veces, local(2026, 8, 1), now);
  assert.equal(c.status, "ok");
  if (c.status !== "ok") return;
  assert.equal(c.current, 150);
  assert.equal(c.average, 75, "(100+100+100+0)/4: el jueves pasado no entra en un tramo que acaba el miércoles");
  assert.equal(c.ratio, 2);
});

test("una media de cero no divide: el ratio va a null", () => {
  const c = compareWithHistory([{ at: local(2026, 10, 6, 10), total: 5 }], local(2026, 1, 1), local(2026, 10, 7, 15));
  assert.equal(c.status, "ok");
  if (c.status === "ok") assert.equal(c.ratio, null);
});

// ── JSON ────────────────────────────────────────────────────────────────

test("el JSON lleva fechas en ISO, filas homogéneas y avisa de que la ventana es una estimación", () => {
  const r = buildQuota({
    turns: [turno("2026-10-07T10:00:00", "/a", 100), turno("2026-10-07T10:30:00", null, 100)],
    firstTurnAt: new Map(), now: local(2026, 10, 7, 12), bucketOf: porCarpeta,
  });
  const j = quotaToJson(r) as {
    windowIsEstimate: boolean; agents: { week: { projects: Record<string, unknown>[] } }[]; excluded: unknown[];
  };
  assert.equal(j.windowIsEstimate, true);
  assert.deepEqual(Object.keys(j.agents[0]!.week.projects[0]!).sort(),
    ["cacheRead", "cacheWrite", "folder", "input", "listCostMicroUsd", "output", "projectId", "projectName", "share", "total"]);
  assert.equal(j.agents[0]!.week.projects[1]!["projectId"], null);
  assert.deepEqual(j.excluded, []);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(j)));
});

// ---------------------------------------------------------------------------

function turnoGuardado(turnId: string, repoPath: string | null, at: string, cacheRead = 100): AgentTurn {
  return {
    agent: "claude-code", turnId, sessionId: "s", at: new Date(at), model: "claude-sonnet-4-6",
    repoPath, branch: "main", tokens: tok(cacheRead), producerVersion: null,
  };
}

// ── La ventana que dio Claude Code (resets_at) ──────────────────────────

test("con un resets_at de hace menos de 5 h, la ventana empieza 5 h antes del reinicio", () => {
  const now = local(2026, 10, 7, 15, 0);
  const w = officialWindow({ resetsAt: local(2026, 10, 7, 17, 30), seenAt: local(2026, 10, 7, 14, 50) }, now);
  assert.deepEqual(w, { start: local(2026, 10, 7, 12, 30), end: local(2026, 10, 7, 17, 30) });
});

test("un resets_at visto hace 5 h o más, o ya pasado, no vale: se estima", () => {
  const now = local(2026, 10, 7, 15, 0);
  assert.equal(officialWindow({ resetsAt: local(2026, 10, 7, 17, 0), seenAt: local(2026, 10, 7, 10, 0) }, now), null,
    "visto hace 5 h justas");
  assert.equal(officialWindow({ resetsAt: local(2026, 10, 7, 14, 59), seenAt: local(2026, 10, 7, 14, 0) }, now), null,
    "el reinicio ya pasó: la ventana de ahora es otra que nadie ha visto");
  assert.equal(officialWindow(null, now), null);
});

test("buildQuota usa la ventana oficial solo para Claude Code, y la marca como no estimada", () => {
  const now = local(2026, 10, 7, 15, 0);
  const r = buildQuota({
    turns: [
      { agent: "claude-code", at: local(2026, 10, 7, 12, 0), repoPath: "/a", tokens: tok(5) },  // antes de la ventana oficial
      { agent: "claude-code", at: local(2026, 10, 7, 13, 0), repoPath: "/a", tokens: tok(7) },
      { agent: "codex", at: local(2026, 10, 7, 14, 0), repoPath: "/a", tokens: tok(3) },
    ],
    firstTurnAt: new Map(), now, bucketOf: porCarpeta,
    claudeWindow: { start: local(2026, 10, 7, 12, 30), end: local(2026, 10, 7, 17, 30) },
  });
  const claude = r.agents.find((a) => a.agent === "claude-code")!;
  const codex = r.agents.find((a) => a.agent === "codex")!;
  assert.equal(claude.window!.estimated, false);
  assert.deepEqual(claude.window!.start, local(2026, 10, 7, 12, 30));
  assert.equal(claude.window!.total.total, 7, "lo de antes del inicio oficial no entra");
  assert.equal(codex.window!.estimated, true, "Codex tiene su propia cuota: sigue estimada");
  const j = quotaToJson(r) as { windowIsEstimate: boolean };
  assert.equal(j.windowIsEstimate, true, "hay una ventana estimada (Codex)");
});

// ── --weighted ──────────────────────────────────────────────────────────

test("ponderado: el % sale del precio de lista de cada modelo, no de los tokens", () => {
  const at = local(2026, 10, 7, 10);
  const opus = { agent: "claude-code" as const, at, repoPath: "/caro", model: "claude-opus-4-8",
    tokens: { input: 0, output: 10_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } };   // 10k × 25 $/M = 0,25 $
  const lectura = { agent: "claude-code" as const, at, repoPath: "/barato", model: "claude-sonnet-4-6",
    tokens: { input: 0, output: 0, cacheRead: 100_000, cacheWrite5m: 0, cacheWrite1h: 0 } }; // 100k × 3 $/M × 0,1 = 0,03 $
  const desde = local(2026, 10, 7), hasta = local(2026, 10, 8);

  const tokens = breakdown([opus, lectura], desde, hasta, porCarpeta);
  assert.equal(tokens.weighted, false);
  assert.equal((tokens.rows[0]!.bucket as { projectId: string }).projectId, "/barato", "por tokens gana la caché");

  const precio = breakdown([opus, lectura], desde, hasta, porCarpeta, { weighted: true });
  assert.equal(precio.weighted, true);
  assert.ok(precio.listCost > 0);
  const caro = precio.rows[0]!;
  assert.equal((caro.bucket as { projectId: string }).projectId, "/caro", "por precio gana Opus: el orden se invierte");
  assert.equal(caro.listCost, 250_000);
  assert.equal(precio.rows[1]!.listCost, 30_000);
  assert.equal(caro.share, 250_000 / 280_000);
  // Mismos tokens en las dos: ponderar solo cambia el %, no las columnas.
  assert.deepEqual(precio.total, tokens.total);
});

test("ponderado: un modelo sin precio cuenta como 0 y se cuenta aparte", () => {
  const at = local(2026, 10, 7, 10);
  const b = breakdown([
    { agent: "claude-code", at, repoPath: "/a", model: "modelo-que-no-existe", tokens: tok(1000) },
    { agent: "claude-code", at, repoPath: "/b", model: "claude-sonnet-4-6", tokens: tok(10) },
  ], local(2026, 10, 7), local(2026, 10, 8), porCarpeta, { weighted: true });
  assert.equal(b.unpriced, 1);
  assert.equal(b.rows[0]!.share, 1, "todo el % es del único con precio");
});
