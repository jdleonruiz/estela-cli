import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AgentTurn } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { normalizePath } from "./paths.js";
import { readCommits, readMerges } from "./watchers/git.js";

/**
 * `estela ai-cost --undelivered` contra un repo git de verdad, con datos
 * inventados. Los casos que más engañan: el commit hecho en una subcarpeta, el
 * PR fusionado y borrado, y el squash, que no deja rastro en git.
 */

const BIN = join(__dirname, "bin.js");
const DAY = 86_400_000;
const NOW = Date.now();
const hace = (dias: number, min = 0) => new Date(NOW - dias * DAY + min * 60_000);

function estela(home: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", input: "",
    env: { ...process.env, HOME: home, USERPROFILE: home, ESTELA_LANG: "es", NO_COLOR: "1", ESTELA_NO_UPDATE_CHECK: "1" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

async function entorno() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "estela-undelivered-")));
  const repo = join(home, "tienda");
  mkdirSync(join(repo, "src"), { recursive: true });
  const git = (when: Date | null, ...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe", env: {
    ...process.env, GIT_AUTHOR_NAME: "Ana", GIT_AUTHOR_EMAIL: "ana@ejemplo.com",
    GIT_COMMITTER_NAME: "Ana", GIT_COMMITTER_EMAIL: "ana@ejemplo.com",
    ...(when ? { GIT_AUTHOR_DATE: when.toISOString(), GIT_COMMITTER_DATE: when.toISOString() } : {}),
  } });
  const commit = (when: Date, file: string, msg: string) => {
    writeFileSync(join(repo, file), `${msg}\n`);
    git(when, "add", "-A");
    git(when, "commit", "-q", "-m", msg);
  };

  const path = join(home, ".estela", "estela.db");
  mkdirSync(join(home, ".estela"));
  const db = openDatabase(path);
  // Como el import automático: lo que se lee antes de borrar una rama se queda.
  const importar = async () => {
    store.saveCommits(db, await readCommits(repo));
    store.saveMerges(db, await readMerges(repo));
  };

  git(null, "init", "-q", "-b", "main");
  commit(hace(100), "README", "inicio");
  // PR fusionado con merge y la rama borrada después; el commit, en src/.
  git(null, "checkout", "-q", "-b", "feat/fusionada");
  commit(hace(40, 3), "src/a.txt", "feat: a");
  git(null, "checkout", "-q", "main");
  git(hace(39), "merge", "-q", "--no-ff", "feat/fusionada", "-m", "Merge pull request #5 from ana/feat/fusionada");
  git(null, "branch", "-q", "-D", "feat/fusionada");
  // Squash: en main queda "Título (#7)" y la rama se borra.
  git(null, "checkout", "-q", "-b", "feat/squash");
  commit(hace(35, 3), "b.txt", "feat: b");
  await importar();
  git(null, "checkout", "-q", "main");
  git(null, "merge", "-q", "--squash", "feat/squash");
  git(hace(34), "commit", "-q", "-m", "Feature b (#7)");
  git(null, "branch", "-q", "-D", "feat/squash");
  // Una rama que sigue ahí, sin fusionar, desde hace 30 días.
  git(null, "checkout", "-q", "-b", "feat/vieja");
  commit(hace(30, 3), "c.txt", "feat: c");
  git(null, "checkout", "-q", "main");

  store.upsertClient(db, { id: "acme", name: "Acme", currency: "EUR" });
  store.upsertProject(db, { id: "tienda", clientId: "acme", name: "Tienda", repoPaths: [normalizePath(repo)],
    billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  store.setProjectAuthors(db, "tienda", ["ana@ejemplo.com"]);
  await importar();

  let k = 0;
  const sesion = (id: string, start: Date, n: number, branch: string, cwd = repo): AgentTurn[] =>
    Array.from({ length: n }, (_, i) => ({
      agent: "claude-code" as const, turnId: `t${k++}`, sessionId: id, at: new Date(start.getTime() + i * 60_000),
      model: "claude-sonnet-4-6", repoPath: normalizePath(cwd), branch, producerVersion: null,
      tokens: { input: 100_000, output: 10_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    }));
  store.saveTurns(db, [
    ...sesion("fusionada", hace(40), 5, "feat/fusionada", join(repo, "src")),
    ...sesion("squash", hace(35), 5, "feat/squash"),
    ...sesion("vieja", hace(30), 5, "feat/vieja"),
    ...sesion("sin-commit", hace(20), 5, "main"),
  ]);
  db.close();
  return { home, path };
}

test("cada caso a su sitio: sin commit, rama vieja, squash desconocido y PR fusionado fuera", async () => {
  const { home, path } = await entorno();
  const r = estela(home, "ai-cost", "--undelivered", "--db", path);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Gasto de IA sin entrega · todo el historial · ramas sin fusionar tras 14 días\n/);
  assert.match(r.out, /Es una señal para revisar, no un juicio/);
  assert.match(r.out, /\nTienda · Acme\n/);
  assert.match(r.out, /  Sesiones sin commit \(1\)\s+\$2,25\s+—\s+25\.0 %/);
  assert.match(r.out, /  Ramas sin fusionar tras 14 días \(1\)/);
  assert.match(r.out, /      feat\/vieja · sin actividad hace 29 días/);
  assert.match(r.out, /No cuenta: 1 ramas borradas sin merge registrado .*: feat\/squash/);
  assert.doesNotMatch(r.out, /feat\/fusionada/, "fusionada con su merge, aunque la rama ya no exista");
  assert.match(r.out, /Sin entrega en total\s+\$4,50\s+—\s+50\.0 %/);
});

test("--json: las cifras y los estados, y --stale-days cambia el plazo", async () => {
  const { home, path } = await entorno();
  type J = { staleDays: number; projects: { sessionsWithoutCommit: { count: number; apiMicroUsd: number };
    unmergedBranches: { branches: { branch: string }[] }; notCounted: { branch: string; state: string }[];
    undelivered: { percentOfSpend: number }; total: { apiMicroUsd: number } }[] };
  const j = JSON.parse(estela(home, "ai-cost", "--undelivered", "--json", "--db", path).out) as J;
  const p = j.projects[0]!;
  assert.equal(j.staleDays, 14);
  assert.equal(p.sessionsWithoutCommit.count, 1);
  // Cuatro sesiones iguales: una sin commit y una en rama vieja son la mitad.
  assert.equal(p.undelivered.percentOfSpend, 50);
  assert.deepEqual(p.notCounted.map((b) => [b.branch, b.state]), [["feat/squash", "unknown"]]);

  const largo = JSON.parse(estela(home, "ai-cost", "--undelivered", "--stale-days", "60", "--json", "--db", path).out) as J;
  assert.deepEqual(largo.projects[0]!.unmergedBranches.branches, []);
  assert.deepEqual(largo.projects[0]!.notCounted.map((b) => b.state).sort(), ["open", "unknown"]);
});

test("--csv, el periodo, y los errores de uso", async () => {
  const { home, path } = await entorno();
  const out = join(home, "sin-entrega.csv");
  assert.equal(estela(home, "ai-cost", "--undelivered", "--csv", out, "--db", path).code, 0);
  const lines = readFileSync(out, "utf8").replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "proyecto,cliente,bloque,detalle,cuenta,dias_sin_actividad,coste_ia_usd_equiv_api,gasto_real,moneda,gasto_real_parcial,pct_del_gasto");
  assert.ok(lines.some((l) => l.startsWith("Tienda,Acme,rama_sin_fusionar,feat/vieja,si,29,")), lines.join("\n"));
  assert.ok(lines.some((l) => l.startsWith("Tienda,Acme,rama_desconocida,feat/squash,no,")), lines.join("\n"));

  const vacio = estela(home, "ai-cost", "--undelivered", "--from", "2000-01-01", "--to", "2000-01-31", "--db", path);
  assert.match(vacio.out, /No hay gasto de IA en ese periodo\./);
  assert.match(estela(home, "ai-cost", "--undelivered", "--stale-days", "0", "--db", path).out,
    /--stale-days va como un número entero de días, 1 o más\./);
  assert.match(estela(home, "ai-cost", "--undelivered", "--by", "branch", "--db", path).out,
    /--by y --undelivered van por separado/);
});
