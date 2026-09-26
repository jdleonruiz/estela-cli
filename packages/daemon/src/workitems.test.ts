import assert from "node:assert/strict";
import { test } from "node:test";

import { extractWorkItems, formatWorkItem, parseWorkItem, type WorkItemTracker } from "@estela/shared";

const jira: WorkItemTracker = { system: "jira", prefixes: ["PROJ", "OPS"] };
const jiraLibre: WorkItemTracker = { system: "jira", prefixes: [] };
const azure: WorkItemTracker = { system: "azure", prefixes: [] };
const github: WorkItemTracker = { system: "github", prefixes: [] };

// [rama, mensajes de commit, gestor, lo esperado]. Los falsos positivos pesan
// tanto como los aciertos: una clave inventada imputa horas a otro trabajo.
const CASOS: [string | null, string[], WorkItemTracker | null, string[]][] = [
  // Sin gestor: solo lo inequívoco.
  ["feature/PROJ-12-login", [], null, ["jira:PROJ-12"]],
  ["fix/UTF-8-encoding", [], null, []],
  ["feature/sha-256", [], null, []],
  ["feature/1234-login", [], null, []],
  ["main", ["Arregla login AB#1234"], null, ["azure:1234"]],
  ["main", ["PROJ-12 arregla login"], null, []],

  // Jira con prefijos: también en minúscula, y solo esos proyectos.
  ["feature/proj-12-login", [], jira, ["jira:PROJ-12"]],
  ["main", ["OPS-7: rota el certificado", "UTF-8 en el CSV"], jira, ["jira:OPS-7"]],
  ["feature/ABC-9", [], jira, []],
  ["feature/PROJ-12", ["PROJ-12 y PROJ-13"], jira, ["jira:PROJ-12", "jira:PROJ-13"]],
  ["main", ["Sube a SHA-256 (PAY-4)"], jiraLibre, ["jira:PAY-4"]],

  // Azure: número en la rama y AB# en los commits.
  ["feature/1234-login", ["AB#1234 login", "AB#99 de paso"], azure, ["azure:1234", "azure:99"]],
  ["users/ana/5678-pagos", [], azure, ["azure:5678"]],
  ["5678", [], azure, ["azure:5678"]],
  ["release/2024", [], azure, []],
  ["hotfix/2024-10-01", [], azure, []],
  ["feature/login", [], azure, []],
  ["feature/login-1234", [], azure, []],

  // GitHub: #12 en commits, número al principio de la rama.
  ["12-fix-login", ["Fixes #12", "Ver #13 y AB#5", "&#12; no"], github, ["github:12", "azure:5", "github:13"]],
  [null, ["sin rama #7"], github, ["github:7"]],
  ["main", ["Fixes #12"], null, []],
];

test("detecta tickets en rama y commits, sin inventarlos", () => {
  for (const [rama, commits, gestor, esperado] of CASOS) {
    assert.deepEqual(extractWorkItems(rama, commits, gestor), esperado,
      `${rama} · ${JSON.stringify(commits)} · ${gestor?.system ?? "sin gestor"}`);
  }
});

test("una clave se enseña como la escribe cada gestor, y se lee de vuelta", () => {
  assert.equal(formatWorkItem("jira:PROJ-12"), "PROJ-12");
  assert.equal(formatWorkItem("azure:1234"), "AB#1234");
  assert.equal(formatWorkItem("github:12"), "#12");

  assert.equal(parseWorkItem("proj-12"), "jira:PROJ-12");
  assert.equal(parseWorkItem("AB#1234"), "azure:1234");
  assert.equal(parseWorkItem("1234", azure), "azure:1234");
  assert.equal(parseWorkItem("#12", github), "github:12");
  // Un número suelto sin gestor no se sabe de quién es.
  assert.equal(parseWorkItem("1234"), null);
  assert.equal(parseWorkItem("1234", jira), null);
});
