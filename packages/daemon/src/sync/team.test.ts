import assert from "node:assert/strict";
import { test } from "node:test";

import { openDatabase } from "../db/schema.js";
import * as store from "../db/store.js";
import { NoAccountError, NotSyncedError, syncTeamProject } from "./team.js";

function fresh() {
  const db = openDatabase(":memory:");
  store.upsertClient(db, { id: "team", name: "Proyectos de equipo", currency: "USD" });
  store.upsertProject(db, {
    id: "portal-ventas", clientId: "team", name: "Servicios socios cartera", repoPaths: [],
    billable: false, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "employment",
  });
  return db;
}

test("sin cuenta vinculada, pide login con el comando exacto", async () => {
  const db = fresh();
  try {
    await assert.rejects(
      syncTeamProject(db, "portal-ventas"),
      (error: unknown) => {
        assert.ok(error instanceof NoAccountError);
        assert.match(error.message, /estela login --email/);
        return true;
      });
  } finally { db.close(); }
});

test("con cuenta pero sin project_sync de equipo, pide aceptar la invitación", async () => {
  const db = fresh();
  try {
    store.setCloudAccount(db, {
      accountId: "acc_1", email: "dev@empresa.com", plan: "free",
      deviceToken: "tok", apiBaseUrl: "http://127.0.0.1:1", linkedAt: new Date(),
    });
    await assert.rejects(
      syncTeamProject(db, "portal-ventas"),
      (error: unknown) => {
        assert.ok(error instanceof NotSyncedError);
        assert.match(error.message, /estela team accept/);
        return true;
      });
  } finally { db.close(); }
});

test("con project_sync personal (no team) en ese proyecto, también pide aceptar", async () => {
  // Guarda: syncTeamProject nunca debe intentar mandar horas de equipo desde
  // una fila que en realidad es de sync personal.
  const db = fresh();
  try {
    store.setCloudAccount(db, {
      accountId: "acc_1", email: "dev@empresa.com", plan: "pro",
      deviceToken: "tok", apiBaseUrl: "http://127.0.0.1:1", linkedAt: new Date(),
    });
    store.setProjectSync(db, {
      projectId: "portal-ventas", scope: "personal",
      remoteProjectId: "portal-ventas", remoteOrgId: null, inviteToken: null,
    });
    await assert.rejects(syncTeamProject(db, "portal-ventas"), NotSyncedError);
  } finally { db.close(); }
});
