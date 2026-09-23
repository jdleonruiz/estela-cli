import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scanCodex } from "./codex.js";

/** Monta un store de rollouts falso: ~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl */
function fixture(lines: readonly unknown[], nombre = "rollout-2026-08-21T12-00-00-abc.jsonl"): string {
  const root = mkdtempSync(join(tmpdir(), "estela-codex-"));
  const dia = join(root, "2026", "08", "21");
  mkdirSync(dia, { recursive: true });
  writeFileSync(join(dia, nombre),
    lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  return root;
}

let ordinal = 0;
function linea(type: string, payload: Record<string, unknown>, timestamp = "2026-08-21T12:00:00.000Z") {
  return { type, ordinal: ordinal++, timestamp, payload };
}

function sessionMeta(overrides: Record<string, unknown> = {}) {
  return linea("session_meta", {
    session_id: "sess-1",
    cwd: "/Users/test/proyecto",
    cli_version: "0.144.5",
    git: { commit_hash: "abc123", branch: "main" },
    ...overrides,
  });
}

function turnContext(turnId: string, overrides: Record<string, unknown> = {}) {
  return linea("turn_context", {
    turn_id: turnId, cwd: "/Users/test/proyecto", model: "gpt-5.6-terra", ...overrides,
  });
}

function taskStarted(turnId: string) {
  return linea("event_msg", { type: "task_started", turn_id: turnId });
}

/**
 * `last_token_usage` es lo de esta llamada; `total_token_usage` es el acumulado
 * de la sesión. En un rollout real la suma de los `last` cuadra exactamente con
 * el último `total`.
 */
function tokenCount(last: Record<string, number>, total: Record<string, number>,
                    timestamp = "2026-08-21T12:00:00.000Z") {
  return linea("event_msg", {
    type: "token_count",
    info: { last_token_usage: last, total_token_usage: total, model_context_window: 258400 },
    rate_limits: {},
  }, timestamp);
}

// Realista: `input_tokens` es el prompt entero y la caché es una PARTE de él,
// así que 1000 de entrada de los que 900 venían de caché y 50 se escribieron.
const USO = { input_tokens: 1000, cached_input_tokens: 900, cache_write_input_tokens: 50,
              output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 1020 };

test("cada token_count es un turno, con modelo, repositorio y rama", async () => {
  ordinal = 0;
  const root = fixture([
    sessionMeta(),
    taskStarted("t1"),
    turnContext("t1"),
    tokenCount(USO, USO),
  ]);

  const { turns } = await scanCodex({ root });

  assert.equal(turns.length, 1);
  const t = turns[0]!;
  assert.equal(t.agent, "codex");
  assert.equal(t.sessionId, "sess-1");
  assert.equal(t.model, "gpt-5.6-terra");
  assert.equal(t.repoPath, "/Users/test/proyecto");
  // Codex escribe la rama; a Claude Code hay que inferírsela.
  assert.equal(t.branch, "main");
  assert.equal(t.producerVersion, "0.144.5");
  // 1000 de prompt menos 900 de caché y 50 escritos: 50 se pagan a precio lleno.
  assert.equal(t.tokens.input, 50);
  assert.equal(t.tokens.output, 20);
  assert.equal(t.tokens.cacheRead, 900);
});

test("suma last_token_usage y nunca total_token_usage", async () => {
  ordinal = 0;
  // Esto es lo que hunde una factura: `total` es acumulado. Sumarlo por evento
  // multiplica el coste. Con estos tres, `last` da 300 y `total` daría 600.
  const last = (n: number) => ({ input_tokens: n, cached_input_tokens: 0, output_tokens: 0, total_tokens: n });
  const root = fixture([
    sessionMeta(),
    taskStarted("t1"),
    turnContext("t1"),
    tokenCount(last(100), last(100)),
    tokenCount(last(100), last(200)),
    tokenCount(last(100), last(300)),
  ]);

  const { turns } = await scanCodex({ root });

  const total = turns.reduce((s: number, t) => s + t.tokens.input, 0);
  assert.equal(total, 300, "debe sumar los last (300), no los total (600)");
});

test("la escritura de caché se imputa al TTL corto", async () => {
  ordinal = 0;
  // Codex no desglosa el TTL de la caché. Igual que en claude.ts, ante la duda
  // se usa el multiplicador más bajo: se subestima en vez de inflar la factura.
  const root = fixture([
    sessionMeta(), taskStarted("t1"), turnContext("t1"), tokenCount(USO, USO),
  ]);

  const { turns } = await scanCodex({ root });

  assert.equal(turns[0]!.tokens.cacheWrite5m, 50);
  assert.equal(turns[0]!.tokens.cacheWrite1h, 0);
});

test("los tipos internos se ignoran sin contarse como error", async () => {
  ordinal = 0;
  const root = fixture([
    sessionMeta(), taskStarted("t1"), turnContext("t1"), tokenCount(USO, USO),
    linea("response_item", { type: "message" }),
    linea("world_state", { anything: 1 }),
    linea("event_msg", { type: "thread_settings_applied", thread_settings: {} }),
    linea("event_msg", { type: "item_completed", item: {} }),
    linea("event_msg", { type: "task_complete", turn_id: "t1", duration_ms: 1234 }),
  ]);

  const { turns, report } = await scanCodex({ root });

  assert.equal(turns.length, 1);
  assert.equal(report.malformedRecords, 0, "lo desconocido no es un error");
  assert.ok(report.unknownRecords >= 5);
});

test("una línea a medio escribir se cuenta y no tumba el escaneo", async () => {
  ordinal = 0;
  const root = fixture([
    sessionMeta(), taskStarted("t1"), turnContext("t1"),
    tokenCount(USO, USO),
    '{"type":"event_msg","ordinal":99,"payload":{"type":"token_',
  ]);

  const { turns, report } = await scanCodex({ root });

  assert.equal(turns.length, 1);
  assert.equal(report.malformedRecords, 1);
});

test("el canario avisa cuando demasiados registros conocidos vienen rotos", async () => {
  ordinal = 0;
  const rotos = Array.from({ length: 20 }, () =>
    ({ type: "event_msg", ordinal: ordinal++, timestamp: "2026-08-21T12:00:00.000Z",
       payload: { type: "token_count", info: { last_token_usage: "no soy un objeto" } } }));
  const root = fixture([sessionMeta(), taskStarted("t1"), turnContext("t1"), ...rotos]);

  const { report } = await scanCodex({ root });

  assert.ok(report.warnings.length > 0, "debe avisar de que el formato pudo cambiar");
  assert.match(report.warnings.join(" "), /Codex/);
});

test("since descarta lo anterior a la fecha", async () => {
  ordinal = 0;
  const root = fixture([
    sessionMeta(), taskStarted("t1"), turnContext("t1"),
    tokenCount(USO, USO, "2026-08-01T10:00:00.000Z"),
    tokenCount(USO, USO, "2026-08-30T10:00:00.000Z"),
  ]);

  const { turns } = await scanCodex({ root, since: new Date("2026-08-15T00:00:00.000Z") });

  assert.equal(turns.length, 1);
  assert.equal(turns[0]!.at.toISOString(), "2026-08-30T10:00:00.000Z");
});

test("repoPaths deja fuera los proyectos que no son", async () => {
  ordinal = 0;
  const root = fixture([
    sessionMeta(), taskStarted("t1"), turnContext("t1", { cwd: "/Users/test/otro" }),
    tokenCount(USO, USO),
  ]);

  const { turns } = await scanCodex({ root, repoPaths: ["/Users/test/proyecto"] });

  assert.equal(turns.length, 0);
});

test("el mismo rollout leído dos veces no duplica turnos", async () => {
  ordinal = 0;
  const lineas = [sessionMeta(), taskStarted("t1"), turnContext("t1"), tokenCount(USO, USO)];
  // El mismo contenido en dos ficheros del mismo día: mismo session_id y mismos
  // ordinales, así que es el mismo turno leído dos veces.
  const root = fixture(lineas, "rollout-2026-08-21T12-00-00-abc.jsonl");
  const dia = join(root, "2026", "08", "21");
  writeFileSync(join(dia, "rollout-2026-08-21T12-00-00-abc-copia.jsonl"),
    lineas.map((l) => JSON.stringify(l)).join("\n"));

  const { turns, report } = await scanCodex({ root });

  assert.equal(turns.length, 1);
  assert.equal(report.duplicatesDropped, 1);
});

test("sin carpeta de Codex devuelve vacío, no explota", async () => {
  const { turns, report } = await scanCodex({ root: "/no/existe/en/ningun/sitio" });

  assert.equal(turns.length, 0);
  assert.equal(report.filesRead, 0);
});

test("la caché no se cobra dos veces: va dentro de input_tokens", async () => {
  ordinal = 0;
  // Comprobado en los 68 eventos de un rollout real: total = input + output,
  // así que `cached_input_tokens` es una PARTE de `input_tokens`, no algo que
  // se suma. Anthropic lo hace al revés y ahí la caché sí va aparte.
  //
  // Si no se resta, la parte cacheada se cobra a precio completo Y otra vez al
  // 10%. Sobre datos reales eso era un 4.6x de más en una factura.
  const root = fixture([
    sessionMeta(), taskStarted("t1"), turnContext("t1"),
    tokenCount({ input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20, total_tokens: 1020 },
               { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 20, total_tokens: 1020 }),
  ]);

  const { turns } = await scanCodex({ root });

  assert.equal(turns[0]!.tokens.input, 100, "solo lo que NO estaba cacheado");
  assert.equal(turns[0]!.tokens.cacheRead, 900);
  // Y la suma sigue cuadrando con lo que Codex dice que gastó.
  assert.equal(turns[0]!.tokens.input + turns[0]!.tokens.cacheRead, 1000);
});

test("un input más pequeño que la caché no produce tokens negativos", async () => {
  ordinal = 0;
  const root = fixture([
    sessionMeta(), taskStarted("t1"), turnContext("t1"),
    tokenCount({ input_tokens: 10, cached_input_tokens: 999, output_tokens: 1, total_tokens: 11 },
               { input_tokens: 10, cached_input_tokens: 999, output_tokens: 1, total_tokens: 11 }),
  ]);

  const { turns } = await scanCodex({ root });

  assert.equal(turns[0]!.tokens.input, 0, "nunca negativo, aunque el origen no cuadre");
});
