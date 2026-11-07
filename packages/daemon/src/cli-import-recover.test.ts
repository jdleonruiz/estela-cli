import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  return { home, main, wt, db, transcript };
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

test("una sesión en un worktree cuenta sin preguntar nada", () => {
  const { home, main, wt, db, transcript } = escenario();
  sesion(transcript, main, dia(5), 30);
  assert.equal(estela(home, "import", "--db", db).code, 0);
  sesion(transcript, wt, dia(6, 15), 45, "feature");
  const r = estela(home, "import", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(ramas(db), ["feature", "main"]);
  assert.match(r.out, /recuperadas de sesiones en subcarpetas y worktrees/);
  assert.doesNotMatch(r.out, /Regístralos con/);
});

test("un día aprobado no se toca: aviso con la fecha, las horas y el comando", () => {
  const { home, main, wt, db, transcript } = escenario();
  sesion(transcript, main, dia(5), 30);
  estela(home, "import", "--db", db);
  const c = openDatabase(db);
  const antes = (() => {
    try {
      c.prepare("UPDATE time_entries SET approved = 1").run();
      return store.getTimeEntries(c, "web")[0]!.seconds;
    } finally { c.close(); }
  })();
  sesion(transcript, wt, dia(5, 15), 40);          // mismo día aprobado, misma rama
  sesion(transcript, wt, dia(7, 9), 20, "feature"); // día libre

  const r = estela(home, "import", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`${localDate(dia(5))} · Web: \\d+m recuperables\\. Revísalo con: estela entries --project web`));
  const d = openDatabase(db);
  try {
    const entradas = store.getTimeEntries(d, "web");
    assert.equal(entradas.find((e) => e.branch === "main")!.seconds, antes, "el día aprobado sigue igual");
    assert.ok(entradas.some((e) => e.branch === "feature"), "el día libre sí se recupera");
  } finally { d.close(); }
});

test("el import automático del panel cuenta los worktrees igual que la terminal", () => {
  const { home, main, wt, db, transcript } = escenario();
  sesion(transcript, main, dia(5), 30);
  estela(home, "import", "--db", db);
  sesion(transcript, wt, dia(6, 15), 30, "feature");

  const panel = () => spawnSync(process.execPath, ["-e", `
    require(${JSON.stringify(join(__dirname, "server.js"))})
      .startServer({ port: ${4900 + Math.floor(Math.random() * 90)}, dbPath: ${JSON.stringify(db)}, autoImportMinutes: 0 })
      .then(async (u) => { await fetch(u + "/api/import", { method: "POST" }); process.exit(0); });`],
    { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home } });

  panel();
  assert.deepEqual(ramas(db), ["feature", "main"]);
});

test("pedir ayuda no ejecuta el comando ni crea la base de datos", () => {
  const home = mkdtempSync(join(tmpdir(), "estela-help-"));
  for (const args of [["import", "--help"], ["import", "--yes", "--help"], ["report", "-h"], ["report", "--dry-run", "-h"], ["--help"], ["--help", "import"]]) {
    const r = spawnSync(process.execPath, [BIN, ...args],
      { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home, ESTELA_LANG: "es", NO_COLOR: "1" } });
    assert.equal(r.status, 0, args.join(" "));
    assert.match(r.stdout, /estela import \[--since/, args.join(" "));
    assert.doesNotMatch(r.stdout, /Leyendo transcripts/, args.join(" "));
  }
  assert.equal(existsSync(join(home, ".estela")), false, "no debe crear ~/.estela");
});

test("--dry-run y --no-amounts protegen aunque les siga otra palabra", () => {
  const home = mkdtempSync(join(tmpdir(), "estela-flags-"));
  const ruta = join(home, "e.db");
  const db = openDatabase(ruta);
  store.upsertClient(db, { id: "c", name: "C", currency: "EUR" });
  store.upsertProject(db, { id: "web", clientId: "c", name: "Web", repoPaths: ["/x/web"], billable: true,
    roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  store.saveTimeEntry(db, {
    id: "te_1", projectId: "web", startedAt: new Date(2026, 9, 5, 10), endedAt: new Date(2026, 9, 5, 11), seconds: 3600,
    description: "x", billable: true, invoiceId: null, aiCost: { microUsd: 0 }, agentSeconds: 3600, commitHashes: [],
    agents: [], source: "agent", kind: "development", branch: "main", workItems: [],
  });
  db.close();
  assert.equal(estela(home, "rate", "set", "--db", ruta, "--project", "web", "--rate", "10", "--from", "2026-01-01").code, 0);

  const pdf = join(home, "sin.pdf");
  const r = estela(home, "report", "--db", ruta, "--project", "web", "--cutoff", "2026-12-31", "--pdf", pdf, "--dry-run", "x", "--no-amounts", "y");
  assert.equal(r.code, 0, r.out);
  assert.ok(!readFileSync(pdf).toString("latin1").includes("IMPORTE"), "el PDF no debe llevar importes");
  const tras = openDatabase(ruta);
  try {
    assert.equal(store.getTimeEntries(tras, "web")[0]!.invoiceId, null, "--dry-run no debe emitir nada");
  } finally { tras.close(); }
});

/** Un repo git de verdad, registrado como "web", con un commit a esa hora. */
function repoConCommit(home: string, db: string, at: Date) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), "estela-git-")));
  const git = (...a: string[]) => {
    const r = spawnSync("git", a, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: at.toISOString(),
      GIT_COMMITTER_DATE: at.toISOString(), HOME: home } });
    assert.equal(r.status, 0, r.stderr);
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "yo@x.com");
  git("config", "user.name", "Yo");
  writeFileSync(join(repo, "a"), "a");
  git("add", ".");
  git("commit", "-qm", "fix");
  const c = openDatabase(db);
  try {
    store.upsertClient(c, { id: "c", name: "C", currency: "EUR" });
    store.upsertProject(c, { id: "web", clientId: "c", name: "Web", repoPaths: [normalizePath(repo)], billable: true,
      roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  } finally { c.close(); }
  return repo;
}

test("borrar el transcript no convierte horas medidas en los 25 min de un commit posterior", () => {
  const home = mkdtempSync(join(tmpdir(), "estela-borrado-"));
  mkdirSync(join(home, ".estela"));
  const db = join(home, ".estela", "estela.db");
  const repo = repoConCommit(home, db, new Date(2026, 9, 5, 18));
  const transcript = join(home, ".claude", "projects", "-repo", "s.jsonl");
  mkdirSync(join(transcript, ".."), { recursive: true });
  writeFileSync(transcript, "");
  sesion(transcript, repo, new Date(2026, 9, 5, 10), 60);

  const leer = () => { const c = openDatabase(db); try { return store.getTimeEntries(c, "web"); } finally { c.close(); } };
  assert.equal(estela(home, "import").code, 0);
  const con = leer();
  assert.equal(con.length, 1);
  assert.equal(con[0]!.source, "agent");
  assert.ok(con[0]!.seconds > 60 * 60, "la sesión más el commit de después");

  rmSync(transcript);
  assert.equal(estela(home, "import").code, 0);
  const sin = leer();
  assert.equal(sin[0]!.seconds, con[0]!.seconds, "las horas siguen en la base");
  assert.equal(sin[0]!.source, "agent");
});

test("--since no recalcula los días anteriores con la mitad de sus datos", () => {
  const home = mkdtempSync(join(tmpdir(), "estela-since-"));
  mkdirSync(join(home, ".estela"));
  const db = join(home, ".estela", "estela.db");
  const repo = repoConCommit(home, db, new Date(2026, 9, 5, 18));
  const transcript = join(home, ".claude", "projects", "-repo", "s.jsonl");
  mkdirSync(join(transcript, ".."), { recursive: true });
  writeFileSync(transcript, "");
  sesion(transcript, repo, new Date(2026, 9, 5, 10), 60);
  estela(home, "import");
  const leer = () => { const c = openDatabase(db); try { return store.getTimeEntries(c, "web")[0]!.seconds; } finally { c.close(); } };
  const antes = leer();
  assert.equal(estela(home, "import", "--since", "2026-10-20").code, 0);
  assert.equal(leer(), antes);
});

test("una sesión que sigue en otra rama tras importar reparte el rato, sin duplicar horas", () => {
  const home = mkdtempSync(join(tmpdir(), "estela-rama-"));
  mkdirSync(join(home, ".estela"));
  const db = join(home, ".estela", "estela.db");
  const repo = repoConCommit(home, db, new Date(2026, 0, 1, 9));
  const transcript = join(home, ".claude", "projects", "-repo", "s.jsonl");
  mkdirSync(join(transcript, ".."), { recursive: true });
  writeFileSync(transcript, "");
  sesion(transcript, repo, new Date(2026, 9, 5, 10), 60, "a");
  estela(home, "import");
  sesion(transcript, repo, new Date(2026, 9, 5, 11, 5), 30, "b");
  const r = estela(home, "import");
  assert.doesNotMatch(r.out, /imputaciones retiradas/);
  // Cada rama con su parte; el total, el mismo rato de reloj.
  // "main" es el commit de enero del repo, otro día.
  assert.deepEqual(ramas(db).sort(), ["a", "b", "main"]);
});
