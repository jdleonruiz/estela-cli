import assert from "node:assert/strict";
import { test } from "node:test";

import type { CommitRecord, TimeEntry } from "@estela/shared";

import { teamView } from "./team.js";

function commit(
  name: string, email: string, iso: string, branch = "main",
): CommitRecord {
  return {
    repoPath: "/repo", hash: `${name}-${iso}`, at: new Date(iso),
    authorEmail: email, authorName: name, branch,
    subject: "trabajo", linesAdded: 10, linesDeleted: 2, files: [],
  };
}

function entry(seconds: number): TimeEntry {
  return {
    id: "te_1", projectId: "p", startedAt: new Date("2026-08-20T09:00:00Z"),
    endedAt: new Date("2026-08-20T12:00:00Z"), seconds,
    description: "medido", billable: true, invoiceId: null,
    aiCost: { microUsd: 0 }, agentSeconds: seconds, commitHashes: [],
    agents: ["claude-code"], source: "agent", kind: "development", branch: "main",
  };
}

const COMMITS: CommitRecord[] = [
  commit("Yo", "yo@ejemplo.com", "2026-08-20T10:00:00Z"),
  commit("Ana Ruiz", "ana@empresa.com", "2026-08-21T09:00:00Z", "feat/pagos"),
  commit("Ana Ruiz", "ana@empresa.com", "2026-08-21T10:00:00Z", "feat/pagos"),
  commit("aruiz", "ana@empresa.com", "2026-08-22T09:00:00Z", "feat/pagos"),
];

test("las horas de un compañero salen de sus commits", () => {
  const team = teamView(COMMITS, {
    myEmails: new Set(["yo@ejemplo.com"]), myEntries: [],
  });
  const ana = team.find((p) => p.name === "Ana Ruiz");
  assert.ok(ana, "no se encontró a Ana");
  assert.equal(ana.commits, 3, "sus tres identidades deben unirse");
  assert.ok(ana.seconds > 0, "sin horas, la fila no dice nada");
  assert.equal(ana.measured, false, "las de un compañero son estimadas");
});

test("tus horas son las medidas, no una reestimación de tus commits", () => {
  const team = teamView(COMMITS, {
    myEmails: new Set(["yo@ejemplo.com"]), myEntries: [entry(7200)],
  });
  const yo = team.find((p) => p.isMe);
  assert.ok(yo);
  assert.equal(yo.seconds, 7200, "debe usar la imputación real");
  assert.equal(yo.measured, true);
});

test("sin imputaciones tuyas, tu fila también queda estimada", () => {
  // Si no se marcara, tus horas parecerían medidas sin serlo.
  const team = teamView(COMMITS, {
    myEmails: new Set(["yo@ejemplo.com"]), myEntries: [],
  });
  assert.equal(team.find((p) => p.isMe)?.measured, false);
});

test("no se ordena por horas: eso sería un ranking de rendimiento", () => {
  const team = teamView(COMMITS, {
    myEmails: new Set(["yo@ejemplo.com"]),
    myEntries: [entry(360_000)],   // muchísimas horas para mí
  });
  // Ana commiteó después, así que va primera pese a tener menos horas.
  assert.equal(team[0]!.name, "Ana Ruiz");
});

test("recoge las ramas en las que anda cada persona", () => {
  const team = teamView(COMMITS, {
    myEmails: new Set(["yo@ejemplo.com"]), myEntries: [],
  });
  assert.deepEqual(team.find((p) => p.name === "Ana Ruiz")?.branches, ["feat/pagos"]);
});

test("tus varias identidades de git son una sola fila", () => {
  // Commiteas con el correo de cada cliente y con el que te da GitHub. Nada las
  // relaciona en git, así que salías dos veces y cada fila enseñaba tus horas
  // completas: el mismo tiempo contado dos veces en pantalla.
  const commits = [
    commit("JDev Leon", "yo@cliente.com", "2026-08-20T10:00:00Z"),
    commit("jdleon", "1234+jd@users.noreply.github.com", "2026-08-21T10:00:00Z"),
    commit("Ana Ruiz", "ana@empresa.com", "2026-08-22T10:00:00Z"),
  ];

  const team = teamView(commits, {
    myEmails: new Set(["yo@cliente.com", "1234+jd@users.noreply.github.com"]),
    myEntries: [entry(7200)],
  });

  const me = team.filter((p) => p.isMe);
  assert.equal(me.length, 1, "debes salir una sola vez");
  assert.equal(me[0]!.seconds, 7200, "tus horas se cuentan una vez");
  assert.equal(me[0]!.commits, 2, "y arrastran los commits de ambas identidades");
  assert.equal(team.length, 2, "Ana sigue siendo otra persona");
});
