import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { money } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { seedDemo } from "./demo.js";
import { startServer } from "./server.js";

/**
 * Lo que el servidor local le da a la página de `estela web`.
 *
 * Los dos fallos que motivan este fichero eran del mismo tipo: la página leía
 * un campo que el servidor nunca mandaba. Sin `kind`, todas las tarjetas de
 * Proyectos decían "sin tarifa" aunque la tuvieran; sin `syncScope`, el botón
 * de Sincronizar solo salía a quien ya había publicado un panel. Nada fallaba:
 * los dos casos se veían como un estado normal.
 */

let puerto = 4700;

async function conServidor(
  preparar: (dbPath: string) => void,
  probar: (base: string) => Promise<void>,
  opciones: { demo?: boolean } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "estela-server-"));
  const dbPath = join(dir, "estela.db");
  const db = openDatabase(dbPath);
  try { preparar(dbPath); } finally { db.close(); }

  let server: Server | undefined;
  const base = await startServer({
    port: puerto++, dbPath, autoImportMinutes: 0, onServer: (s) => { server = s; },
    ...(opciones.demo ? { demo: true } : {}),
  });
  try {
    await probar(base);
  } finally {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
}

function sembrar(dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    store.upsertClient(db, { id: "acme", name: "ACME", currency: "EUR" });
    store.upsertProject(db, {
      id: "web", clientId: "acme", name: "Web de ACME", repoPaths: [],
      billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
    });
    store.upsertProject(db, {
      id: "nomina", clientId: "acme", name: "Trabajo en nómina", repoPaths: [],
      billable: false, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "employment",
    });
    store.addRatePeriod(db, {
      projectId: "web", hourlyRate: money(4500, "EUR"),
      effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null,
    });
    store.setProjectSync(db, {
      projectId: "web", scope: "personal", remoteProjectId: "web", remoteOrgId: null, inviteToken: null,
    });
  } finally { db.close(); }
}

test("/api/projects dice de qué tipo es cada proyecto y si sincroniza", async () => {
  await conServidor(sembrar, async (base) => {
    const r = await fetch(`${base}/api/projects`);
    const data = await r.json() as { projects: { id: string; kind: string; hourlyMinor: number | null; syncScope: string | null }[] };
    const web = data.projects.find((p) => p.id === "web")!;
    const nomina = data.projects.find((p) => p.id === "nomina")!;

    assert.equal(web.kind, "client", "sin kind, la tarjeta dice 'sin tarifa' a un proyecto que la tiene");
    assert.equal(web.hourlyMinor, 4500);
    assert.equal(web.syncScope, "personal", "sin syncScope, el botón de Sincronizar no aparece");
    assert.equal(nomina.kind, "employment");
    assert.equal(nomina.syncScope, null);
  });
});

test("los mensajes del servidor siguen el idioma de la página", async () => {
  await conServidor(sembrar, async (base) => {
    const en = await (await fetch(`${base}/api/no-existe`, { headers: { "X-Estela-Lang": "en" } })).json() as { error: string };
    const es = await (await fetch(`${base}/api/no-existe`)).json() as { error: string };
    assert.match(en.error, /^Unknown route/);
    assert.match(es.error, /^Ruta desconocida/, "sin cabecera, español: es lo que había");
  });
});

test("en demo, el botón de actualizar no lee los transcripts de quien mira", async () => {
  // Es la promesa que se le hace a quien ejecuta `estela demo`: no se lee nada
  // suyo. Un import en esa base metería su trabajo real entre los datos de
  // ejemplo, y dejaría de ser una demo.
  await conServidor(
    (dbPath) => {
      const db = openDatabase(dbPath);
      try { seedDemo(db, { now: new Date("2026-09-15T18:00:00") }); } finally { db.close(); }
    },
    async (base) => {
      const antes = await (await fetch(`${base}/api/summary?from=2026-08-01&to=2026-09-15`)).json() as { totalSeconds: number };
      const r = await (await fetch(`${base}/api/import`, { method: "POST" })).json() as { ok: boolean; blocks: number };
      assert.equal(r.ok, true, "no puede parecer un error: simplemente no hay nada que importar");
      assert.equal(r.blocks, 0);
      const despues = await (await fetch(`${base}/api/summary?from=2026-08-01&to=2026-09-15`)).json() as { totalSeconds: number };
      assert.equal(despues.totalSeconds, antes.totalSeconds, "la demo no puede cambiar al pulsar actualizar");
    },
    { demo: true });
});
