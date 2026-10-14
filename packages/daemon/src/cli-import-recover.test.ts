import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { localDate } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { normalizePath } from "./paths.js";

/**
 * `estela import` y las horas de subcarpetas y worktrees, como lo vive quien
 * actualiza: la primera vez que cambiarían horas ya importadas se enseñan y se
 * pide permiso; sin terminal no se aplica nada; con --yes, sí.
 */

const BIN = join(__dirname, "bin.js");
const n = (p: string) => normalizePath(p);

function escenario() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "estela-recover-")));
  const main = join(home, "repos", "web");
  mkdirSync(join(main, ".git", "worktrees", "wt"), { recursive: true });
  writeFileSync(join(main, ".git", "worktrees", "wt", "commondir"), "../..\n");
  const wt = join(home, "repos", "web-wt");
  mkdirSync(wt, { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(main, ".git", "worktrees", "wt")}\n`);
  const db = join(home, ".estela", "estela.db");
  mkdirSync(join(home, ".estela"), { recursive: true });
  const conn = openDatabase(db);
  try {
    store.upsertClient(conn, { id: "c", name: "C", currency: "EUR" });
    store.upsertProject(conn, { id: "web", clientId: "c", name: "Web", repoPaths: [n(main)], billable: true,
      roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  } finally { conn.close(); }
  const transcript = join(home, ".claude", "projects", "-repos", "s.jsonl");
  mkdirSync(join(transcript, ".."), { recursive: true });
  writeFileSync(transcript, "");
  return { home, main, wt, db, transcript, marca: join(home, ".estela", ".recover-git-root") };
}

let k = 0;
/** `minutos` turnos de Claude Code, uno por minuto, en `cwd` desde `start`. */
function sesion(file: string, cwd: string, start: Date, minutos: number, branch = "main"): void {
  let out = "";
  for (let i = 0; i < minutos; i++) {
    out += JSON.stringify({
      type: "assistant", timestamp: new Date(start.getTime() + i * 60_000).toISOString(), cwd, gitBranch: branch,
      version: "2.1.238", sessionId: `s-${cwd}`,
      message: { id: `m${k++}`, model: "claude-sonnet-4-6",
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } },
    }) + "\n";
  }
  appendFileSync(file, out);
}

function estela(home: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", input: "",
    env: { ...process.env, HOME: home, USERPROFILE: home, ESTELA_LANG: "es", NO_COLOR: "1" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function ramas(db: string): string[] {
  const c = openDatabase(db);
  try { return store.getTimeEntries(c, "web").map((e) => e.branch ?? "").sort(); } finally { c.close(); }
}

const dia = (d: number, h = 10) => new Date(2026, 9, d, h, 0);

test("tras actualizar: vista previa, sin terminal no se aplica, con --yes sí, y no se vuelve a preguntar", () => {
  const { home, main, wt, db, transcript, marca } = escenario();
  sesion(transcript, main, dia(5), 30);
  assert.equal(estela(home, "import", "--db", db).code, 0);
  // Una base de antes de esta versión: con horas, y sin la marca.
  rmSync(marca, { force: true });
  sesion(transcript, wt, dia(6, 15), 45, "feature");

  const previa = estela(home, "import", "--db", db);
  assert.equal(previa.code, 0, previa.out);
  assert.match(previa.out, /Estela ahora reconoce las sesiones en subcarpetas y worktrees/);
  assert.match(previa.out, /Web\s+\+\d+m/);
  assert.match(previa.out, /No se ha tocado nada\. Cuando quieras: estela import --yes/);
  // A esos bloques no les falta registrarse: les falta el --yes.
  assert.match(previa.out, /1 de esos bloques son de subcarpetas o worktrees de un proyecto: estela import --yes los imputa/);
  assert.doesNotMatch(previa.out, /Regístralos con/);
  assert.deepEqual(ramas(db), ["main"], "sin confirmar, nada cambia");
  assert.ok(!existsSync(marca));

  const si = estela(home, "import", "--db", db, "--yes");
  assert.equal(si.code, 0, si.out);
  assert.deepEqual(ramas(db), ["feature", "main"]);
  assert.match(si.out, /recuperadas de sesiones en subcarpetas y worktrees/);
  assert.ok(existsSync(marca));

  const otra = estela(home, "import", "--db", db);
  assert.doesNotMatch(otra.out, /Estela ahora reconoce/, "la vista previa es solo la primera vez");
});

test("una base nueva no tiene nada que cambiar: se aplica sin preguntar", () => {
  const { home, main, wt, db, transcript, marca } = escenario();
  sesion(transcript, main, dia(5), 30);
  sesion(transcript, wt, dia(5, 15), 30, "feature");
  const r = estela(home, "import", "--db", db);
  assert.doesNotMatch(r.out, /Estela ahora reconoce/);
  assert.deepEqual(ramas(db), ["feature", "main"]);
  assert.ok(existsSync(marca));
});

test("un día aprobado no se toca: aviso con la fecha, las horas y el comando", () => {
  const { home, main, wt, db, transcript, marca } = escenario();
  sesion(transcript, main, dia(5), 30);
  estela(home, "import", "--db", db);
  rmSync(marca, { force: true });
  const c = openDatabase(db);
  const antes = (() => {
    try {
      c.prepare("UPDATE time_entries SET approved = 1").run();
      return store.getTimeEntries(c, "web")[0]!.seconds;
    } finally { c.close(); }
  })();
  sesion(transcript, wt, dia(5, 15), 40);          // mismo día aprobado, misma rama
  sesion(transcript, wt, dia(7, 9), 20, "feature"); // día libre

  const r = estela(home, "import", "--db", db, "--yes");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`${localDate(dia(5))} · Web: \\d+m recuperables\\. Revísalo con: estela entries --project web`));
  const d = openDatabase(db);
  try {
    const entradas = store.getTimeEntries(d, "web");
    assert.equal(entradas.find((e) => e.branch === "main")!.seconds, antes, "el día aprobado sigue igual");
    assert.ok(entradas.some((e) => e.branch === "feature"), "el día libre sí se recupera");
  } finally { d.close(); }
});

test("el import automático del panel solo recupera si ya se confirmó desde la terminal", () => {
  const { home, main, wt, db, transcript, marca } = escenario();
  sesion(transcript, main, dia(5), 30);
  estela(home, "import", "--db", db);
  rmSync(marca, { force: true });
  sesion(transcript, wt, dia(6, 15), 30, "feature");

  const panel = () => spawnSync(process.execPath, ["-e", `
    require(${JSON.stringify(join(__dirname, "server.js"))})
      .startServer({ port: ${4900 + Math.floor(Math.random() * 90)}, dbPath: ${JSON.stringify(db)}, autoImportMinutes: 0 })
      .then(async (u) => { await fetch(u + "/api/import", { method: "POST" }); process.exit(0); });`],
    { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });

  panel();
  assert.deepEqual(ramas(db), ["main"], "sin la marca, el panel no cambia horas por su cuenta");
  writeFileSync(marca, "x");
  panel();
  assert.deepEqual(ramas(db), ["feature", "main"]);
});
