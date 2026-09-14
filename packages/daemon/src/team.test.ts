import assert from "node:assert/strict";
import { test } from "node:test";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { emailsOverlap } from "./metrics/team.js";
import { acceptTeamInvite, inviteTeamMember, NoAccountError } from "./team.js";

/**
 * Igual que `publish.test.ts`/`sync.test.ts`: aquí solo lo que falla ANTES de
 * tocar la red. El round-trip real (invitar, aceptar, mandar horas) ya lo
 * cubre `packages/api/src/team.test.ts`, que es donde vive esa lógica.
 */

function fresh() {
  const db = openDatabase(":memory:");
  store.upsertClient(db, { id: "acme", name: "ACME", currency: "EUR" });
  store.upsertProject(db, {
    id: "web", clientId: "acme", name: "Web de ACME", repoPaths: [],
    billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
  });
  return db;
}

test("invitar sin cuenta vinculada pide login con el comando exacto", async () => {
  const db = fresh();
  try {
    await assert.rejects(
      inviteTeamMember(db, { projectId: "web", emails: ["dev@empresa.com"], inviteeKind: "employee" }),
      (error: unknown) => {
        assert.ok(error instanceof NoAccountError);
        assert.match(error.message, /estela login --email/);
        return true;
      });
  } finally { db.close(); }
});

test("invitar a un proyecto que no existe falla antes de llamar a la red", async () => {
  const db = fresh();
  try {
    // El plan que cuenta para el candado de Teams es el que guarda el
    // servidor, no este campo local (aquí solo hace falta que exista
    // cuenta) — por eso "pro" basta para este caso, que falla antes de
    // llegar a hablar con el servidor en absoluto.
    store.setCloudAccount(db, {
      accountId: "acc_1", email: "yo@test.com", plan: "pro",
      deviceToken: "tok", apiBaseUrl: "http://127.0.0.1:1", linkedAt: new Date(),
    });
    await assert.rejects(
      inviteTeamMember(db, { projectId: "no-existe", emails: ["dev@empresa.com"], inviteeKind: "employee" }),
      /No existe el proyecto/);
  } finally { db.close(); }
});

test("aceptar sin cuenta vinculada pide login con el comando exacto", async () => {
  const db = fresh();
  try {
    await assert.rejects(
      acceptTeamInvite(db, { token: "cualquiera", localProjectId: "portal-ventas" }),
      (error: unknown) => {
        assert.ok(error instanceof NoAccountError);
        assert.match(error.message, /estela login --email/);
        return true;
      });
  } finally { db.close(); }
});

test("aceptar con un id local ya usado por otro proyecto se rechaza antes de tocar nada", async () => {
  const db = fresh();
  try {
    store.setCloudAccount(db, {
      accountId: "acc_1", email: "yo@test.com", plan: "free",
      deviceToken: "tok", apiBaseUrl: "http://127.0.0.1:1", linkedAt: new Date(),
    });
    // "web" ya existe (creado por fresh()) y no tiene ningún project_sync con
    // este token — debe rechazarse sin intentar la llamada de red siquiera.
    await assert.rejects(
      acceptTeamInvite(db, { token: "tok_nuevo", localProjectId: "web" }),
      /Ya existe un proyecto local/);
  } finally { db.close(); }
});

test("emailsOverlap es case-insensitive y no exige coincidencia exacta de listas", () => {
  assert.ok(emailsOverlap(["Dev@Empresa.com"], ["dev@empresa.com", "otro@x.com"]));
  assert.ok(!emailsOverlap(["nadie@x.com"], ["dev@empresa.com"]));
  assert.ok(!emailsOverlap([], ["dev@empresa.com"]));
});

test("sumEntrySeconds suma sin filtrar por facturable", () => {
  const db = fresh();
  try {
    store.saveTimeEntry(db, {
      id: "te_1", projectId: "web",
      startedAt: new Date("2026-01-01T09:00:00Z"), endedAt: new Date("2026-01-01T10:00:00Z"),
      seconds: 1800, description: "a", billable: true, invoiceId: null,
      aiCost: { microUsd: 0 }, agentSeconds: 1800, commitHashes: [], agents: [],
      source: "manual", kind: "development", branch: null,
    });
    store.saveTimeEntry(db, {
      id: "te_2", projectId: "web",
      startedAt: new Date("2026-01-02T09:00:00Z"), endedAt: new Date("2026-01-02T10:00:00Z"),
      seconds: 900, description: "b", billable: false, invoiceId: null,
      aiCost: { microUsd: 0 }, agentSeconds: 900, commitHashes: [], agents: [],
      source: "manual", kind: "development", branch: null,
    });
    assert.equal(store.sumEntrySeconds(db, "web"), 2700);
    assert.equal(store.sumEntrySeconds(db, "no-existe"), 0);
  } finally { db.close(); }
});

test("addProjectRepo solo toca project_repos, no kind ni billable", () => {
  const db = fresh();
  try {
    store.upsertProject(db, {
      id: "team-proj", clientId: "acme", name: "Proyecto de equipo", repoPaths: [],
      billable: false, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "employment",
    });
    store.addProjectRepo(db, "team-proj", "/home/dev/code/portal-ventas");
    const project = store.getProject(db, "team-proj");
    assert.equal(project!.billable, false);
    assert.equal(project!.kind, "employment");
    assert.deepEqual(project!.repoPaths, ["/home/dev/code/portal-ventas"]);
  } finally { db.close(); }
});
