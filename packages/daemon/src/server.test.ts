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
// Puertos aparte para el test del puerto ocupado: no debe pisar a los demás.
let puertoOcupado = 5200;

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
    // Facturable pero sin tarifa vigente, a propósito: para probar el aviso
    // sin depender del proyecto de nómina, que ni siquiera llega a intentarlo.
    store.upsertProject(db, {
      id: "sin-tarifa", clientId: "acme", name: "Sin tarifa todavía", repoPaths: [],
      billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
    });
    store.addRatePeriod(db, {
      projectId: "web", hourlyRate: money(4500, "EUR"),
      effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null,
    });
    store.setProjectSync(db, {
      projectId: "web", scope: "personal", remoteProjectId: "web", remoteOrgId: null, inviteToken: null,
    });
    store.saveTimeEntry(db, {
      id: "te_web_1", projectId: "web",
      startedAt: new Date("2026-09-10T10:00:00Z"), endedAt: new Date("2026-09-10T12:00:00Z"),
      seconds: 7200, description: "Trabajo facturable", billable: true, invoiceId: null,
      aiCost: { microUsd: 0 }, agentSeconds: 7200, commitHashes: [], agents: ["claude-code"],
      source: "agent", kind: "development", branch: "main",
    });
    store.saveTimeEntry(db, {
      id: "te_sintarifa_1", projectId: "sin-tarifa",
      startedAt: new Date("2026-09-10T10:00:00Z"), endedAt: new Date("2026-09-10T11:00:00Z"),
      seconds: 3600, description: "Trabajo sin tarifa", billable: true, invoiceId: null,
      aiCost: { microUsd: 0 }, agentSeconds: 3600, commitHashes: [], agents: ["claude-code"],
      source: "agent", kind: "development", branch: "main",
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

// ── Corte de facturación desde la web ───────────────────────────────────

test("un corte desde la web marca las horas como facturadas y devuelve el PDF", async () => {
  await conServidor(sembrar, async (base) => {
    const antes = await (await fetch(`${base}/api/overview`)).json() as
      { unbilled: { projectId: string; seconds: number }[] };
    assert.ok(antes.unbilled.some((p) => p.projectId === "web" && p.seconds === 7200),
      "las 2h de partida tienen que verse como pendientes");

    const res = await fetch(`${base}/api/invoice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "web", cutoff: "2026-09-30", author: "Ana" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Content-Type"), "application/pdf");
    assert.match(res.headers.get("Content-Disposition") ?? "", /attachment; filename="INF-/);

    const pdf = Buffer.from(await res.arrayBuffer());
    assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF", "el cuerpo es un PDF de verdad");

    const despues = await (await fetch(`${base}/api/overview`)).json() as
      { unbilled: { projectId: string }[] };
    assert.ok(!despues.unbilled.some((p) => p.projectId === "web"),
      "tras el corte, esas horas ya no están pendientes");
  });
});

test("cortar un proyecto que no existe da 404, no un PDF vacío", async () => {
  await conServidor(sembrar, async (base) => {
    const res = await fetch(`${base}/api/invoice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "no-existe", cutoff: "2026-09-30" }),
    });
    assert.equal(res.status, 404);
    const body = await res.json() as { error: string };
    assert.match(body.error, /No existe el proyecto/);
  });
});

test("una fecha de corte inválida da 400 en vez de reventar", async () => {
  await conServidor(sembrar, async (base) => {
    const res = await fetch(`${base}/api/invoice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "web", cutoff: "no-es-una-fecha" }),
    });
    assert.equal(res.status, 400);
  });
});

test("sin horas pendientes, 400 con el motivo — no se cobra dos veces", async () => {
  await conServidor(sembrar, async (base) => {
    // Corte anterior a la única entrada del proyecto: nada que facturar ahí.
    const res = await fetch(`${base}/api/invoice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "web", cutoff: "2026-01-01" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.match(body.error, /No hay horas pendientes/);
  });
});

test("un proyecto facturable sin tarifa vigente avisa en vez de facturar a cero", async () => {
  await conServidor(sembrar, async (base) => {
    const res = await fetch(`${base}/api/invoice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "sin-tarifa", cutoff: "2026-09-30" }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string };
    assert.match(body.error, /Sin tarifa vigente/);
  });
});

test("crear un proyecto con un cliente nuevo que se llama como uno existente no le pisa la ficha", async () => {
  // El fallo real: el formulario de "proyecto nuevo" llamaba a upsertClient con
  // solo nombre y moneda. Si el nombre daba el mismo id que un cliente que ya
  // existía, su NIF, su correo y su idioma desaparecían sin ningún aviso.
  let ruta = "";
  await conServidor(
    (dbPath) => {
      ruta = dbPath;
      const db = openDatabase(dbPath);
      try {
        store.upsertClient(db, {
          id: "acme", name: "ACME", currency: "USD", taxId: "B-1",
          email: "ap@acme.test", language: "en",
        });
      } finally { db.close(); }
    },
    async (base) => {
      const r = await fetch(`${base}/api/projects`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Otro proyecto", clientName: "ACME", currency: "EUR" }),
      });
      assert.equal(r.status, 200);

      const db = openDatabase(ruta);
      try {
        const cliente = store.getClient(db, "acme")!;
        assert.equal(cliente.taxId, "B-1");
        assert.equal(cliente.email, "ap@acme.test");
        assert.equal(cliente.language, "en");
        assert.equal(cliente.currency, "USD", "la moneda que ya tenía, no la que vino en el formulario");
        assert.equal(store.getProject(db, "otro-proyecto")?.clientId, "acme",
          "el proyecto se creó y quedó colgado de ese cliente");
      } finally { db.close(); }
    },
  );
});

test("crear un proyecto con un cliente de verdad nuevo lo crea con su moneda", async () => {
  let ruta = "";
  await conServidor(
    (dbPath) => { ruta = dbPath; },
    async (base) => {
      const r = await fetch(`${base}/api/projects`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Web", clientName: "Northwind", currency: "gbp" }),
      });
      assert.equal(r.status, 200);
      const db = openDatabase(ruta);
      try {
        const c = store.getClient(db, "northwind")!;
        assert.equal(c.name, "Northwind");
        assert.equal(c.currency, "GBP");
        assert.equal(c.language, undefined, "sin idioma: sigue el del navegador");
      } finally { db.close(); }
    },
  );
});

test("un puerto ocupado da un error explicado, no una traza de Node", async () => {
  // Reportado con la traza entera en pantalla: "Unhandled 'error' event …
  // EADDRINUSE". Pasaba porque startServer resolvía la promesa en listen() y
  // no escuchaba el evento 'error', así que el fallo salía por el canal que
  // mata el proceso. Un puerto ocupado es previsible —casi siempre otro
  // `estela web` abierto— y se avisa, no se vuelca.
  const dir = mkdtempSync(join(tmpdir(), "estela-puerto-"));
  const dbPath = join(dir, "estela.db");
  openDatabase(dbPath).close();

  const puerto = puertoOcupado++;
  let primero: Server | undefined;
  await startServer({ port: puerto, dbPath, autoImportMinutes: 0, onServer: (s) => { primero = s; } });

  try {
    await assert.rejects(
      () => startServer({ port: puerto, dbPath, autoImportMinutes: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        const texto = (error as Error).message;
        // Tiene que decir el puerto y qué hacer, no "EADDRINUSE" a secas.
        assert.match(texto, new RegExp(String(puerto)), "debe nombrar el puerto");
        assert.match(texto, /--port/, "debe ofrecer la salida");
        assert.doesNotMatch(texto, /EADDRINUSE/, "el código de errno no le dice nada a nadie");
        return true;
      });
  } finally {
    await new Promise<void>((resolve) => primero!.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  }
});

test("el día separa lo ya facturado de lo que queda por facturar", async () => {
  // Hasta aquí la cabecera sumaba todo y lo etiquetaba "por facturar", así
  // que tras un corte contaba como pendiente dinero ya cobrado. En un día
  // mixto ese número no era ni una cosa ni la otra.
  await conServidor(
    (dbPath) => {
      sembrar(dbPath);
      const db = openDatabase(dbPath);
      try {
        // Dos horas más el mismo día, y las primeras ya facturadas.
        store.saveTimeEntry(db, {
          id: "te_web_2", projectId: "web",
          startedAt: new Date("2026-09-10T14:00:00Z"), endedAt: new Date("2026-09-10T15:00:00Z"),
          seconds: 3600, description: "Trabajo nuevo", billable: true, invoiceId: null,
          aiCost: { microUsd: 0 }, agentSeconds: 0, commitHashes: [], agents: [],
          source: "agent", kind: "development", branch: "main",
        });
        db.prepare(`
          INSERT INTO invoices (id, number, client_id, project_id, issued_at, cutoff_at,
            period_start, currency, subtotal_minor, total_minor, total_seconds, ai_micro_usd, lines_json)
          VALUES ('inv_1','INF-2026-007','acme','web','2026-09-10T13:00:00.000Z',
                  '2026-09-10T12:59:59.000Z','2026-09-01T00:00:00.000Z','EUR',9000,9000,7200,0,'[]')
        `).run();
        db.prepare("UPDATE time_entries SET invoice_id = 'inv_1' WHERE id = 'te_web_1'").run();
      } finally { db.close(); }
    },
    async (base) => {
      const day = await (await fetch(`${base}/api/day?date=2026-09-10`)).json() as {
        totalSeconds: number; invoicedSeconds: number; pendingSeconds: number;
        totals: { currency: string; amountMinor: number }[];
        entries: { id: string; invoiced: boolean; invoiceNumber: string | null }[];
      };

      // El sembrado ya trae 2h en "web" y 1h en "sin-tarifa" ese día; el test
      // añade 1h más. Total 4h, de las que solo las 2h de "web" se facturaron.
      assert.equal(day.totalSeconds, 14400, "el total sigue siendo todo lo del día");
      assert.equal(day.invoicedSeconds, 7200, "2h ya facturadas");
      assert.equal(day.pendingSeconds, 7200, "2h por facturar");

      // El importe etiquetado "por facturar" solo puede contar lo pendiente:
      // 1h a 45 €/h son 45,00 €, no las 3h.
      assert.equal(day.totals.length, 1);
      // 1h a 45 €/h. La hora de "sin-tarifa" no suma importe porque no tiene
      // tarifa, y las 2h facturadas ya no cuentan aquí.
      assert.equal(day.totals[0]!.amountMinor, 4500, "solo la hora pendiente con tarifa");

      // Y cada bloque dice en qué corte entró, sin tener que desplegarlo.
      const facturada = day.entries.find((e) => e.id === "te_web_1")!;
      assert.equal(facturada.invoiced, true);
      assert.equal(facturada.invoiceNumber, "INF-2026-007");
      const nueva = day.entries.find((e) => e.id === "te_web_2")!;
      assert.equal(nueva.invoiced, false);
      assert.equal(nueva.invoiceNumber, null);
    });
});
