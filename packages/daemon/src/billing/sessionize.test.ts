import assert from "node:assert/strict";
import { test } from "node:test";

import type { AgentTurn, CommitRecord } from "@estela/shared";

import {
  groupByBranchAndDay, sessionize, sessionizeCommits, withoutOverlap, type WorkBlock,
} from "./sessionize.js";

// --- Trabajo sin agente ------------------------------------------------------

function commit(hash: string, iso: string, repo = "/r", branch = "main"): CommitRecord {
  return {
    repoPath: repo, hash, at: new Date(iso), authorEmail: "yo@ejemplo.com", authorName: "Yo",
    branch, subject: `commit ${hash}`, linesAdded: 1, linesDeleted: 0, files: [],
  };
}

test("sin turnos de agente, los commits siguen produciendo trabajo", () => {
  // El caso que motiva todo esto: alguien programa sin IA. sessionize() da cero
  // bloques y sus horas desaparecían del parte.
  assert.equal(sessionize([]).length, 0);

  const blocks = sessionizeCommits([
    commit("a", "2026-08-27T10:00:00Z"),
    commit("b", "2026-08-27T10:40:00Z"),
  ], { leadInMinutes: 25 });

  assert.equal(blocks.length, 1);
  // 25 min antes del primero + los 40 entre ambos.
  assert.equal(blocks[0]!.seconds, 65 * 60);
  assert.equal(blocks[0]!.turnCount, 0);
  assert.equal(blocks[0]!.aiCost.microUsd, 0);
});

test("un hueco largo entre commits parte la tanda", () => {
  const blocks = sessionizeCommits([
    commit("a", "2026-08-27T09:00:00Z"),
    commit("b", "2026-08-27T16:00:00Z"),
  ], { gapMinutes: 90 });
  assert.equal(blocks.length, 2);
});

test("un commit suelto dura el lead-in, no cero", () => {
  const blocks = sessionizeCommits([commit("a", "2026-08-27T09:00:00Z")],
    { leadInMinutes: 25 });
  assert.equal(blocks[0]!.seconds, 25 * 60);
});

test("los repositorios no se mezclan en una misma tanda", () => {
  const blocks = sessionizeCommits([
    commit("a", "2026-08-27T09:00:00Z", "/uno"),
    commit("b", "2026-08-27T09:10:00Z", "/dos"),
  ]);
  assert.equal(blocks.length, 2);
});

test("el trabajo ya cubierto por un agente no se cuenta dos veces", () => {
  // Un commit dentro de una sesión de agente: el rato ya está facturado.
  const agent: WorkBlock[] = [{
    startedAt: new Date("2026-08-27T09:00:00Z"),
    endedAt: new Date("2026-08-27T11:00:00Z"),
    seconds: 7200, repoPath: "/r", branch: "main", turnCount: 12,
    aiCost: { microUsd: 0 }, models: [], sessionIds: [], commits: [],
    unpricedModels: [],
  }];

  const solapado = sessionizeCommits([commit("a", "2026-08-27T10:30:00Z")]);
  assert.equal(withoutOverlap(solapado, agent).length, 0);

  const aparte = sessionizeCommits([commit("b", "2026-08-27T18:00:00Z")]);
  assert.equal(withoutOverlap(aparte, agent).length, 1);
});

test("el lead-in por defecto subestima: nunca imputa una jornada entera", () => {
  // Estas horas se facturan. Ante la duda, quedarse corto.
  const blocks = sessionizeCommits([commit("a", "2026-08-27T18:00:00Z")]);
  assert.ok(blocks[0]!.seconds <= 30 * 60,
    `un commit suelto imputó ${blocks[0]!.seconds}s`);
});

/* ── Abrir el agente desde subcarpetas del mismo repositorio ─────────────
   El fallo real: `estela` guarda cada bloque con el id
   `te_<proyecto>_<día>_<rama>`. Si la agrupación separa por ruta, un día
   trabajado desde `repo/` y desde `repo/src/UI` produce dos bloques con ese
   MISMO id, y el segundo pisa al primero al guardarse. Un día con 1h 10m
   medidas quedó registrado como 3m. */

test("los bloques de varias carpetas del mismo proyecto se fusionan en uno", () => {
  const base = new Date("2026-09-07T12:00:00Z");
  const turno = (repoPath: string, minuto: number): AgentTurn => ({
    turnId: repoPath + minuto, agent: "claude-code", sessionId: "s" + repoPath,
    at: new Date(base.getTime() + minuto * 60_000), model: "claude-sonnet-5",
    repoPath, branch: "feature/x",
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    producerVersion: "1",
  });

  const raiz = "/repo";
  const sub = "/repo/src/UI";
  const bloques = sessionize([
    turno(raiz, 0), turno(raiz, 1), turno(raiz, 2),
    turno(sub, 10), turno(sub, 11), turno(sub, 12),
  ]);

  // Por ruta —lo que hacía antes— salen dos, y con el mismo id se pisarían.
  assert.equal(groupByBranchAndDay(bloques).length, 2);

  // Por proyecto sale uno solo, con la suma de los dos.
  const porProyecto = groupByBranchAndDay(bloques, () => "portal-ventas");
  assert.equal(porProyecto.length, 1, "un proyecto, un día y una rama son UN concepto");
  assert.equal(porProyecto[0]!.seconds,
    bloques.reduce((t, b) => t + b.seconds, 0),
    "no se puede perder ni un segundo por abrir el agente en otra carpeta");
});

test("dos sesiones a la vez en el mismo proyecto no se cobran dos veces", () => {
  // Claude Code abierto en `repo/` y en `repo/src/UI` al mismo tiempo. Son
  // dos bloques que se solapan en el reloj: sumar sus duraciones facturaría
  // dos veces el mismo rato.
  const base = new Date("2026-09-07T12:00:00Z");
  const turno = (repoPath: string, minuto: number): AgentTurn => ({
    turnId: repoPath + minuto, agent: "claude-code", sessionId: "s" + repoPath,
    at: new Date(base.getTime() + minuto * 60_000), model: "claude-sonnet-5",
    repoPath, branch: "feature/x",
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    producerVersion: "1",
  });

  // 0→10 en la raíz y 5→12 en la subcarpeta: se pisan cinco minutos.
  const bloques = sessionize([
    turno("/repo", 0), turno("/repo", 10),
    turno("/repo/src/UI", 5), turno("/repo/src/UI", 12),
  ]);
  assert.equal(bloques.length, 2);

  const suma = bloques.reduce((t, b) => t + b.seconds, 0);
  const [fusionado] = groupByBranchAndDay(bloques, () => "proyecto");

  assert.ok(fusionado!.seconds < suma,
    "lo solapado se cuenta una vez, no dos");
  assert.equal(fusionado!.seconds,
    Math.round((fusionado!.endedAt.getTime() - fusionado!.startedAt.getTime()) / 1000),
    "solapados de punta a punta, el bloque dura lo que va del primero al último");
});

test("sin solape, fusionar sigue sumando igual que antes", () => {
  const base = new Date("2026-09-07T12:00:00Z");
  const turno = (repoPath: string, minuto: number): AgentTurn => ({
    turnId: repoPath + minuto, agent: "claude-code", sessionId: "s" + repoPath,
    at: new Date(base.getTime() + minuto * 60_000), model: "claude-sonnet-5",
    repoPath, branch: "feature/x",
    tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    producerVersion: "1",
  });

  // Mañana en una carpeta, tarde en la otra: no se tocan.
  const bloques = sessionize([
    turno("/repo", 0), turno("/repo", 5),
    turno("/repo/src/UI", 300), turno("/repo/src/UI", 310),
  ]);
  const suma = bloques.reduce((t, b) => t + b.seconds, 0);
  const [fusionado] = groupByBranchAndDay(bloques, () => "proyecto");
  assert.equal(fusionado!.seconds, suma, "sin solape no se pierde ni un segundo");
});
