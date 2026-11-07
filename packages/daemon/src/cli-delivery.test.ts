import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";

import type { AgentTurn } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { normalizePath } from "./paths.js";
import { readCommits } from "./watchers/git.js";

/**
 * `estela delivery` con un `gh` falso en el PATH: nunca se llama a GitHub. El
 * cliente Acme, sus issues y sus PRs son inventados.
 */

const BIN = join(__dirname, "bin.js");
const DAY = 86_400_000;
const isWindows = process.platform === "win32";

/** Un PATH con git y node, y sin ningún gh. */
const BASE_PATH = [dirname(process.execPath), "/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"]
  .filter((d) => !existsSync(join(d, "gh"))).join(delimiter);

const issue = (number: number, title: string, state: "OPEN" | "CLOSED", labels: string[], closedAt: string | null = null) =>
  ({ number, title, state, stateReason: state === "CLOSED" ? "COMPLETED" : null, closedAt,
     labels: labels.map((name) => ({ name })), milestone: null, url: `u${number}` });
const pr = (number: number, title: string, branch: string, closes: number[], mergedAt: string | null, labels: string[] = []) =>
  ({ number, title, state: mergedAt ? "MERGED" : "OPEN", mergedAt, closedAt: mergedAt, headRefName: branch,
     labels: labels.map((name) => ({ name })), milestone: null,
     closingIssuesReferences: closes.map((n) => ({ number: n })), url: `https://github.com/acme/tienda/pull/${number}` });

/** Todo lo que "hay en GitHub". El gh falso filtra como el de verdad: por estado y por etiqueta. */
const GH_DATA = {
  issues: [
    issue(2, "Login con Google", "CLOSED", ["planificado", "cliente:Acme"], "2026-10-15T10:00:00Z"),
    issue(3, "Exportar pedidos a PDF", "OPEN", ["planificado"]),
    issue(30, "Informe de ventas", "OPEN", ["cliente:beta-corp"]),
  ],
  prs: [
    pr(10, "Login con Google", "feat/login", [2], "2026-10-15T10:00:00Z"),
    pr(11, "Arregla stock negativo", "fix/stock", [], "2026-10-20T10:00:00Z"),
    pr(31, "Informe de ventas", "feat/informe", [30], null),
  ],
  labels: ["planificado", "cliente:Acme", "cliente:beta-corp", "bug"],
};

/** Un \`gh\` de mentira: responde con GH_DATA y apunta cada llamada en un fichero. */
function ghFalso(dir: string): { path: string; log: string } {
  const log = join(dir, "gh-calls.log");
  const data = join(dir, "gh-data.json");
  writeFileSync(data, JSON.stringify(GH_DATA));
  const script = join(dir, "gh");
  writeFileSync(script, `#!${process.execPath}
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(" ") + "\\n");
const d = JSON.parse(fs.readFileSync(${JSON.stringify(data)}, "utf8"));
if (a[0] === "--version" || a[0] === "auth" || a[0] === "repo") { console.log("ok"); process.exit(0); }
if (a[0] === "label") { console.log(JSON.stringify(d.labels.map((name) => ({ name })))); process.exit(0); }
let rows = a[0] === "pr" ? d.prs : a[0] === "issue" ? d.issues : [];
const state = a[a.indexOf("--state") + 1];
if (state === "merged") rows = rows.filter((r) => r.state === "MERGED");
if (state === "open") rows = rows.filter((r) => r.state === "OPEN");
if (state === "closed") rows = rows.filter((r) => r.state === "CLOSED");
const label = a.includes("--label") ? a[a.indexOf("--label") + 1] : null;
if (label) rows = rows.filter((r) => r.labels.some((l) => l.name === label));
if (a.includes("--search") && a[a.indexOf("--search") + 1].startsWith("milestone:")) rows = [];
console.log(JSON.stringify(rows));
`);
  chmodSync(script, 0o755);
  return { path: dir, log };
}

function estela(home: string, path: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", input: "", cwd: home,
    env: { ...process.env, PATH: path, HOME: home, USERPROFILE: home, ESTELA_LANG: "es", NO_COLOR: "1",
           ESTELA_NO_UPDATE_CHECK: "1" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

async function entorno() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "estela-delivery-")));
  const repo = join(home, "tienda");
  mkdirSync(repo);
  // Fechas viejas: la rama lleva 40 días parada.
  const viejo = new Date(Date.now() - 40 * DAY).toISOString();
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe", env: {
    ...process.env, GIT_AUTHOR_NAME: "Ana", GIT_AUTHOR_EMAIL: "ana@ejemplo.com",
    GIT_COMMITTER_NAME: "Ana", GIT_COMMITTER_EMAIL: "ana@ejemplo.com",
    GIT_AUTHOR_DATE: viejo, GIT_COMMITTER_DATE: viejo } });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a"), "a\n");
  git("add", "-A");
  git("commit", "-q", "-m", "inicio");
  // La rama del PR 10 sigue ahí sin fusionar en git: en GitHub fue un squash.
  git("checkout", "-q", "-b", "feat/login");
  writeFileSync(join(repo, "b"), "b\n");
  git("add", "-A");
  git("commit", "-q", "-m", "login");
  git("checkout", "-q", "main");

  mkdirSync(join(home, ".estela"));
  const db = join(home, ".estela", "estela.db");
  const c = openDatabase(db);
  store.upsertClient(c, { id: "acme", name: "Acme", currency: "EUR" });
  store.upsertProject(c, { id: "tienda", clientId: "acme", name: "Tienda", repoPaths: [normalizePath(repo)],
    billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  store.setProjectTracker(c, "tienda", { system: "github", prefixes: [] });
  store.setProjectAuthors(c, "tienda", ["ana@ejemplo.com"]);
  store.saveCommits(c, await readCommits(repo));
  let n = 0;
  const imputar = (branch: string, usd: number, minutes: number, items: string[] = []) => {
    const startedAt = new Date("2026-10-10T15:00:00Z");
    store.saveTimeEntry(c, { id: `te_${n++}`, projectId: "tienda", startedAt,
      endedAt: new Date(startedAt.getTime() + minutes * 60_000), seconds: minutes * 60, description: "x",
      billable: true, invoiceId: null, aiCost: { microUsd: usd * 1e6 }, agentSeconds: 0, commitHashes: [],
      agents: ["claude-code"], source: "agent", kind: "development", branch, workItems: items });
  };
  imputar("feat/login", 12, 120);
  imputar("fix/stock", 3, 30);
  imputar("main", 1, 15, ["github:3"]);
  imputar("feat/informe", 4, 40);
  imputar("feat/comun", 2, 20, ["github:2", "github:30"]);
  c.close();
  return { home, db, repo };
}

test("con gh: los tres bloques con su coste, y lo leído se guarda para --offline", { skip: isWindows }, async () => {
  const { home, db } = await entorno();
  const gh = ghFalso(home);
  const path = gh.path + delimiter + BASE_PATH;
  assert.equal(estela(home, path, "project", "tracker", "--project", "tienda", "--plan-label", "planificado", "--db", db).code, 0);

  const r = estela(home, path, "delivery", "--project", "tienda", "--month", "2026-10", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Planificado frente a entregado · Tienda · Acme · 2026-10-01 → 2026-10-31\n/);
  assert.match(r.out, /Plan: etiqueta "planificado" · Fuente: GitHub \(gh\), leído ahora/);
  assert.match(r.out, /Planificado y entregado \(1 de 2\)\n[\s\S]*#2 Login con Google\s+2h 20m\s+\$14\.00/);
  assert.match(r.out, /entregada por PR #10 · coste según: rama del PR, número en rama o commit/);
  assert.match(r.out, /Planificado sin entregar \(1\)\n[\s\S]*#3 Exportar pedidos a PDF\s+15m\s+\$1\.00/);
  assert.match(r.out, /Entregado sin planificar \(1\)\n[\s\S]*PR #11 Arregla stock negativo\s+30m\s+\$3\.00/);
  assert.match(readFileSync(gh.log, "utf8"), /pr list --state merged --limit 1000 --search merged:2026-10-01\.\.2026-10-31/);

  // Sin conexión, lo mismo de lo guardado, y gh ni se llama.
  const antes = readFileSync(gh.log, "utf8");
  const off = estela(home, path, "delivery", "--project", "tienda", "--month", "2026-10", "--offline", "--db", db);
  assert.match(off.out, /--offline: no se consulta GitHub\./);
  assert.match(off.out, /Fuente: GitHub, lo guardado el \d{4}-\d{2}-\d{2} \(sin conexión\)/);
  assert.match(off.out, /PR #11 Arregla stock negativo/);
  assert.equal(readFileSync(gh.log, "utf8"), antes);

  const j = JSON.parse(estela(home, path, "delivery", "--project", "tienda", "--month", "2026-10", "--json", "--db", db).out) as {
    planned: { delivered: { apiMicroUsd: number; items: { key: string; deliveredBy: string[] }[] } }; unplanned: { items: { key: string }[] } };
  assert.equal(j.planned.delivered.apiMicroUsd, 14_000_000);
  assert.deepEqual(j.planned.delivered.items[0]!.deliveredBy, ["github:10"]);
  assert.deepEqual(j.unplanned.items.map((i) => i.key), ["github:11"]);
});

test("lo leído de GitHub arregla el squash en --undelivered: la rama del PR fusionado está entregada", { skip: isWindows }, async () => {
  const { home, db, repo } = await entorno();
  const c = openDatabase(db);
  const turnos: AgentTurn[] = Array.from({ length: 5 }, (_, i) => ({
    agent: "claude-code", turnId: `t${i}`, sessionId: "s", at: new Date(Date.now() - 40 * DAY + i * 60_000),
    model: "claude-sonnet-4-6", repoPath: normalizePath(repo), branch: "feat/login", producerVersion: null,
    tokens: { input: 100_000, output: 10_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } }));
  store.saveTurns(c, turnos);
  // Un commit tuyo en la sesión, para que no cuente como sesión sin commit.
  store.saveCommits(c, [{ repoPath: normalizePath(repo), hash: "abc", at: new Date(Date.now() - 40 * DAY + 2 * 60_000),
    authorEmail: "ana@ejemplo.com", authorName: "Ana", branch: "feat/login", subject: "login",
    linesAdded: 1, linesDeleted: 0, files: ["b"] }, { repoPath: normalizePath(repo), hash: "old",
    at: new Date(Date.now() - 100 * DAY), authorEmail: "ana@ejemplo.com", authorName: "Ana", branch: "main",
    subject: "inicio", linesAdded: 1, linesDeleted: 0, files: ["a"] }]);
  c.close();
  type J = { projects: { unmergedBranches: { branches: { branch: string }[] } }[] };
  const sinGh = JSON.parse(estela(home, BASE_PATH, "ai-cost", "--undelivered", "--json", "--db", db).out) as J;
  assert.deepEqual(sinGh.projects[0]!.unmergedBranches.branches.map((b) => b.branch), ["feat/login"]);

  const gh = ghFalso(home);
  estela(home, gh.path + delimiter + BASE_PATH, "delivery", "--project", "tienda", "--month", "2026-10", "--db", db);
  const conGh = JSON.parse(estela(home, BASE_PATH, "ai-cost", "--undelivered", "--json", "--db", db).out) as J;
  assert.deepEqual(conGh.projects[0]!.unmergedBranches.branches, []);
});

test("sin gh lo explica y enseña lo entregado según git", { skip: isWindows }, async () => {
  const { home, db, repo } = await entorno();
  const c = openDatabase(db);
  store.saveMerges(c, [{ repoPath: normalizePath(repo), hash: "m1", at: new Date("2026-10-18T10:00:00Z"),
    sourceBranch: "fix/stock", ref: "github:11", subject: "Merge pull request #11 from ana/fix/stock" }]);
  store.saveCommits(c, [{ repoPath: normalizePath(repo), hash: "sq", at: new Date("2026-10-15T10:00:00Z"),
    authorEmail: "ana@ejemplo.com", authorName: "Ana", branch: "main", subject: "Login con Google (#10)",
    linesAdded: 1, linesDeleted: 0, files: [] }]);
  c.close();
  const r = estela(home, BASE_PATH, "delivery", "--project", "tienda", "--month", "2026-10", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /gh no está instalado: sin él no se puede leer el plan de GitHub/);
  assert.match(r.out, /Plan: sin plan · Fuente: git: los PR de los commits de merge y de los squash con \(#N\)/);
  assert.match(r.out, /Entregado \(2\)/);
  assert.match(r.out, /PR #11 fix\/stock\s+30m\s+\$3\.00/);
  assert.match(r.out, /PR #10 Login con Google\s+—\s+\$0\.00/, "un squash no dice su rama: sin horas unidas");
});

test("un proyecto sin GitHub como gestor no llama a gh, y --plan-label necesita gestor", { skip: isWindows }, async () => {
  const { home, db } = await entorno();
  const gh = ghFalso(home);
  const path = gh.path + delimiter + BASE_PATH;
  const c = openDatabase(db);
  store.setProjectTracker(c, "tienda", null);
  c.close();
  const r = estela(home, path, "delivery", "--project", "tienda", "--db", db);
  assert.match(r.out, /Este proyecto no tiene GitHub ni GitLab como gestor, así que no se lee el plan\./);
  assert.ok(!existsSync(gh.log), "gh no se ha llamado");
  assert.match(estela(home, path, "project", "tracker", "--project", "tienda", "--plan-label", "x", "--db", db).out,
    /Primero el gestor: estela project tracker --project tienda --system github/);
  assert.match(estela(home, path, "delivery", "--project", "tienda", "--label", "a", "--milestone", "b", "--db", db).out,
    /--label y --milestone van por separado/);
});

test("project tracker: la etiqueta de plan se guarda, se conserva al cambiar prefijos y se quita con none", async () => {
  const { home, db } = await entorno();
  const run = (...a: string[]) => estela(home, BASE_PATH, "project", "tracker", "--project", "tienda", ...a, "--db", db);
  assert.match(run("--plan-label", "planificado").out, /Lo planificado de "Tienda" es lo que lleva la etiqueta "planificado"\./);
  run("--system", "github");
  const leer = () => { const c = openDatabase(db); try { return store.getProject(c, "tienda")!.tracker; } finally { c.close(); } };
  assert.equal(leer()!.planLabel, "planificado");
  assert.match(run("--plan-label", "none").out, /"Tienda" ya no tiene etiqueta de plan\./);
  assert.equal(leer()!.planLabel, undefined);
});

test("--by client: lo pedido por cada cliente frente al resto, y los alias", { skip: isWindows }, async () => {
  const { home, db } = await entorno();
  const gh = ghFalso(home);
  const path = gh.path + delimiter + BASE_PATH;
  const c = openDatabase(db);
  store.upsertClient(c, { id: "beta", name: "Beta Corp", currency: "EUR" });
  c.close();

  const r = estela(home, path, "delivery", "--project", "tienda", "--by", "client", "--month", "2026-10", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Peticiones de clientes · Tienda · Acme · 2026-10-01 → 2026-10-31\n/);
  assert.match(r.out, /Etiqueta: "cliente:<nombre>" · Fuente: GitHub \(gh\), leído ahora/);
  assert.match(r.out, /Estela no conoce ingresos ni contratos/);
  // "Acme" es el nombre del cliente acme; "beta-corp" coincide con "Beta Corp" sin alias.
  assert.match(r.out, /  Acme\s+2h\s+\$12\.00\s+—\s+54\.5 %\n      #2 Login con Google/);
  assert.match(r.out, /  Beta Corp\s+40m\s+\$4\.00\s+—\s+18\.2 %/);
  assert.match(r.out, /  Varios: Acme \+ Beta Corp\s+20m\s+\$2\.00\s+—\s+9\.1 %/);
  assert.match(r.out, /  Resto \(sin petición de cliente\)\s+45m\s+\$4\.00\s+—\s+18\.2 %/);
  assert.match(r.out, /  Total del periodo\s+3h 45m\s+\$22\.00/);
  assert.match(readFileSync(gh.log, "utf8"), /issue list --state all --limit 1000 --label cliente:beta-corp/);

  // Un nombre que no se parece a ningún cliente sale sin mapear, hasta que se le pone alias.
  const c2 = openDatabase(db);
  store.upsertClient(c2, { id: "beta", name: "Beta S.L.", currency: "EUR" });
  c2.close();
  const sin = estela(home, path, "delivery", "--project", "tienda", "--by", "client", "--month", "2026-10", "--offline", "--db", db);
  assert.match(sin.out, /  "beta-corp" \(sin mapear\)\s+40m/);
  assert.match(sin.out, /Para unir "beta-corp" con un cliente de Estela: estela client alias --client <id> --label "beta-corp"/);
  assert.match(estela(home, path, "client", "alias", "--client", "beta", "--label", "Beta-Corp", "--db", db).out,
    /La etiqueta "Beta-Corp" es Beta S\.L\./);
  const con = estela(home, path, "delivery", "--project", "tienda", "--by", "client", "--month", "2026-10", "--offline", "--json", "--db", db);
  const j = JSON.parse(con.out) as { requests: { requesters: { clientId: string | null; mapped: boolean }[]; apiMicroUsd: number }[];
    rest: { apiMicroUsd: number }; total: { apiMicroUsd: number } };
  const beta = j.requests.find((g) => g.requesters.length === 1 && g.requesters[0]!.clientId === "beta")!;
  assert.equal(beta.apiMicroUsd, 4_000_000);
  assert.equal(j.requests.reduce((s, g) => s + g.apiMicroUsd, 0) + j.rest.apiMicroUsd, j.total.apiMicroUsd);
  assert.match(estela(home, path, "client", "alias", "--db", db).out, /betacorp\s+→ Beta S\.L\./);
  assert.match(estela(home, path, "client", "alias", "--remove", "--label", "beta corp", "--db", db).out,
    /"beta corp" ya no apunta a ningún cliente\./);
});

test("--by client sin GitHub: lo dice y todo va al resto; y el prefijo se puede cambiar", async () => {
  const { home, db } = await entorno();
  const r = estela(home, BASE_PATH, "delivery", "--project", "tienda", "--by", "client", "--month", "2026-10", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Sin GitHub ni GitLab no hay etiquetas: no se sabe qué pidió cada cliente, y todo va al resto\./);
  assert.match(r.out, /\(ninguna petición de cliente con horas en el periodo\)/);
  assert.match(r.out, /  Resto \(sin petición de cliente\)\s+3h 45m\s+\$22\.00\s+—\s+100\.0 %/);

  const cambio = estela(home, BASE_PATH, "project", "tracker", "--project", "tienda", "--client-label", "customer/", "--db", db);
  assert.match(cambio.out, /Las peticiones de clientes de "Tienda" llevan la etiqueta "customer\/<nombre>"\./);
  assert.match(estela(home, BASE_PATH, "delivery", "--project", "tienda", "--by", "client", "--db", db).out,
    /Etiqueta: "customer\/<nombre>"/);
  assert.match(estela(home, BASE_PATH, "delivery", "--project", "tienda", "--by", "branch", "--db", db).out,
    /--by en delivery solo admite client\./);
});

// ---------------------------------------------------------------------------
// GitLab, con un `glab` falso: la issue #2 y la MR !2 conviven sin mezclarse.
// ---------------------------------------------------------------------------

const GL_DATA = {
  issues: [
    { iid: 2, title: "Login con Google", state: "closed", closed_at: "2026-10-15T10:00:00Z", labels: ["planificado", "cliente:Acme"],
      milestone: null, moved_to_id: null, web_url: "https://gitlab.acme.test/tienda/-/issues/2" },
    { iid: 3, title: "Exportar pedidos a PDF", state: "opened", closed_at: null, labels: ["planificado"],
      milestone: null, moved_to_id: null, web_url: "https://gitlab.acme.test/tienda/-/issues/3" },
  ],
  mrs: [
    { iid: 2, title: "Login con Google", state: "merged", merged_at: "2026-10-15T10:00:00Z", closed_at: null,
      source_branch: "feat/login", labels: [], milestone: null, description: "Closes #2",
      web_url: "https://gitlab.acme.test/tienda/-/merge_requests/2" },
    { iid: 11, title: "Arregla stock negativo", state: "merged", merged_at: "2026-10-20T10:00:00Z", closed_at: null,
      source_branch: "fix/stock", labels: [], milestone: null, description: "",
      web_url: "https://gitlab.acme.test/tienda/-/merge_requests/11" },
  ],
  labels: ["planificado", "cliente:Acme"],
};

function glabFalso(dir: string): { path: string; log: string } {
  const log = join(dir, "glab-calls.log");
  const data = join(dir, "glab-data.json");
  writeFileSync(data, JSON.stringify(GL_DATA));
  const script = join(dir, "glab");
  writeFileSync(script, `#!${process.execPath}
const fs = require("fs");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, a.join(" ") + "\\n");
const d = JSON.parse(fs.readFileSync(${JSON.stringify(data)}, "utf8"));
if (a[0] !== "api") { console.log("ok"); process.exit(0); }
const [path, query] = a[1].split("?");
const q = new URLSearchParams(query || "");
if (path === "projects/:fullpath") { console.log("{}"); process.exit(0); }
if (q.get("page") !== "1") { console.log("[]"); process.exit(0); }
if (path.endsWith("/labels")) { console.log(JSON.stringify(d.labels.map((name) => ({ name })))); process.exit(0); }
let rows = path.endsWith("/merge_requests") ? d.mrs : d.issues;
if (q.get("state")) rows = rows.filter((r) => r.state === q.get("state"));
if (q.get("labels")) rows = rows.filter((r) => r.labels.includes(q.get("labels")));
if (q.get("milestone")) rows = [];
console.log(JSON.stringify(rows));
`);
  chmodSync(script, 0o755);
  return { path: dir, log };
}

test("con glab: GitLab da el plan, la MR !2 entrega la issue #2 y no se confunden", { skip: isWindows }, async () => {
  const { home, db } = await entorno();
  const c = openDatabase(db);
  store.setProjectTracker(c, "tienda", { system: "gitlab", prefixes: [], planLabel: "planificado" });
  c.close();
  const glab = glabFalso(home);
  const path = glab.path + delimiter + BASE_PATH;

  const r = estela(home, path, "delivery", "--project", "tienda", "--month", "2026-10", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Fuente: GitLab \(glab\), leído ahora/);
  assert.match(r.out, /Planificado y entregado \(1 de 2\)\n[\s\S]*#2 Login con Google\s+2h\s+\$12\.00/);
  assert.match(r.out, /entregada por MR !2 · coste según: rama del PR/);
  assert.match(r.out, /Planificado sin entregar \(1\)\n[\s\S]*#3 Exportar pedidos a PDF/);
  assert.match(r.out, /Entregado sin planificar \(1\)\n[\s\S]*MR !11 Arregla stock negativo\s+30m\s+\$3\.00/);
  assert.ok(readFileSync(glab.log, "utf8").split("\n").filter(Boolean).every((l) => !l.startsWith("api") || l.startsWith("api projects/:fullpath")));

  const j = JSON.parse(estela(home, path, "delivery", "--project", "tienda", "--month", "2026-10", "--json", "--db", db).out) as {
    planned: { delivered: { items: { key: string; deliveredBy: string[] }[] } }; unplanned: { items: { key: string }[] } };
  assert.deepEqual(j.planned.delivered.items.map((i) => [i.key, i.deliveredBy]), [["gitlab:2", ["gitlab:!2"]]]);
  assert.deepEqual(j.unplanned.items.map((i) => i.key), ["gitlab:!11"]);

  // Lo pedido por clientes, y el informe de finanzas con lo guardado.
  const byClient = estela(home, path, "delivery", "--by", "client", "--project", "tienda", "--month", "2026-10", "--db", db);
  assert.match(byClient.out, /Acme/);
  const summary = estela(home, BASE_PATH, "summary", "--month", "2026-10", "--db", db);
  assert.match(summary.out, /_Fuente: GitLab, leído el \d{4}-\d{2}-\d{2} con estela delivery\._/);
  assert.match(summary.out, /MR !11 Arregla stock negativo/);
});

test("sin glab lo explica, y git ya reconoce los merges de GitLab como MR", { skip: isWindows }, async () => {
  const { home, db, repo } = await entorno();
  const c = openDatabase(db);
  store.setProjectTracker(c, "tienda", { system: "gitlab", prefixes: [] });
  store.saveMerges(c, [{ repoPath: normalizePath(repo), hash: "m1", at: new Date("2026-10-18T10:00:00Z"),
    sourceBranch: "fix/stock", ref: "gitlab:!11", subject: "Merge branch 'fix/stock' into 'main'" }]);
  c.close();
  const r = estela(home, BASE_PATH, "delivery", "--project", "tienda", "--month", "2026-10", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /glab no está instalado: sin él no se puede leer el plan de GitLab/);
  assert.match(r.out, /MR !11 fix\/stock\s+30m\s+\$3\.00/);
  assert.match(estela(home, BASE_PATH, "delivery", "--project", "tienda", "--offline", "--db", db).out,
    /--offline: no se consulta GitLab\./);
});
