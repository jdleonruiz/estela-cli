import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AgentKind, AgentTurn } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { weekStart } from "./metrics/quota.js";

/**
 * `estela quota`, ejecutando la CLI de verdad.
 *
 * Cada prueba corre con un HOME temporal: el refresco lee los transcripts de
 * ~/.claude, y un test no puede ni leer los de quien lo ejecuta ni depender de
 * que existan.
 */

const BIN = join(__dirname, "bin.js");

function estela(home: string, lang: "es" | "en", ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, ESTELA_LANG: lang, NO_COLOR: "1" },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/**
 * Datos fijos para la cuota, válidos a cualquier hora de cualquier día.
 *
 * No sirve la demo: pone las sesiones de Codex por la tarde, y un lunes por
 * la mañana la semana aún no tiene ninguna — estos tests fallaban según el
 * momento en que se ejecutaran. Aquí todo cae a mitad de camino entre el
 * lunes a las 00:00 y ahora, que siempre es esta semana.
 */
function sembrarCuota(dbPath: string): void {
  const ahora = new Date();
  const lunes = weekStart(ahora);
  const enEstaSemana = new Date((lunes.getTime() + ahora.getTime()) / 2);
  const haceSemanas = (n: number) => new Date(lunes.getTime() - n * 7 * 86_400_000 + 3600_000);
  let n = 0;
  const t = (agent: AgentKind, at: Date, repo: string, cacheRead: number): AgentTurn => ({
    agent, turnId: `q${n++}`, sessionId: "s", at, model: "m", repoPath: repo, branch: "main",
    tokens: { input: 1, output: 10, cacheRead, cacheWrite5m: 0, cacheWrite1h: 0 }, producerVersion: null,
  });
  const db = openDatabase(dbPath);
  try {
    store.upsertClient(db, { id: "c", name: "C", currency: "EUR" });
    for (const id of ["web", "api"]) {
      store.upsertProject(db, { id, clientId: "c", name: id, repoPaths: [`/repos/${id}`], billable: true,
        roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
    }
    store.saveTurns(db, [
      // Claude Code: seis semanas de historial, así que compara.
      t("claude-code", haceSemanas(6), "/repos/web", 100),
      t("claude-code", enEstaSemana, "/repos/web", 3000),
      t("claude-code", enEstaSemana, "/repos/api", 1000),
      // Codex: empezó esta semana, así que no hay con qué comparar.
      t("codex", enEstaSemana, "/repos/api", 500),
    ]);
  } finally { db.close(); }
}

function entorno() {
  const home = mkdtempSync(join(tmpdir(), "estela-quota-"));
  return { home, db: join(home, "estela.db") };
}

/** Un transcript de Claude Code con un turno de hace media hora, en `cwd`. */
function transcript(home: string, cwd: string, id: string, cacheRead: number): void {
  const dir = join(home, ".claude", "projects", "-proyecto");
  mkdirSync(dir, { recursive: true });
  const at = new Date(Date.now() - 30 * 60_000).toISOString();
  const linea = JSON.stringify({
    type: "assistant", timestamp: at, cwd, gitBranch: "main", version: "2.1.238", sessionId: "s1",
    message: { id, model: "claude-sonnet-4-6",
      usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: cacheRead,
               cache_creation_input_tokens: 0 } },
  });
  // Dos veces la misma fila: Claude Code repite el turno en el transcript.
  writeFileSync(join(dir, "sesion.jsonl"), `${linea}\n${linea}\n`);
}

test("sin nada guardado, lo dice y sugiere setup en vez de enseñar una tabla vacía", () => {
  const { home, db } = entorno();
  const r = estela(home, "es", "quota", "--db", db, "--no-refresh");
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Sin turnos de agente guardados\. Empieza con: estela setup/);
  assert.match(r.out, /no es el límite de tu plan/);
});

test("refresca los transcripts de esta semana antes de calcular, y un turno repetido cuenta una vez", () => {
  const { home, db } = entorno();
  transcript(home, "/repos/web", "msg_cuota_1", 5000);

  const r = estela(home, "es", "quota", "--db", db, "--json");
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out) as { agents: { agent: string; week: { total: { total: number } } }[] };
  assert.equal(j.agents[0]!.agent, "claude-code");
  // 10 + 100 + 5000, una sola vez aunque el transcript traiga la fila dos veces.
  assert.equal(j.agents[0]!.week.total.total, 5110);

  // Repetirlo no duplica: el turno ya está guardado.
  const otra = JSON.parse(estela(home, "es", "quota", "--db", db, "--json").out) as typeof j;
  assert.equal(otra.agents[0]!.week.total.total, 5110);
});

test("--no-refresh no lee transcripts: usa solo lo ya guardado", () => {
  const { home, db } = entorno();
  transcript(home, "/repos/web", "msg_cuota_2", 5000);
  const r = estela(home, "es", "quota", "--db", db, "--no-refresh", "--json");
  assert.equal(r.code, 0, r.err);
  assert.deepEqual((JSON.parse(r.out) as { agents: unknown[] }).agents, []);
});

test("sobre la base de la demo nunca lee tus transcripts, aunque no se pase --no-refresh", () => {
  // Mezclaría tu trabajo real con los datos inventados, justo lo que la demo
  // promete no hacer.
  const { home } = entorno();
  const demo = join(home, "estela-demo.db");
  openDatabase(demo).close();
  transcript(home, "/repos/web", "msg_real", 5000);

  const r = estela(home, "es", "quota", "--db", demo, "--json");
  assert.equal(r.code, 0, r.err);
  const conn = openDatabase(demo);
  try {
    assert.equal(store.firstTurnByAgent(conn).size, 0, "no se guardó ningún turno real en la demo");
  } finally { conn.close(); }
});

test("--json es JSON y nada más: ni avisos ni cabeceras en la salida", () => {
  const { home, db } = entorno();
  sembrarCuota(db);

  const r = estela(home, "es", "quota", "--db", db, "--no-refresh", "--json");
  assert.equal(r.code, 0, r.err);
  const j = JSON.parse(r.out) as {
    windowIsEstimate: boolean; windowHours: number;
    agents: { agent: string; week: { projects: { projectName: string | null; share: number }[] };
              comparison: { status: string } }[];
  };
  assert.equal(j.windowIsEstimate, true);
  assert.equal(j.windowHours, 5);
  assert.deepEqual(j.agents.map((a) => a.agent), ["claude-code", "codex"]);
  // Seis semanas de Claude Code y Codex recién empezado: uno compara, el otro no.
  assert.equal(j.agents[0]!.comparison.status, "ok");
  assert.equal(j.agents[1]!.comparison.status, "insufficient");
  const shares = j.agents[0]!.week.projects.map((p) => p.share);
  assert.ok(Math.abs(shares.reduce((s, x) => s + x, 0) - 1) < 0.001, "los porcentajes suman el 100 %");
});

test("la salida en texto, en los dos idiomas, sin promesas sobre lo que queda", () => {
  const { home, db } = entorno();
  sembrarCuota(db);

  const es = estela(home, "es", "quota", "--db", db, "--no-refresh").out;
  assert.match(es, /Claude Code — esta semana \(lun \d+ \w+ → hoy\)/);
  assert.match(es, /Proyecto\s+Entrada\s+Salida\s+Lect\. caché\s+Escr\. caché\s+Total\s+%/);
  assert.match(es, /Sin historial suficiente para comparar: hacen falta 4 semanas completas y hay \d\./);
  assert.match(es, /La ventana de 5 h es una estimación/);

  const en = estela(home, "en", "quota", "--db", db, "--no-refresh").out;
  assert.match(en, /Claude Code — this week \(Mon \w+ \d+ → today\)/);
  assert.match(en, /Project\s+Input\s+Output\s+Cache read\s+Cache write\s+Total\s+%/);
  assert.match(en, /The 5-hour window is an estimate/);

  // La regla que no se rompe: nada de "te quedan" ni de cuándo se acaba.
  for (const out of [es, en]) {
    assert.doesNotMatch(out, /te quedan|quedan \d|se te acaba|you have \d|left until|runs out/i);
  }
});

test("Copilot queda fuera, y se dice en una línea", () => {
  const { home, db } = entorno();
  const conn = openDatabase(db);
  try {
    store.saveTurns(conn, [{
      agent: "copilot", turnId: "copilot:1:end", sessionId: "s", at: new Date(Date.now() - 60_000),
      model: "gpt-4o", repoPath: "/repos/web", branch: null,
      tokens: { input: 900, output: 100, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      producerVersion: null,
    }]);
  } finally { conn.close(); }

  const r = estela(home, "es", "quota", "--db", db, "--no-refresh");
  assert.match(r.out, /Copilot no guarda tokens fiables y queda fuera de este cálculo\./);
  assert.match(r.out, /Sin consumo de Claude Code ni Codex esta semana\./);
  const j = JSON.parse(estela(home, "es", "quota", "--db", db, "--no-refresh", "--json").out) as {
    agents: unknown[]; excluded: { agent: string }[];
  };
  assert.deepEqual(j.agents, []);
  assert.deepEqual(j.excluded.map((e) => e.agent), ["copilot"]);
});
