import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveScratchpads, scanClaudeCode } from "./claude.js";

/** Monta un store de transcripts falso con las líneas dadas. */
function fixture(lines: readonly unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "estela-test-"));
  const project = join(root, "-Users-test-proyecto");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "session.jsonl"),
    lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  return root;
}

function assistant(id: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "assistant",
    timestamp: "2026-08-21T12:00:00.000Z",
    cwd: "/Users/test/proyecto",
    gitBranch: "main",
    version: "2.1.238",
    sessionId: "sess-1",
    message: {
      id,
      model: "claude-opus-5",
      usage: {
        input_tokens: 10,
        output_tokens: 100,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 500,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 500 },
      },
    },
    ...overrides,
  };
}

test("deduplica por message.id: el mismo turno repetido cuenta una vez", async () => {
  // Reproduce lo observado en transcripts reales: el mismo turno hasta 5 veces.
  const root = fixture([
    assistant("msg_A"), assistant("msg_A"), assistant("msg_A"),
    assistant("msg_A"), assistant("msg_A"),
    assistant("msg_B"),
  ]);

  const { turns, report } = await scanClaudeCode({ root });

  assert.equal(turns.length, 2, "deben quedar 2 turnos únicos");
  assert.equal(report.duplicatesDropped, 4);
  assert.equal(report.recordsSeen, 6);
});

test("los registros internos se ignoran sin contarse como error", async () => {
  const root = fixture([
    assistant("msg_A"),
    { type: "atis-latch", sessionId: "s" },
    { type: "bridge-session", sessionId: "s" },
    { type: "ai-title", aiTitle: "x", sessionId: "s" },
    { type: "queue-operation", operation: "x", sessionId: "s" },
    { type: "file-history-snapshot", snapshot: {} },
    { type: "user", message: {} },
  ]);

  const { turns, report } = await scanClaudeCode({ root });

  assert.equal(turns.length, 1);
  assert.equal(report.unknownRecords, 6);
  assert.equal(report.malformedRecords, 0, "lo interno no es un error");
});

test("una clave nueva desconocida no rompe el parseo", async () => {
  const root = fixture([
    assistant("msg_A", { campoDelFuturo: { anidado: true }, otraCosa: [1, 2, 3] }),
  ]);

  const { turns, report } = await scanClaudeCode({ root });

  assert.equal(turns.length, 1);
  assert.equal(report.malformedRecords, 0);
  assert.equal(turns[0]!.tokens.output, 100);
});

test("desglosa los TTL de caché, que cuestan distinto", async () => {
  const root = fixture([assistant("msg_A")]);
  const { turns } = await scanClaudeCode({ root });

  assert.equal(turns[0]!.tokens.cacheWrite1h, 500);
  assert.equal(turns[0]!.tokens.cacheWrite5m, 0);
});

test("sin desglose de TTL, imputa al multiplicador más bajo", async () => {
  // Ante la duda subestimar: inflar una factura es peor que quedarse corto.
  const root = fixture([
    assistant("msg_A", {
      message: {
        id: "msg_A", model: "claude-opus-5",
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0,
                 cache_creation_input_tokens: 800 },
      },
    }),
  ]);

  const { turns } = await scanClaudeCode({ root });
  assert.equal(turns[0]!.tokens.cacheWrite5m, 800);
  assert.equal(turns[0]!.tokens.cacheWrite1h, 0);
});

test("una línea a medio escribir se cuenta pero no rompe el escaneo", async () => {
  const root = fixture([
    assistant("msg_A"),
    '{"type":"assistant","message":{"id":"msg_trunc"',  // sesión viva
    assistant("msg_B"),
  ]);

  const { turns, report } = await scanClaudeCode({ root });

  assert.equal(turns.length, 2);
  assert.equal(report.malformedRecords, 1);
});

test("un registro sin timestamp o sin modelo se descarta como malformado", async () => {
  const root = fixture([
    { type: "assistant", message: { id: "x", model: "claude-opus-5" } },        // sin timestamp
    { type: "assistant", timestamp: "2026-08-21T12:00:00Z", message: { id: "y" } }, // sin modelo
    assistant("msg_ok"),
  ]);

  const { turns, report } = await scanClaudeCode({ root });

  assert.equal(turns.length, 1);
  assert.equal(report.malformedRecords, 2);
});

test("filtra por fecha y por repositorio", async () => {
  const root = fixture([
    assistant("msg_viejo", { timestamp: "2026-01-01T00:00:00.000Z" }),
    assistant("msg_nuevo", { timestamp: "2026-08-21T00:00:00.000Z" }),
    assistant("msg_otro", { cwd: "/Users/test/otro-proyecto" }),
  ]);

  const porFecha = await scanClaudeCode({ root, since: new Date("2026-06-01T00:00:00Z") });
  assert.equal(porFecha.turns.length, 2);

  const porRepo = await scanClaudeCode({ root, repoPaths: ["/Users/test/otro-proyecto"] });
  assert.equal(porRepo.turns.length, 1);
  assert.equal(porRepo.turns[0]!.turnId, "msg_otro");
});

test("registra las versiones que escribieron el store", async () => {
  const root = fixture([
    assistant("msg_A", { version: "2.1.183" }),
    assistant("msg_B", { version: "2.1.238" }),
  ]);

  const { report } = await scanClaudeCode({ root });
  assert.deepEqual(report.producerVersions, ["2.1.183", "2.1.238"]);
});

test("un store inexistente devuelve vacío en vez de lanzar", async () => {
  const { turns, report } = await scanClaudeCode({ root: "/ruta/que/no/existe" });
  assert.equal(turns.length, 0);
  assert.equal(report.filesRead, 0);
});

// ── Scratchpads ────────────────────────────────────────────────────────

test("devuelve al repositorio el trabajo hecho en un scratchpad", async () => {
  // El fallo que esto previene: Claude Code trabaja parte del tiempo en un
  // directorio temporal cuyo cwd no es el repositorio. Ese trabajo se quedaba
  // sin imputar — en una jornada medida, casi la mitad de los turnos.
  const root = fixture([
    assistant("msg_repo", { cwd: "/Users/ana/Proyectos/mi_repo" }),
    assistant("msg_scratch", {
      cwd: "/private/tmp/claude-502/-Users-ana-Proyectos-mi-repo/abc-123/scratchpad",
    }),
  ]);

  const { turns } = await scanClaudeCode({ root });
  const fixed = resolveScratchpads(turns);

  assert.equal(fixed.length, 2);
  for (const turn of fixed) {
    assert.equal(turn.repoPath, "/Users/ana/Proyectos/mi_repo",
      "los dos turnos deben apuntar al mismo repositorio");
  }
});

test("un scratchpad sin repositorio conocido se queda como está", async () => {
  // Mejor sin imputar que imputado al proyecto equivocado: una hora en la
  // factura de otro cliente es peor que una hora que falta.
  const root = fixture([
    assistant("msg_a", { cwd: "/Users/ana/Proyectos/otro_repo" }),
    assistant("msg_b", {
      cwd: "/private/tmp/claude-502/-Users-ana-Proyectos-desconocido/x/scratchpad",
    }),
  ]);

  const fixed = resolveScratchpads((await scanClaudeCode({ root })).turns);
  const scratch = fixed.find((t) => t.turnId === "msg_b")!;
  assert.ok(scratch.repoPath!.includes("scratchpad"), "sin cambios");
});

test("las rutas normales no se tocan", async () => {
  const root = fixture([assistant("msg_a", { cwd: "/Users/ana/Proyectos/repo" })]);
  const fixed = resolveScratchpads((await scanClaudeCode({ root })).turns);
  assert.equal(fixed[0]!.repoPath, "/Users/ana/Proyectos/repo");
});
