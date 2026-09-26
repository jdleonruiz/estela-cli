import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { defaultCopilotRoots, folderFromUri, replayChatLog, scanCopilot } from "./copilot.js";

const T0 = Date.parse("2026-09-20T10:00:00.000Z");

/** Un workspaceStorage de VS Code con una carpeta y sus sesiones. */
function storage(folder: string | null, sessions: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "estela-copilot-"));
  const ws = join(root, "a1b2c3");
  mkdirSync(join(ws, "chatSessions"), { recursive: true });
  if (folder !== null) writeFileSync(join(ws, "workspace.json"), JSON.stringify({ folder }));
  for (const [name, body] of Object.entries(sessions)) writeFileSync(join(ws, "chatSessions", name), body);
  return root;
}

const request = (id: string, start: number, extra: Record<string, unknown> = {}) => ({
  requestId: id, timestamp: start, modelId: "copilot/claude-sonnet-4.5",
  message: { text: "no se lee" }, response: [], ...extra,
});

// El formato antiguo: la sesión entera en un .json.
const sesionJson = JSON.stringify({
  version: 3, sessionId: "s-json", creationDate: T0,
  requests: [
    request("r1", T0, { modelState: { value: 1, completedAt: T0 + 20_000 } }),   // 20 s: solo arranque
    request("r2", T0 + 600_000, { modelState: { value: 1, completedAt: T0 + 600_000 + 8 * 60_000 } }), // agente, 8 min
  ],
});

// El formato nuevo: un registro de cambios que hay que reproducir.
const sesionJsonl = [
  { kind: 0, v: { version: 3, sessionId: "s-jsonl", requests: [] } },
  { kind: 2, k: ["requests"], v: [request("r3", T0 + 3_600_000)] },
  { kind: 1, k: ["requests", 0, "promptTokens"], v: 1200 },
  { kind: 1, k: ["requests", 0, "completionTokens"], v: 300 },
  { kind: 1, k: ["requests", 0, "elapsedMs"], v: 5 * 60_000 },
  // Una petición que se añade y luego se deshace: con `i` la lista se recorta.
  { kind: 2, k: ["requests"], v: [request("deshecha", T0 + 3_700_000)] },
  { kind: 2, k: ["requests"], i: 1 },
].map((l) => JSON.stringify(l)).join("\n") + "\n{\"kind\":1,\"k\":[\"requests\",0,";  // línea a medio escribir

test("lee las dos versiones del formato y marca inicio y fin del trabajo del agente", async () => {
  const root = storage("file:///Users/ana/tienda", { "s1.json": sesionJson, "s2.jsonl": sesionJsonl });
  const { turns, report } = await scanCopilot({ roots: [root] });

  assert.deepEqual(turns.map((t) => t.turnId),
    ["copilot:r1", "copilot:r2", "copilot:r2:end", "copilot:r3", "copilot:r3:end"]);
  assert.ok(turns.every((t) => t.agent === "copilot" && t.repoPath === "/Users/ana/tienda"));
  assert.equal(turns[2]!.at.getTime() - turns[1]!.at.getTime(), 8 * 60_000, "el fin es completedAt");
  assert.equal(turns[4]!.at.getTime() - turns[3]!.at.getTime(), 5 * 60_000, "o el tiempo transcurrido");
  assert.deepEqual([turns[3]!.tokens.input, turns[3]!.tokens.output], [1200, 300]);
  assert.equal(turns[0]!.model, "copilot/claude-sonnet-4.5");
  assert.equal(report.recordsSeen, 3, "la petición deshecha no cuenta");
  assert.equal(report.malformedRecords, 1, "la línea a medio escribir se cuenta, no rompe");
});

test("la carpeta de Windows y la de red salen como ruta, y lo remoto se descarta", () => {
  assert.equal(folderFromUri("file:///c%3A/Users/Ana/tienda"), "C:/Users/Ana/tienda");
  assert.equal(folderFromUri("file:///Users/ana/mi%20proyecto"), "/Users/ana/mi proyecto");
  assert.equal(folderFromUri("file://servidor/equipo/repo"), "//servidor/equipo/repo");
  assert.equal(folderFromUri("vscode-remote://ssh-remote%2Bcaja/home/ana/repo"), null);
  assert.equal(folderFromUri(undefined), null);
});

test("sin carpeta local no hay proyecto: se cuenta y no se inventa", async () => {
  const root = storage(null, { "s1.json": sesionJson });
  const { turns, report } = await scanCopilot({ roots: [root] });
  assert.equal(turns.length, 0);
  assert.equal(report.unknownRecords, 1);
});

test("since y repoPaths filtran como en los demás agentes", async () => {
  const root = storage("file:///c%3A/Users/Ana/tienda", { "s1.json": sesionJson });
  assert.equal((await scanCopilot({ roots: [root], repoPaths: ["C:\\Users\\ana\\tienda"] })).turns.length, 3);
  assert.equal((await scanCopilot({ roots: [root], repoPaths: ["C:/Users/ana/otra"] })).turns.length, 0);
  assert.equal((await scanCopilot({ roots: [root], since: new Date(T0 + 60_000) })).turns.length, 2);
});

test("VS Code no instalado no es un error", async () => {
  const { turns, report } = await scanCopilot({ roots: ["/no/existe"] });
  assert.equal(turns.length, 0);
  assert.equal(report.filesRead, 0);
});

test("dónde busca en cada sistema", () => {
  assert.deepEqual(defaultCopilotRoots("win32", { APPDATA: "C:\\Users\\ana\\AppData\\Roaming" }, "C:\\Users\\ana")[0],
    join("C:\\Users\\ana\\AppData\\Roaming", "Code", "User", "workspaceStorage"));
  assert.deepEqual(defaultCopilotRoots("linux", {}, "/home/ana")[0], join("/home/ana", ".config", "Code", "User", "workspaceStorage"));
  assert.deepEqual(defaultCopilotRoots("darwin", {}, "/Users/ana")[1],
    join("/Users/ana", "Library", "Application Support", "Code - Insiders", "User", "workspaceStorage"));
});

test("el registro de cambios: poner, añadir, recortar y borrar", () => {
  const log = [
    { kind: 0, v: { a: { b: 1 }, list: [1, 2, 3] } },
    { kind: 1, k: ["a", "b"], v: 2 },
    { kind: 2, k: ["list"], v: [4] },
    { kind: 2, k: ["list"], i: 2, v: [9] },
    { kind: 3, k: ["a", "b"] },
  ].map((l) => JSON.stringify(l)).join("\n");
  assert.deepEqual(replayChatLog(log), { state: { a: {}, list: [1, 2, 9] }, malformed: 0 });
});
