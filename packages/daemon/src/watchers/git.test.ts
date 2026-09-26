import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { baseName } from "../paths.js";
import { readCommits, repoRoot } from "./git.js";

/** Repo de verdad: lo que falla aquí falla contra git real, no contra un mock. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "estela-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe", env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Prueba", GIT_AUTHOR_EMAIL: "prueba@ejemplo.com",
      GIT_COMMITTER_NAME: "Prueba", GIT_COMMITTER_EMAIL: "prueba@ejemplo.com",
    } });

  git("init", "-q");
  git("config", "user.email", "prueba@ejemplo.com");
  git("config", "user.name", "Prueba");

  writeFileSync(join(dir, "a.txt"), Array.from({ length: 10 }, (_, i) => `linea ${i}`).join("\n") + "\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat: primer commit con diez líneas");

  writeFileSync(join(dir, "b.txt"), "una\ndos\ntres\n");
  git("add", "-A");
  git("commit", "-q", "-m", "feat(b): añade tres líneas más");

  return dir;
}

test("cuenta las líneas añadidas y borradas de cada commit", async () => {
  // El fallo que esto previene: con el separador de registro DETRÁS de la
  // cabecera, las líneas de --numstat se pegaban al commit siguiente y todos
  // los recuentos salían +0 −0.
  const dir = makeRepo();
  const commits = await readCommits(dir);

  assert.equal(commits.length, 2);

  const total = commits.reduce((s, c) => s + c.linesAdded, 0);
  assert.equal(total, 13, "10 líneas del primer commit + 3 del segundo");

  const primero = commits.find((c) => c.subject.includes("primer"));
  assert.ok(primero);
  assert.equal(primero.linesAdded, 10);
  assert.equal(primero.linesDeleted, 0);
});

test("lee hash, fecha, autor y asunto", async () => {
  const dir = makeRepo();
  const commits = await readCommits(dir);
  const c = commits[0]!;

  assert.match(c.hash, /^[0-9a-f]{40}$/);
  assert.equal(c.authorEmail, "prueba@ejemplo.com");
  assert.ok(c.subject.length > 0);
  assert.ok(!Number.isNaN(c.at.getTime()));
});

test("filtra por autor", async () => {
  const dir = makeRepo();
  assert.equal((await readCommits(dir, { authorEmail: "prueba@ejemplo.com" })).length, 2);
  assert.equal((await readCommits(dir, { authorEmail: "otro@ejemplo.com" })).length, 0);
});

test("un directorio que no es repo devuelve vacío en vez de lanzar", async () => {
  const dir = mkdtempSync(join(tmpdir(), "estela-norepo-"));
  assert.equal(await repoRoot(dir), null);
  assert.deepEqual(await readCommits(dir), []);
});

test("repoRoot funciona donde la comprobación de un .git como directorio fallaría", async () => {
  // En un `git worktree` el .git es un archivo, no un directorio. Por eso se
  // usa `git rev-parse --show-toplevel` y no `existsSync(join(dir, '.git'))`.
  const dir = makeRepo();
  const root = await repoRoot(dir);
  assert.ok(root);
  // baseName y no split("/"): en Windows la ruta del test va con \\ y la de git con /.
  assert.equal(baseName(root), baseName(dir));
});
