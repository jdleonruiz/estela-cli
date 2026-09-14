import assert from "node:assert/strict";
import { test } from "node:test";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { NoAccountError, NotSyncedError, syncProject } from "./sync.js";

/**
 * Igual que `publish.test.ts`: aquí solo lo que falla ANTES de tocar la red
 * (sin cuenta, sin proyecto activado). El round-trip real de push/pull ya lo
 * cubren los tests de `packages/api` — es donde vive esa lógica — y el
 * merge local (`applySyncedEntry`) se prueba aquí directo contra la base,
 * sin pasar por la red en absoluto.
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

test("sin cuenta vinculada, pide login con el comando exacto", async () => {
  const db = fresh();
  try {
    await assert.rejects(
      syncProject(db, "web"),
      (error: unknown) => {
        assert.ok(error instanceof NoAccountError);
        assert.match(error.message, /estela login --email/);
        return true;
      });
  } finally { db.close(); }
});

test("con cuenta pero sin activar, pide el comando exacto de activación", async () => {
  const db = fresh();
  try {
    store.setCloudAccount(db, {
      accountId: "acc_1", email: "yo@test.com", plan: "pro",
      deviceToken: "tok", apiBaseUrl: "http://127.0.0.1:1", linkedAt: new Date(),
    });
    await assert.rejects(
      syncProject(db, "web"),
      (error: unknown) => {
        assert.ok(error instanceof NotSyncedError);
        assert.match(error.message, /estela sync enable --project web/);
        return true;
      });
  } finally { db.close(); }
});

test("listPersonalSyncCandidates excluye un proyecto ya enlazado a un equipo", () => {
  const db = fresh();
  try {
    store.setProjectSync(db, {
      projectId: "web", scope: "team", remoteProjectId: "web",
      remoteOrgId: "org_1", inviteToken: "inv_1",
    });
    assert.ok(!store.listPersonalSyncCandidates(db).includes("web"));
  } finally { db.close(); }
});

test("applySyncedEntry: una fila más reciente de otra máquina gana sobre la local", () => {
  const db = fresh();
  try {
    store.saveTimeEntry(db, {
      id: "te_1", projectId: "web",
      startedAt: new Date("2026-01-01T09:00:00Z"), endedAt: new Date("2026-01-01T10:00:00Z"),
      seconds: 3600, description: "vieja", billable: true, invoiceId: null,
      aiCost: { microUsd: 1000 }, agentSeconds: 3600, commitHashes: [], agents: [],
      source: "manual", kind: "development", branch: null,
    }, new Date("2026-01-01T10:00:00Z"));

    store.applySyncedEntry(db, {
      id: "te_1", startedAt: "2026-01-01T09:00:00.000Z", localDate: "2026-01-01",
      endedAt: "2026-01-01T11:00:00.000Z", seconds: 7200, description: "nueva de otra máquina",
      billable: true, aiMicroUsd: 2000, agentSeconds: 7200, commitHashes: "", agents: "",
      source: "manual", kind: "development", branch: null,
      updatedAt: "2026-01-02T00:00:00.000Z",
    }, "web");

    const [saved] = store.getTimeEntries(db, "web");
    assert.equal(saved!.description, "nueva de otra máquina");
  } finally { db.close(); }
});

test("applySyncedEntry: una fila más vieja que la local no la pisa", () => {
  const db = fresh();
  try {
    store.saveTimeEntry(db, {
      id: "te_1", projectId: "web",
      startedAt: new Date("2026-01-01T09:00:00Z"), endedAt: new Date("2026-01-01T10:00:00Z"),
      seconds: 3600, description: "actual", billable: true, invoiceId: null,
      aiCost: { microUsd: 1000 }, agentSeconds: 3600, commitHashes: [], agents: [],
      source: "manual", kind: "development", branch: null,
    }, new Date("2026-01-02T00:00:00Z"));

    store.applySyncedEntry(db, {
      id: "te_1", startedAt: "2026-01-01T09:00:00.000Z", localDate: "2026-01-01",
      endedAt: "2026-01-01T10:00:00.000Z", seconds: 3600, description: "vieja de otra máquina",
      billable: true, aiMicroUsd: 500, agentSeconds: 3600, commitHashes: "", agents: "",
      source: "manual", kind: "development", branch: null,
      updatedAt: "2026-01-01T10:00:00.000Z",
    }, "web");

    const [saved] = store.getTimeEntries(db, "web");
    assert.equal(saved!.description, "actual");
  } finally { db.close(); }
});
