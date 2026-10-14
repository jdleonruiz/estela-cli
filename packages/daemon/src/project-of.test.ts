import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { weekStart } from "./metrics/quota.js";
import { loadQuotaReport } from "./quota.js";
import { normalizePath } from "./paths.js";
import { gitRoot, ownerResolver } from "./project-of.js";

/**
 * A qué proyecto va una sesión según su carpeta. El fallo de antes: una sesión
 * en `repo/src` de un repo sin registrar salía como "src", y una en un
 * worktree (que vive al lado del repo) no contaba para su proyecto.
 */

/** Un directorio temporal con la ruta real (en macOS /var es un enlace a /private/var). */
function tmp(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), "estela-root-")));
}

/** Un repo de mentira: basta la carpeta .git, no hace falta git. */
function repo(base: string, name: string): string {
  const r = join(base, name);
  mkdirSync(join(r, ".git", "worktrees"), { recursive: true });
  mkdirSync(join(r, "src"), { recursive: true });
  mkdirSync(join(r, "packages", "x", "src"), { recursive: true });
  return r;
}

/** Un worktree como lo deja `git worktree add`: un fichero .git que apunta al principal. */
function worktree(main: string, at: string, name: string, relative = false): string {
  const meta = join(main, ".git", "worktrees", name);
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(meta, "commondir"), "../..\n");
  mkdirSync(join(at, "lib"), { recursive: true });
  const gitdir = relative ? join("..", "web", ".git", "worktrees", name) : meta;
  writeFileSync(join(at, ".git"), `gitdir: ${gitdir}\n`);
  return at;
}

const n = (p: string) => normalizePath(p);

// ── gitRoot ─────────────────────────────────────────────────────────────

test("subcarpetas: repo/src y repo/packages/x llevan a la raíz del repo", () => {
  const base = tmp();
  const r = repo(base, "web");
  assert.equal(gitRoot(r), n(r));
  assert.equal(gitRoot(join(r, "src")), n(r));
  assert.equal(gitRoot(join(r, "packages", "x", "src")), n(r));
});

test("worktree: lleva al repositorio principal, con gitdir absoluto o relativo", () => {
  const base = tmp();
  const main = repo(base, "web");
  const wt = worktree(main, join(base, "web-feature"), "web-feature");
  assert.equal(gitRoot(wt), n(main));
  assert.equal(gitRoot(join(wt, "lib")), n(main));
  const rel = worktree(main, join(base, "web-fix"), "web-fix", true);
  assert.equal(gitRoot(rel), n(main));
});

test("submódulo: un .git fichero sin commondir es su propio repositorio", () => {
  const base = tmp();
  const main = repo(base, "web");
  const sub = join(main, "vendor", "lib");
  mkdirSync(join(main, ".git", "modules", "lib"), { recursive: true });
  mkdirSync(sub, { recursive: true });
  writeFileSync(join(sub, ".git"), `gitdir: ${join(main, ".git", "modules", "lib")}\n`);
  assert.equal(gitRoot(sub), n(sub));
});

test("fuera de git: null; y una carpeta que ya no existe no rompe nada", () => {
  const base = tmp();
  mkdirSync(join(base, "suelta"), { recursive: true });
  assert.equal(gitRoot(join(base, "suelta")), null);
  const r = repo(base, "web");
  assert.equal(gitRoot(join(r, "borrada", "hace", "tiempo")), n(r), "sube aunque la carpeta no exista");
});

test("una ruta relativa o con ~ no busca raíz git: no puede caer en el repo de quien ejecuta", () => {
  assert.equal(gitRoot("~/code/web"), null);
  assert.equal(gitRoot("src"), null);
});

test("con git de verdad: un worktree creado con git worktree add", (t) => {
  if (spawnSync("git", ["--version"]).status !== 0) { t.skip("sin git"); return; }
  const base = tmp();
  const main = join(base, "app");
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: main, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  };
  mkdirSync(main);
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
  git("worktree", "add", "-q", join(base, "app-feature"));
  assert.equal(gitRoot(join(base, "app-feature")), n(main));
});

// ── A qué proyecto va ───────────────────────────────────────────────────

function base() {
  const b = tmp();
  const web = repo(b, "web");
  const db = openDatabase(":memory:");
  store.upsertClient(db, { id: "c", name: "C", currency: "EUR" });
  store.upsertProject(db, { id: "web", clientId: "c", name: "Web", repoPaths: [n(web)], billable: true,
    roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
  return { b, web, db };
}

test("una sesión en una subcarpeta o en un worktree cuenta para el proyecto del repo", () => {
  const { b, web, db } = base();
  try {
    const owner = ownerResolver(db);
    const wt = worktree(web, join(b, "web-feature"), "web-feature");
    for (const dir of [web, join(web, "src"), join(web, "packages", "x"), wt, join(wt, "lib")]) {
      assert.deepEqual(owner(n(dir)), { kind: "project", projectId: "web" }, dir);
    }
  } finally { db.close(); }
});

test("un subproyecto registrado dentro del monorepo no se pierde al subir a la raíz", () => {
  const { web, db } = base();
  try {
    store.upsertProject(db, { id: "x", clientId: "c", name: "X", repoPaths: [n(join(web, "packages", "x"))],
      billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
    const owner = ownerResolver(db);
    assert.deepEqual(owner(n(join(web, "packages", "x", "src"))), { kind: "project", projectId: "x" });
    assert.deepEqual(owner(n(join(web, "src"))), { kind: "project", projectId: "web" });
  } finally { db.close(); }
});

test("sin proyecto: el nombre de la raíz git, nunca el de una subcarpeta; fuera de git, la carpeta", () => {
  const { b, db } = base();
  try {
    const otro = repo(b, "otro-repo");
    const owner = ownerResolver(db);
    assert.deepEqual(owner(n(join(otro, "packages", "x", "src"))), { kind: "folder", path: n(otro), name: "otro-repo", inGit: true });
    mkdirSync(join(b, "notas"));
    assert.deepEqual(owner(n(join(b, "notas"))), { kind: "folder", path: n(join(b, "notas")), name: "notas", inGit: false });
  } finally { db.close(); }
});

test("en quota, las subcarpetas de un repo sin registrar son una sola fila con su nombre", () => {
  const { b, db } = base();
  try {
    const otro = repo(b, "otro-repo");
    // Dentro de esta semana a cualquier hora, también un lunes a las 00:05.
    const at = new Date(Math.max(weekStart(new Date()).getTime(), Date.now() - 10 * 60_000));
    const turno = (id: string, cwd: string) => ({
      agent: "claude-code" as const, turnId: id, sessionId: "s", at, model: "claude-sonnet-4-6",
      repoPath: n(cwd), branch: null, producerVersion: null,
      tokens: { input: 0, output: 0, cacheRead: 100, cacheWrite5m: 0, cacheWrite1h: 0 },
    });
    store.saveTurns(db, [turno("a", join(otro, "src")), turno("b", join(otro, "packages", "x")), turno("c", otro)]);
    const filas = loadQuotaReport(db).agents[0]!.week.rows;
    assert.equal(filas.length, 1);
    assert.deepEqual(filas[0]!.bucket, { kind: "folder", folder: "otro-repo", path: n(otro) });
    assert.equal(filas[0]!.usage.total, 300);
  } finally { db.close(); }
});
