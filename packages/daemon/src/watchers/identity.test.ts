import assert from "node:assert/strict";
import { test } from "node:test";

import type { CommitRecord } from "@estela/shared";

import { sessionizeCommits } from "../billing/sessionize.js";
import { onlyMine } from "./identity.js";

function commit(email: string, iso: string, repo = "/repo"): CommitRecord {
  return {
    repoPath: repo, hash: `${email}-${iso}`, at: new Date(iso),
    authorEmail: email, authorName: email.split("@")[0]!, branch: "main",
    subject: "trabajo", linesAdded: 1, linesDeleted: 0, files: [],
  };
}

const MINE = new Map([["/repo", new Set(["yo@ejemplo.com"])]]);

test("el trabajo de un compañero nunca se convierte en horas tuyas", () => {
  // La regresión más cara que este sistema puede sufrir: desde que `commits`
  // guarda a todo el equipo, un filtro que falle te haría facturarle a un
  // cliente el trabajo de otra persona.
  const commits = [
    commit("yo@ejemplo.com", "2026-08-20T09:00:00Z"),
    commit("ana@empresa.com", "2026-08-20T10:00:00Z"),
    commit("ana@empresa.com", "2026-08-21T10:00:00Z"),
  ];

  const mine = onlyMine(commits, MINE);
  assert.equal(mine.length, 1);
  assert.equal(mine[0]!.authorEmail, "yo@ejemplo.com");

  const blocks = sessionizeCommits(mine);
  assert.equal(blocks.length, 1, "solo tu commit produce un bloque");
  assert.ok(blocks.every((b) => b.commits.every((c) => c.authorEmail === "yo@ejemplo.com")));
});

test("un repositorio sin autores conocidos no aporta horas", () => {
  // Preferimos perder horas a imputarte las de otro: quedarse corto se corrige
  // con `estela author`, haber facturado trabajo ajeno no.
  const commits = [commit("quien.sea@empresa.com", "2026-08-20T09:00:00Z", "/otro")];
  assert.equal(onlyMine(commits, MINE).length, 0);
  assert.equal(sessionizeCommits(onlyMine(commits, MINE)).length, 0);
});

test("los correos de un repositorio no valen en otro", () => {
  // Commiteas con un correo distinto en cada cliente. Si el filtro no
  // distinguiera el repositorio, capturarías commits ajenos allí donde otra
  // persona use el correo que tú usas aquí.
  const commits = [commit("yo@ejemplo.com", "2026-08-20T09:00:00Z", "/ajeno")];
  assert.equal(onlyMine(commits, MINE).length, 0);
});
