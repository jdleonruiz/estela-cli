import assert from "node:assert/strict";
import { test } from "node:test";

import { setLang } from "./i18n/index.js";
import {
  appendedCommand, isOurs, planInstall, planUninstall, shellQuote,
} from "./statusline-install.js";
import { compactDuration, parseStatusInput, renderStatus, stripAnsi, type StatusData } from "./statusline.js";

/**
 * La status line, sin disco: entrada, composición, color y recorte; y el
 * fichero de Claude Code, sobre texto. Lo que no puede pasar nunca: enseñar un
 * límite que Claude Code no mandó, quitar "estela", o pisar la configuración
 * de alguien.
 */

const DATA: StatusData = {
  project: { name: "brightside-portal", client: "Brightside Health" },
  todaySeconds: 2 * 3600 + 14 * 60, projectShare: 0.21, sevenDay: 38, fiveHour: 62,
};

const plain = (d: StatusData, columns?: number) => {
  setLang("es");
  return renderStatus(d, { color: false, ...(columns ? { columns } : {}) });
};

// ── Entrada ─────────────────────────────────────────────────────────────

test("entrada con rate_limits: los dos porcentajes, tal cual llegan", () => {
  const i = parseStatusInput(JSON.stringify({
    workspace: { current_dir: "/a/sub", project_dir: "/a" }, transcript_path: "/t.jsonl",
    rate_limits: { five_hour: { used_percentage: 62.4, resets_at: 1 }, seven_day: { used_percentage: 38 } },
  }));
  assert.deepEqual(i, { dir: "/a", transcriptPath: "/t.jsonl", fiveHour: 62.4, sevenDay: 38,
    fiveHourResetsAt: new Date(1000) });
});

test("entrada sin rate_limits (API key, versiones viejas): nada de límites", () => {
  const i = parseStatusInput(JSON.stringify({ workspace: { current_dir: "/a" } }));
  assert.equal(i.fiveHour, null);
  assert.equal(i.sevenDay, null);
  assert.equal(i.dir, "/a", "sin project_dir, el current_dir");
  const line = plain({ ...DATA, fiveHour: null, sevenDay: null });
  assert.doesNotMatch(line, /semana|5 h/);
});

test("un JSON roto o que no es un objeto lanza, para que quien llama imprima estela", () => {
  assert.throws(() => parseStatusInput("esto no es json"));
  assert.throws(() => parseStatusInput("[1,2]"));
  assert.throws(() => parseStatusInput("null"));
});

// ── Composición ─────────────────────────────────────────────────────────

test("orden visual: estela · cliente › proyecto · hoy · este proyecto · semana · 5 h", () => {
  assert.equal(plain(DATA),
    "estela · Brightside Health › brightside-portal · hoy 2h14 · este proyecto 21 % · semana 38 % · 5 h 62 %");
  setLang("en");
  assert.equal(stripAnsi(renderStatus(DATA, { color: false })),
    "estela · Brightside Health › brightside-portal · today 2h14 · this project 21% · week 38% · 5h 62%");
  setLang("es");
});

test("sin cliente, el nombre es el proyecto; sin proyecto, el aviso de setup", () => {
  assert.match(plain({ ...DATA, project: { name: "ledger-cli", client: null } }), /^estela · ledger-cli · hoy/);
  const sin = { ...DATA, project: null, fiveHour: null, sevenDay: null };
  assert.equal(plain({ ...sin, unassignedRoot: "web" }), "estela · web (sin proyecto) · estela setup");
  assert.equal(plain({ ...sin, unassignedRoot: null }), "estela · sin proyecto", "fuera de git, sin pista");
});

test("sin proyecto, al recortar: primero la pista, luego el nombre de la raíz con …", () => {
  const d = { ...DATA, project: null, unassignedRoot: "facturacion-clientes", fiveHour: null, sevenDay: null };
  const anchos = [60, 45, 40, 30, 24, 10];
  const lineas = anchos.map((w) => plain(d, w));
  assert.deepEqual(lineas, [
    "estela · facturacion-clientes (sin proyecto) · estela setup",
    "estela · facturacion-clientes (sin proyecto)",
    "estela · facturacion-cli… (sin proyecto)",
    "estela · factu… (sin proyecto)",
    "estela",
    "estela",
  ]);
  lineas.forEach((l, i) => assert.ok(l.length <= anchos[i]!, `${anchos[i]}: ${l}`));
  assert.equal(plain({ ...d, unassignedRoot: null }, 10), "estela");
  setLang("en");
  assert.equal(stripAnsi(renderStatus(d, { color: false })), "estela · facturacion-clientes (no project) · estela setup");
  setLang("es");
});

test("sin consumo esta semana no se inventa un 0 %", () => {
  assert.doesNotMatch(plain({ ...DATA, projectShare: null }), /este proyecto/);
  assert.match(plain({ ...DATA, projectShare: 0 }), /este proyecto 0 %/);
});

test("nunca cuenta atrás ni 'te queda': ni con los límites al 100 %", () => {
  const line = plain({ ...DATA, fiveHour: 100, sevenDay: 99.6 });
  assert.match(line, /semana 100 % · 5 h 100 %/);
  assert.doesNotMatch(line, /queda|reinicia|resets|left|:\d\d/i);
});

test("duración corta", () => {
  assert.equal(compactDuration(45 * 60), "45m");
  assert.equal(compactDuration(3 * 3600), "3h");
  assert.equal(compactDuration(2 * 3600 + 5 * 60), "2h05");
  assert.equal(compactDuration(0), "0m");
});

// ── Color ───────────────────────────────────────────────────────────────

test("estela en #46C0A7, el resto en gris, y la 5 h en ámbar desde el 80 %", () => {
  setLang("es");
  const jade = "\x1b[38;2;70;192;167m", amber = "\x1b[38;2;221;168;90m";
  const normal = renderStatus({ ...DATA, fiveHour: 79.4 });
  assert.ok(normal.startsWith(`${jade}estela`));
  assert.ok(!normal.includes(amber), "79 %: aún no");
  const alto = renderStatus({ ...DATA, fiveHour: 80 });
  assert.ok(alto.includes(`${amber}5 h 80 %`));
  // La semana no se pinta de ámbar: solo la 5 h, como se pidió.
  assert.ok(!renderStatus({ ...DATA, sevenDay: 95, fiveHour: 10 }).includes(amber));
});

test("--no-color: ni un código ANSI", () => {
  assert.doesNotMatch(renderStatus(DATA, { color: false }), /\x1b\[/);
});

// ── Recorte por COLUMNS ─────────────────────────────────────────────────

test("recorte: 5 h → semana → solo cliente → nombre con … → este proyecto → hoy; estela nunca", () => {
  const anchos = [200, 98, 85, 75, 60, 45, 30, 20, 12, 3];
  const lineas = anchos.map((w) => plain(DATA, w));
  for (const [i, w] of anchos.entries()) {
    assert.ok(lineas[i]!.length <= w || lineas[i] === "estela", `${w}: ${lineas[i]}`);
    assert.ok(lineas[i]!.startsWith("estela"), "estela no se quita nunca");
  }
  assert.deepEqual(lineas.slice(1), [
    "estela · Brightside Health › brightside-portal · hoy 2h14 · este proyecto 21 % · semana 38 %",
    "estela · Brightside Health › brightside-portal · hoy 2h14 · este proyecto 21 %",
    "estela · Brightside Health · hoy 2h14 · este proyecto 21 %",
    "estela · Brightside Health · hoy 2h14 · este proyecto 21 %",
    // El nombre se acorta antes de quitar "este proyecto", pero no por debajo
    // de 6 caracteres: "Br…" no dice de qué proyecto es.
    "estela · Brightside Health · hoy 2h14",
    "estela · Brightsid… · hoy 2h14",
    "estela · Brightside…",
    "estela · Br…",
    "estela",
  ]);
});

test("sin COLUMNS no se recorta nada", () => {
  setLang("es");
  assert.equal(stripAnsi(renderStatus(DATA, { color: false, columns: null })), plain(DATA));
});

// ── install / uninstall ─────────────────────────────────────────────────

test("install fusiona: el resto del fichero queda igual", () => {
  const antes = JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] }, hooks: { Stop: [] } });
  const r = planInstall(antes);
  assert.equal(r.status, "installed");
  if (r.status !== "installed") return;
  const despues = JSON.parse(r.text) as Record<string, unknown>;
  assert.deepEqual(despues["permissions"], { allow: ["Bash(ls)"] });
  assert.deepEqual(despues["hooks"], { Stop: [] });
  assert.equal(despues["model"], "opus");
  assert.deepEqual(despues["statusLine"], { type: "command", command: "estela statusline", padding: 0 });
  assert.deepEqual(Object.keys(despues), ["model", "permissions", "hooks", "statusLine"], "mismo orden de claves");
});

test("install sin fichero lo crea; con un JSON roto no toca nada", () => {
  assert.equal(planInstall(null).status, "installed");
  assert.equal(planInstall("{ roto").status, "invalid");
  assert.equal(planInstall("[]").status, "invalid");
});

test("install no pisa otra status line: conflicto, --force la sustituye, --append la encadena", () => {
  const ajena = JSON.stringify({ statusLine: { type: "command", command: "~/bin/mi linea 'x'" } });
  const c = planInstall(ajena);
  assert.deepEqual(c, { status: "conflict", existing: "~/bin/mi linea 'x'" });

  const f = planInstall(ajena, { force: true });
  assert.equal(f.status, "replaced");

  const a = planInstall(ajena, { append: true });
  assert.equal(a.status, "chained");
  if (a.status !== "chained") return;
  const cmd = (JSON.parse(a.text) as { statusLine: { command: string } }).statusLine.command;
  assert.equal(cmd, `estela statusline --append ${shellQuote("~/bin/mi linea 'x'")}`);
  assert.equal(appendedCommand(cmd), "~/bin/mi linea 'x'", "la comilla de dentro sobrevive");
});

test("install dos veces no cambia nada", () => {
  const r = planInstall(null);
  if (r.status !== "installed") throw new Error();
  assert.equal(planInstall(r.text).status, "already");
});

test("uninstall quita la nuestra, devuelve la encadenada y no toca una ajena", () => {
  const sola = planInstall(JSON.stringify({ model: "opus" }));
  if (sola.status !== "installed") throw new Error();
  const q = planUninstall(sola.text);
  assert.equal(q.status, "removed");
  if (q.status === "removed") assert.deepEqual(JSON.parse(q.text), { model: "opus" });

  const enc = planInstall(JSON.stringify({ statusLine: { type: "command", command: "otra" } }), { append: true });
  if (enc.status !== "chained") throw new Error();
  const r = planUninstall(enc.text);
  assert.equal(r.status, "restored");
  if (r.status === "restored") assert.deepEqual(JSON.parse(r.text), { statusLine: { type: "command", command: "otra" } });

  assert.equal(planUninstall(JSON.stringify({ statusLine: { type: "command", command: "otra" } })).status, "foreign");
  assert.equal(planUninstall(JSON.stringify({})).status, "absent");
});

test("reconoce la nuestra también con ruta absoluta o en Windows", () => {
  assert.ok(isOurs("estela statusline"));
  assert.ok(isOurs("/usr/local/bin/estela statusline --no-color"));
  assert.ok(isOurs("C:\\npm\\estela.cmd statusline"));
  assert.ok(!isOurs("ccstatusline"));
  assert.ok(!isOurs("estelar statusline"));
});

test("sin proyecto con rate_limits: semana y 5 h también, delante de la pista", () => {
  const d: StatusData = { ...DATA, project: null, unassignedRoot: "web", sevenDay: 38, fiveHour: 62 };
  assert.equal(plain(d), "estela · web (sin proyecto) · semana 38 % · 5 h 62 % · estela setup");
  assert.equal(plain({ ...d, unassignedRoot: null }), "estela · sin proyecto · semana 38 % · 5 h 62 %",
    "fuera de git, los límites sí; la pista no");
  setLang("en");
  assert.equal(stripAnsi(renderStatus(d, { color: false })), "estela · web (no project) · week 38% · 5h 62% · estela setup");
  setLang("es");
});

test("sin proyecto, al recortar: pista → 5 h → semana → raíz con …; estela nunca", () => {
  const d: StatusData = { ...DATA, project: null, unassignedRoot: "facturacion-clientes", sevenDay: 38, fiveHour: 62 };
  const anchos = [90, 70, 58, 46, 40, 30, 20];
  const lineas = anchos.map((w) => plain(d, w));
  assert.deepEqual(lineas, [
    "estela · facturacion-clientes (sin proyecto) · semana 38 % · 5 h 62 % · estela setup",
    "estela · facturacion-clientes (sin proyecto) · semana 38 % · 5 h 62 %",
    "estela · facturacion-clientes (sin proyecto) · semana 38 %",
    "estela · facturacion-clientes (sin proyecto)",
    "estela · facturacion-cli… (sin proyecto)",
    "estela · factu… (sin proyecto)",
    "estela",
  ]);
  lineas.forEach((l, i) => assert.ok(l.length <= anchos[i]!, `${anchos[i]}: ${l}`));

  const fuera = { ...d, unassignedRoot: null };
  assert.deepEqual([50, 40, 30, 20].map((w) => plain(fuera, w)), [
    "estela · sin proyecto · semana 38 % · 5 h 62 %",
    "estela · sin proyecto · semana 38 %",
    "estela · sin proyecto",
    "estela",
  ]);
});

test("sin proyecto, la 5 h también en ámbar desde el 80 %", () => {
  setLang("es");
  const amber = "\x1b[38;2;221;168;90m";
  const d: StatusData = { ...DATA, project: null, unassignedRoot: "web", sevenDay: 10, fiveHour: 85 };
  assert.ok(renderStatus(d).includes(`${amber}5 h 85 %`));
  assert.ok(!renderStatus({ ...d, fiveHour: 79 }).includes(amber));
});
