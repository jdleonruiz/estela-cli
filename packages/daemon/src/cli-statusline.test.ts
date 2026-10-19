import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { localDate } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { compactDuration } from "./statusline.js";

/**
 * `estela statusline` como la ejecuta Claude Code: el JSON por stdin y la
 * línea por stdout. Cada prueba con su HOME temporal: ni se lee ni se escribe
 * nada de quien corre los tests.
 */

const BIN = join(__dirname, "bin.js");

interface Run { readonly code: number | null; readonly out: string; readonly err: string; readonly ms: number }

function estela(home: string, args: readonly string[], input?: string, env: Record<string, string> = {}): Run {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", input: input ?? "",
    env: { ...process.env, HOME: home, USERPROFILE: home, ESTELA_LANG: "es", COLUMNS: "", NO_COLOR: "",
           CLAUDE_CONFIG_DIR: join(home, ".claude"), ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: performance.now() - t0 };
}

function entorno() {
  const home = mkdtempSync(join(tmpdir(), "estela-sl-"));
  const repo = join(home, "repos", "web");
  mkdirSync(repo, { recursive: true });
  return { home, repo, db: join(home, ".estela", "estela.db") };
}

function proyecto(db: string, repo: string, kind: "client" | "internal" = "client"): void {
  mkdirSync(join(db, ".."), { recursive: true });
  const conn = openDatabase(db);
  try {
    store.upsertClient(conn, { id: "acme", name: "ACME", currency: "EUR" });
    store.upsertProject(conn, { id: "web", clientId: "acme", name: "Web", repoPaths: [repo],
      billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind });
  } finally { conn.close(); }
}

/** Una línea de transcript de Claude Code, a `minutos` de ahora (hacia atrás). */
function linea(id: string, cwd: string, minutos: number, cacheRead = 1000): string {
  // Nunca antes de las 00:01 de hoy: el test no puede depender de la hora.
  const hoy = new Date(); hoy.setHours(0, 1, 0, 0);
  const at = new Date(Math.max(hoy.getTime(), Date.now() - minutos * 60_000));
  return JSON.stringify({
    type: "assistant", timestamp: at.toISOString(), cwd, gitBranch: "main", version: "2.1.238", sessionId: "s1",
    message: { id, model: "claude-sonnet-4-6",
      usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0 } },
  }) + "\n";
}

function transcript(home: string): string {
  const dir = join(home, ".claude", "projects", "-repos-web");
  mkdirSync(dir, { recursive: true });
  return join(dir, "sesion.jsonl");
}

const entrada = (dir: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ workspace: { current_dir: dir, project_dir: dir }, ...extra });

const nc = ["statusline", "--no-color"];

// ── Lo que se enseña ────────────────────────────────────────────────────

test("con rate_limits enseña los dos porcentajes; sin ellos, ninguno", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const con = estela(home, nc, entrada(repo, {
    rate_limits: { five_hour: { used_percentage: 62, resets_at: 1 }, seven_day: { used_percentage: 38, resets_at: 2 } },
  }));
  assert.equal(con.code, 0);
  assert.match(con.out, /^estela · ACME › Web · hoy 0m · semana 38 % · 5 h 62 %\n$/);

  const sin = estela(home, nc, entrada(repo));
  assert.equal(sin.out, "estela · ACME › Web · hoy 0m\n");
});

test("un directorio sin proyecto de Estela", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  // Fuera de git: no hay nada que configurar ahí, así que sin pista.
  const r = estela(home, nc, entrada(join(home, "otro")));
  assert.equal(r.out, "estela · sin proyecto\n");
});

test("un repo sin proyecto: su raíz, también desde una subcarpeta, con la pista de setup", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const otro = join(home, "repos", "facturas");
  mkdirSync(join(otro, ".git"), { recursive: true });
  mkdirSync(join(otro, "src", "api"), { recursive: true });
  assert.equal(estela(home, nc, entrada(join(otro, "src", "api"))).out, "estela · facturas (sin proyecto) · estela setup\n");
});

test("sin base de Estela todavía: sin proyecto, y no se crea ninguna base", () => {
  const { home, repo, db } = entorno();
  const r = estela(home, nc, entrada(repo));
  assert.equal(r.code, 0);
  assert.equal(r.out, "estela · sin proyecto\n");
  assert.ok(!existsSync(db), "la status line no es quien empieza a guardar datos");
  // Sin base pero dentro de un repo, se nombra igualmente.
  mkdirSync(join(repo, ".git"));
  assert.equal(estela(home, nc, entrada(join(repo, "src"))).out, "estela · web (sin proyecto) · estela setup\n");
});

test("JSON inválido por stdin: imprime estela y sale con 0, sin trazas", () => {
  const { home } = entorno();
  for (const malo of ["esto no es json", "[1,2]", "{\"workspace\":"]) {
    const r = estela(home, nc, malo);
    assert.equal(r.code, 0, malo);
    assert.equal(r.out, "estela\n", malo);
    assert.equal(r.err, "", "ni por stderr");
  }
});

test("una base corrupta tampoco rompe la línea", () => {
  const { home, repo, db } = entorno();
  mkdirSync(join(db, ".."), { recursive: true });
  writeFileSync(db, "esto no es una base sqlite");
  const r = estela(home, nc, entrada(repo));
  assert.equal(r.code, 0);
  assert.equal(r.out, "estela\n");
});

test("se recorta a COLUMNS", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const limites = { rate_limits: { five_hour: { used_percentage: 62 }, seven_day: { used_percentage: 38 } } };
  const ancho = estela(home, nc, entrada(repo, limites), { COLUMNS: "200" }).out.trimEnd();
  const estrecho = estela(home, nc, entrada(repo, limites), { COLUMNS: "30" }).out.trimEnd();
  assert.match(ancho, /5 h 62 %$/);
  assert.ok(estrecho.length <= 30, estrecho);
  assert.ok(estrecho.startsWith("estela · "), estrecho);
});

test("con color: estela en el verde de la marca", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const r = estela(home, ["statusline"], entrada(repo));
  assert.ok(r.out.startsWith("\x1b[38;2;70;192;167mestela"), JSON.stringify(r.out));
  assert.doesNotMatch(estela(home, ["statusline"], entrada(repo), { NO_COLOR: "1" }).out, /\x1b/);
});

// ── Lectura incremental y horas ─────────────────────────────────────────

test("las horas de hoy son exactamente las que guarda import para los mismos turnos", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const file = transcript(home);
  writeFileSync(file, [50, 44, 38, 31, 25, 12, 6].map((m, i) => linea(`msg_${i}`, repo, m)).join(""));

  const linea1 = estela(home, nc, entrada(repo, { transcript_path: file }));
  const hoy = /hoy (\S+)/.exec(linea1.out)?.[1];
  assert.ok(hoy && hoy !== "0m", linea1.out);

  // Ahora el import de verdad sobre esos mismos transcripts.
  const imp = estela(home, ["import", "--db", db]);
  assert.equal(imp.code, 0, imp.out + imp.err);
  const conn = openDatabase(db);
  try {
    const medidas = store.getTimeEntries(conn, "web")
      .filter((e) => e.source === "agent" && localDate(e.startedAt) === localDate(new Date()))
      .reduce((s, e) => s + e.seconds, 0);
    assert.equal(hoy, compactDuration(medidas), "la status line y el informe dan la misma cifra");
  } finally { conn.close(); }
});

test("lee solo lo nuevo: una línea a medias no se pierde ni se duplica", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const file = transcript(home);
  const a = linea("msg_a", repo, 20, 1000);
  const b = linea("msg_b", repo, 10, 2000);
  // La segunda línea aún se está escribiendo: le falta el final.
  writeFileSync(file, a + b.slice(0, 40));
  estela(home, nc, entrada(repo, { transcript_path: file }));

  const contar = () => {
    const c = openDatabase(db);
    try { return store.turnsBetween(c, new Date(0), new Date(Date.now() + 60_000)).map((t) => t.turnId).sort(); }
    finally { c.close(); }
  };
  assert.deepEqual(contar(), ["msg_a"]);

  appendFileSync(file, b.slice(40));
  estela(home, nc, entrada(repo, { transcript_path: file }));
  estela(home, nc, entrada(repo, { transcript_path: file }));
  assert.deepEqual(contar(), ["msg_a", "msg_b"], "la línea completada entra una vez");

  // El mismo turno repetido en el transcript (Claude Code lo hace) cuenta una vez.
  appendFileSync(file, b);
  const r = JSON.parse(estela(home, ["quota", "--db", db, "--no-refresh", "--json"]).out) as {
    agents: { week: { total: { total: number } } }[];
  };
  assert.equal(r.agents[0]!.week.total.total, 110 + 1000 + 110 + 2000);
});

test("caché vacía y transcript que encoge: se vuelve a leer desde el principio", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const file = transcript(home);
  writeFileSync(file, linea("msg_1", repo, 20) + linea("msg_2", repo, 15));
  estela(home, nc, entrada(repo, { transcript_path: file }));
  writeFileSync(file, linea("msg_3", repo, 5));
  const r = estela(home, nc, entrada(repo, { transcript_path: file }));
  assert.equal(r.code, 0);
  const c = openDatabase(db);
  try {
    assert.ok(store.turnsBetween(c, new Date(0), new Date(Date.now() + 60_000)).some((t) => t.turnId === "msg_3"));
  } finally { c.close(); }
});

test("este proyecto: su parte de los tokens de Claude Code de la semana", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const otro = join(home, "repos", "otro");
  const file = transcript(home);
  writeFileSync(file, linea("m1", repo, 30, 2890) + linea("m2", otro, 20, 8890));
  const r = estela(home, nc, entrada(repo, { transcript_path: file }));
  // 3000 de 12000 tokens: el 25 %.
  assert.match(r.out, /este proyecto 25 %/);
});

test("rápida: por debajo de 100 ms en una máquina normal", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const file = transcript(home);
  writeFileSync(file, Array.from({ length: 300 }, (_, i) => linea(`p${i}`, repo, 300 - i)).join(""));
  estela(home, nc, entrada(repo, { transcript_path: file })); // la primera lee el fichero entero
  // El mejor de cinco: los tests corren en paralelo y comparten CPU, así que
  // se mide con margen. La medida limpia, a mano, da unos 50 ms.
  const mejor = Math.min(...Array.from({ length: 5 },
    () => estela(home, nc, entrada(repo, { transcript_path: file })).ms));
  assert.ok(mejor < 250, `${mejor.toFixed(0)} ms`);
});

// ── install / uninstall de verdad ───────────────────────────────────────

test("install fusiona en ~/.claude/settings.json con copia; uninstall lo deja como estaba", () => {
  const { home } = entorno();
  const dir = join(home, ".claude");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "settings.json");
  const original = JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] } }, null, 2) + "\n";
  writeFileSync(path, original);

  const i = estela(home, ["statusline", "install"]);
  assert.equal(i.code, 0, i.out + i.err);
  assert.match(i.out, /la extensión de VS Code no enseña la status line/);
  const tras = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  assert.deepEqual(tras["statusLine"], { type: "command", command: "estela statusline", padding: 0 });
  assert.deepEqual(tras["permissions"], { allow: ["Bash(ls)"] });
  const copias = readdirSync(dir).filter((n) => n.startsWith("settings.json.bak-"));
  assert.equal(copias.length, 1);
  assert.equal(readFileSync(join(dir, copias[0]!), "utf8"), original, "la copia es el original");

  const u = estela(home, ["statusline", "uninstall"]);
  assert.equal(u.code, 0, u.out + u.err);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), JSON.parse(original));
});

test("install con otra status line: la enseña, no escribe nada y sale con 1", () => {
  const { home } = entorno();
  const path = join(home, ".claude", "settings.json");
  mkdirSync(join(home, ".claude"), { recursive: true });
  const ajena = JSON.stringify({ statusLine: { type: "command", command: "ccstatusline" } });
  writeFileSync(path, ajena);
  const r = estela(home, ["statusline", "install"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /ccstatusline/);
  assert.match(r.out, /--append/);
  assert.match(r.out, /--force/);
  assert.equal(readFileSync(path, "utf8"), ajena, "no se tocó");
});

test("--append ejecuta la otra con el mismo stdin y enseña las dos", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const r = estela(home, ["statusline", "--no-color", "--append", "cat >/dev/null; echo otra linea"], entrada(repo));
  assert.equal(r.out, "estela · ACME › Web · hoy 0m | otra linea\n");
});

test("un turno de scratchpad se devuelve a su repo; si no se puede, no se guarda", () => {
  // Guardarlo con la ruta del scratchpad lo dejaría así para siempre: el
  // `import`, que sí sabría devolverlo, ya no podría reescribirlo (INSERT OR IGNORE).
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const slug = repo.replace(/[/_.]/g, "-");
  const delRepo = `/private/tmp/claude-502/${slug}/sesion/scratchpad`;
  const ajeno = "/private/tmp/claude-502/-otro-sitio/sesion/scratchpad";
  const file = transcript(home);
  writeFileSync(file, linea("sp_ok", delRepo, 20) + linea("sp_no", ajeno, 10));
  estela(home, nc, entrada(repo, { transcript_path: file }));

  const c = openDatabase(db);
  try {
    const guardados = store.turnsBetween(c, new Date(0), new Date(Date.now() + 60_000));
    assert.deepEqual(guardados.map((t) => [t.turnId, t.repoPath]), [["sp_ok", repo]]);
  } finally { c.close(); }
});

test("una sesión en un worktree o en una subcarpeta enseña el proyecto del repo", () => {
  const { home, repo, db } = entorno();
  mkdirSync(join(repo, ".git", "worktrees", "web-fix"), { recursive: true });
  writeFileSync(join(repo, ".git", "worktrees", "web-fix", "commondir"), "../..\n");
  const wt = join(home, "repos", "web-fix");
  mkdirSync(join(wt, "src"), { recursive: true });
  writeFileSync(join(wt, ".git"), `gitdir: ${join(repo, ".git", "worktrees", "web-fix")}\n`);
  mkdirSync(join(repo, "packages", "api"), { recursive: true });
  proyecto(db, repo);
  for (const dir of [join(wt, "src"), join(repo, "packages", "api")]) {
    assert.match(estela(home, nc, entrada(dir)).out, /^estela · ACME › Web · hoy/, dir);
  }
});

test("sin proyecto, con rate_limits: los porcentajes salen igual", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const otro = join(home, "repos", "facturas");
  mkdirSync(join(otro, ".git"), { recursive: true });
  const limites = { rate_limits: { five_hour: { used_percentage: 62 }, seven_day: { used_percentage: 38 } } };
  assert.equal(estela(home, nc, entrada(otro, limites)).out,
    "estela · facturas (sin proyecto) · semana 38 % · 5 h 62 % · estela setup\n");
  assert.equal(estela(home, nc, entrada(join(home, "suelta"), limites)).out,
    "estela · sin proyecto · semana 38 % · 5 h 62 %\n");
});

test("una sesión nueva sin rate_limits enseña los últimos que mandó Claude Code; uno nuevo los reemplaza", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const enHoras = (h: number) => Math.floor(Date.now() / 1000) + h * 3600;
  const con = (cinco: number, semana: number, reinicio5 = enHoras(2)) => entrada(repo, { rate_limits: {
    five_hour: { used_percentage: cinco, resets_at: reinicio5 },
    seven_day: { used_percentage: semana, resets_at: enHoras(72) } } });

  assert.match(estela(home, nc, con(62, 38)).out, /semana 38 % · 5 h 62 %/);
  // Lo que manda Claude Code al arrancar: nada de rate_limits.
  assert.match(estela(home, nc, entrada(repo)).out, /semana 38 % · 5 h 62 %/);
  // Llega el dato nuevo y reemplaza.
  assert.match(estela(home, nc, con(81, 40)).out, /semana 40 % · 5 h 81 %/);
  assert.match(estela(home, nc, entrada(repo)).out, /semana 40 % · 5 h 81 %/);
  // Una 5 h cuyo reinicio ya pasó no se enseña al arrancar; la semana sí.
  estela(home, nc, con(90, 41, enHoras(-1)));
  assert.match(estela(home, nc, entrada(repo)).out, /^estela · ACME › Web · hoy 0m · semana 41 %\n$/);
});

test("con rate_limits guarda una muestra en rate-limits.jsonl, y la línea sale igual", () => {
  const { home, repo, db } = entorno();
  proyecto(db, repo);
  const r = estela(home, nc, entrada(repo, {
    session_id: "s-secreta", version: "2.1.302",
    rate_limits: { five_hour: { used_percentage: 62, resets_at: 1760910000 }, seven_day: { used_percentage: 38, resets_at: 1761300000 } },
  }));
  assert.match(r.out, /semana 38 % · 5 h 62 %/);
  const lineas = readFileSync(join(home, ".estela", "rate-limits.jsonl"), "utf8").trim().split("\n");
  assert.equal(lineas.length, 1);
  const m = JSON.parse(lineas[0]!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(m).sort(), ["cc", "src", "ts", "w5", "w5_reset", "w7", "w7_reset"]);
  assert.equal(m["w5"], 62);
  assert.doesNotMatch(lineas[0]!, /s-secreta|repos/);

  estela(home, nc, entrada(repo));
  assert.equal(readFileSync(join(home, ".estela", "rate-limits.jsonl"), "utf8").trim().split("\n").length, 1,
    "sin rate_limits no se añade nada");
});
