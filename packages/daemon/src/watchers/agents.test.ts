import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { type AgentScan, scanAgents } from "./agents.js";

function claudeRoot(lines: readonly unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "estela-agents-cc-"));
  const proyecto = join(root, "-Users-test-proyecto");
  mkdirSync(proyecto, { recursive: true });
  writeFileSync(join(proyecto, "s.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  return root;
}

function codexRoot(lines: readonly unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "estela-agents-cx-"));
  const dia = join(root, "2026", "08", "21");
  mkdirSync(dia, { recursive: true });
  writeFileSync(join(dia, "rollout-2026-08-21T12-00-00-a.jsonl"),
    lines.map((l) => JSON.stringify(l)).join("\n"));
  return root;
}

const asistente = (id: string, cwd = "/Users/test/proyecto") => ({
  type: "assistant", timestamp: "2026-08-21T12:00:00.000Z", cwd,
  gitBranch: "main", version: "2.1.238", sessionId: "s1",
  message: { id, model: "claude-opus-5", usage: { input_tokens: 10, output_tokens: 5 } },
});

const rolloutCodex = [
  { type: "session_meta", ordinal: 0, timestamp: "2026-08-21T12:00:00.000Z",
    payload: { session_id: "cx1", cwd: "/Users/test/proyecto", cli_version: "0.144.5",
               git: { branch: "main" } } },
  { type: "turn_context", ordinal: 1, timestamp: "2026-08-21T12:00:00.000Z",
    payload: { turn_id: "t1", model: "gpt-5.6-terra" } },
  { type: "event_msg", ordinal: 2, timestamp: "2026-08-21T12:00:00.000Z",
    payload: { type: "token_count",
               info: { last_token_usage: { input_tokens: 7, output_tokens: 3 } } } },
];

test("escanea todos los agentes y los devuelve por separado", async () => {
  const scans = await scanAgents({
    roots: { claudeCode: claudeRoot([asistente("m1")]), codex: codexRoot(rolloutCodex) },
  });

  // Por separado y no mezclados: `logScan` guarda un informe por agente, y un
  // cambio de formato en uno no debe quedar tapado por la salud del otro.
  const porAgente = new Map<string, AgentScan>(scans.map((s) => [s.agent, s]));
  assert.deepEqual([...porAgente.keys()].sort(), ["claude-code", "codex", "copilot"]);
  // Con roots propios y sin el de Copilot, no se leen las sesiones reales de VS Code.
  assert.equal(porAgente.get("copilot")!.report.filesRead, 0);
  assert.equal(porAgente.get("claude-code")!.turns.length, 1);
  assert.equal(porAgente.get("codex")!.turns.length, 1);
  assert.equal(porAgente.get("codex")!.turns[0]!.agent, "codex");
});

test("a los turnos de Claude Code se les resuelve el scratchpad", async () => {
  const scratch = "/private/tmp/claude-502/-Users-test-proyecto/abc/scratchpad";
  const scans = await scanAgents({
    roots: {
      claudeCode: claudeRoot([asistente("m1"), asistente("m2", scratch)]),
      codex: codexRoot([]),
    },
  });

  const cc = scans.find((s) => s.agent === "claude-code")!;
  // Sin esto, esas horas se quedan sin proyecto y desaparecen del parte.
  assert.ok(cc.turns.every((t) => t.repoPath === "/Users/test/proyecto"),
    "el turno del scratchpad debe volver a su repositorio");
});

test("un agente sin nada instalado no impide escanear el otro", async () => {
  const scans = await scanAgents({
    roots: { claudeCode: claudeRoot([asistente("m1")]), codex: "/no/existe" },
  });

  assert.equal(scans.length, 3);
  assert.equal(scans.find((s) => s.agent === "codex")!.turns.length, 0);
  assert.equal(scans.find((s) => s.agent === "claude-code")!.turns.length, 1);
});

test("since y repoPaths se aplican a todos los agentes por igual", async () => {
  const scans = await scanAgents({
    roots: { claudeCode: claudeRoot([asistente("m1")]), codex: codexRoot(rolloutCodex) },
    repoPaths: ["/Users/test/otra-cosa"],
  });

  assert.ok(scans.every((s) => s.turns.length === 0),
    "el filtro de repositorio debe valer para los dos, no solo para Claude Code");
});

test("cuenta cuántos turnos se rescataron de un scratchpad", async () => {
  const scratch = "/private/tmp/claude-502/-Users-test-proyecto/abc/scratchpad";
  const scans = await scanAgents({
    roots: {
      claudeCode: claudeRoot([asistente("m1"), asistente("m2", scratch), asistente("m3", scratch)]),
      codex: codexRoot(rolloutCodex),
    },
  });

  // La CLI imprime este número: son horas que sin el rescate no aparecían en
  // ningún proyecto, así que callarlo es peor que no rescatarlas.
  assert.equal(scans.find((s) => s.agent === "claude-code")!.scratchpadsResolved, 2);
  // Codex trabaja en el repositorio, así que ahí nunca hay nada que rescatar.
  assert.equal(scans.find((s) => s.agent === "codex")!.scratchpadsResolved, 0);
});
