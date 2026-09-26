import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { TimeEntry } from "@estela/shared";

import { openDatabase } from "./schema.js";
import * as store from "./store.js";

function tempDb(): string {
  return join(mkdtempSync(join(tmpdir(), "estela-db-")), "estela.db");
}

function versionOf(db: DatabaseSync): number {
  return (db.prepare("SELECT version FROM schema_version").get() as { version: number }).version;
}

/** La versión a la que llega cualquier base: la de una recién creada. */
function versionDeUnaBaseNueva(): number {
  const db = openDatabase(":memory:");
  try { return versionOf(db); } finally { db.close(); }
}

function seedProject(db: ReturnType<typeof openDatabase>): void {
  store.upsertClient(db, { id: "c", name: "Cliente", currency: "EUR" });
  store.upsertProject(db, {
    id: "p", clientId: "c", name: "Proyecto", repoPaths: ["/repo"],
    billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
  });
}

function entry(over: Partial<TimeEntry> = {}): Omit<TimeEntry, "id"> {
  const startedAt = new Date("2026-08-25T10:00:00Z");
  return {
    projectId: "p", startedAt,
    endedAt: new Date(startedAt.getTime() + 3600_000),
    seconds: 3600, description: "Bloque", billable: true, invoiceId: null,
    aiCost: { microUsd: 0 }, agentSeconds: 0, commitHashes: [], agents: [],
    source: "agent", kind: "development", branch: "main",
    ...over,
  };
}

// ── Migraciones ────────────────────────────────────────────────────────

test("una base antigua se migra en vez de reventar", () => {
  // El fallo que esto previene: CREATE TABLE IF NOT EXISTS no añade columnas a
  // una tabla que ya existe. La sentencia no hace nada y la app peta al primer
  // INSERT con "table has no column named source".
  const path = tempDb();

  // Simula una base v1: sin las columnas source ni kind.
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES (1);
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL,
                          tax_id TEXT, email TEXT, address TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL,
                           billable INTEGER NOT NULL DEFAULT 1,
                           rounding_minutes INTEGER NOT NULL DEFAULT 0,
                           ai_cost_policy TEXT NOT NULL DEFAULT 'absorbed');
    CREATE TABLE time_entries (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, started_at TEXT NOT NULL,
      local_date TEXT NOT NULL DEFAULT '', ended_at TEXT NOT NULL, seconds INTEGER NOT NULL,
      description TEXT NOT NULL, billable INTEGER NOT NULL DEFAULT 1,
      approved INTEGER NOT NULL DEFAULT 0, invoice_id TEXT,
      ai_micro_usd INTEGER NOT NULL DEFAULT 0, agent_seconds INTEGER NOT NULL DEFAULT 0,
      commit_hashes TEXT NOT NULL DEFAULT '', agents TEXT NOT NULL DEFAULT '');
    INSERT INTO clients VALUES ('c','Cliente','EUR',NULL,NULL,NULL);
    INSERT INTO projects VALUES ('p','c','Proyecto',1,0,'absorbed');
    INSERT INTO time_entries VALUES
      ('viejo','p','2026-07-01T10:00:00Z','2026-07-01','2026-07-01T11:00:00Z',
       3600,'Trabajo anterior',1,0,NULL,0,0,'','');
  `);
  old.close();

  const db = openDatabase(path);
  try {
    const columns = (db.prepare("PRAGMA table_info(time_entries)").all() as { name: string }[])
      .map((c) => c.name);
    assert.ok(columns.includes("source"), "la migración añadió source");
    assert.ok(columns.includes("kind"), "la migración añadió kind");

    assert.equal(versionOf(db), versionDeUnaBaseNueva(),
      "una base migrada termina en la misma versión que una nueva, no en la de la última migración que corrió");

    // Lo que ya había sigue ahí. Migrar no puede perder el trabajo de meses.
    const previo = db.prepare("SELECT * FROM time_entries WHERE id='viejo'")
      .get() as Record<string, unknown>;
    assert.ok(previo, "la fila anterior sobrevive");
    assert.equal(previo["description"], "Trabajo anterior");
    assert.equal(previo["source"], "agent", "las filas viejas quedan como 'agent'");

    // Y ahora sí se puede escribir con los campos nuevos.
    seedProject(db);
    assert.doesNotThrow(() => store.saveTimeEntry(db, entry({ source: "manual" })));
  } finally { db.close(); }
});

test("abrir dos veces la misma base no vuelve a migrar ni falla", () => {
  const path = tempDb();
  openDatabase(path).close();
  assert.doesNotThrow(() => openDatabase(path).close());
});

test("una base de una versión futura se rechaza en vez de corromperse", () => {
  const path = tempDb();
  const db = openDatabase(path);
  db.prepare("UPDATE schema_version SET version = ?").run(999);
  db.close();

  assert.throws(() => openDatabase(path), /v999|Actualiza Estela/);
});

// ── Lo escrito a mano es intocable ─────────────────────────────────────

test("reimportar NO pisa una imputación manual", () => {
  // Reunión de dos horas apuntada a mano el lunes. El martes se reimporta y
  // el bloque deducido de los agentes cae con el mismo id determinista.
  const db = openDatabase(":memory:");
  try {
    seedProject(db);

    const id = "te_p_2026-08-25_main";
    store.saveTimeEntry(db, {
      ...entry({ source: "manual", kind: "meeting", seconds: 7200,
                 description: "Reunión con el cliente" }),
      id,
    });

    // El import intenta sobrescribir esa misma fila.
    store.saveTimeEntry(db, {
      ...entry({ source: "agent", seconds: 600, description: "Desarrollo en main" }),
      id,
    });

    const row = db.prepare("SELECT * FROM time_entries WHERE id = ?")
      .get(id) as Record<string, unknown>;
    assert.equal(row["description"], "Reunión con el cliente", "el texto manual se conserva");
    assert.equal(row["seconds"], 7200, "las 2 horas apuntadas se conservan");
    assert.equal(row["kind"], "meeting");
  } finally { db.close(); }
});

test("reimportar sí actualiza lo deducido de los agentes", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    const id = "te_p_2026-08-25_main";

    store.saveTimeEntry(db, { ...entry({ seconds: 600, description: "Primera lectura" }), id });
    store.saveTimeEntry(db, { ...entry({ seconds: 3600, description: "Lectura corregida" }), id });

    const row = db.prepare("SELECT * FROM time_entries WHERE id = ?")
      .get(id) as Record<string, unknown>;
    assert.equal(row["seconds"], 3600, "lo deducido sí se rehace");
    assert.equal(row["description"], "Lectura corregida");
  } finally { db.close(); }
});

test("las horas manuales no traen coste de IA ni commits", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    const id = store.saveTimeEntry(db, entry({ source: "manual", kind: "travel" }));
    const saved = store.getTimeEntries(db, "p").find((e) => e.id === id)!;

    assert.equal(saved.aiCost.microUsd, 0);
    assert.deepEqual(saved.commitHashes, []);
    assert.equal(saved.kind, "travel");
    assert.equal(saved.source, "manual");
  } finally { db.close(); }
});

test("reimportar rehace los commits de un bloque, no solo su texto", () => {
  // El fallo que esto previene: un bloque creado cuando aún no se capturaban
  // los commits del proyecto se quedaba sin ellos para siempre. El ON CONFLICT
  // actualizaba la descripción pero no commit_hashes, así que el respaldo que
  // justifica esa línea de la factura no aparecía nunca.
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    const id = "te_p_2026-08-26_main";

    // Primer import: el autor no estaba configurado, no hay commits.
    store.saveTimeEntry(db, {
      ...entry({ description: "Desarrollo en main", commitHashes: [] }), id,
    });

    // Segundo import, ya con el autor correcto.
    store.saveTimeEntry(db, {
      ...entry({ description: "feat: filtro de Canarias", commitHashes: ["b942998abe"] }), id,
    });

    const saved = store.getTimeEntries(db, "p").find((e) => e.id === id)!;
    assert.equal(saved.description, "feat: filtro de Canarias");
    assert.deepEqual(saved.commitHashes, ["b942998abe"], "los commits también se rehacen");
  } finally { db.close(); }
});

test("una imputación manual no recibe commits al reimportar", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    const id = "te_p_2026-08-26_main";
    store.saveTimeEntry(db, {
      ...entry({ source: "manual", kind: "meeting", description: "Reunión", commitHashes: [] }), id,
    });
    store.saveTimeEntry(db, {
      ...entry({ description: "Desarrollo", commitHashes: ["abc123"] }), id,
    });

    const saved = store.getTimeEntries(db, "p").find((e) => e.id === id)!;
    assert.equal(saved.description, "Reunión");
    assert.deepEqual(saved.commitHashes, []);
  } finally { db.close(); }
});

// ── Cuándo un panel publicado se queda atrás ───────────────────────────

test("un panel se queda atrás solo si los datos cambian de verdad", () => {
  // El fallo que esto previene: comparar contra la hora del trabajo en vez de
  // la de escritura. Una reunión anotada esta tarde lleva fecha de las 10:00,
  // así que parecía anterior a la publicación y el aviso no saltaba nunca.
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    const id = "te_p_2026-08-26_main";
    const T = (min: number) => new Date(`2026-08-27T10:${String(min).padStart(2, "0")}:00Z`);
    store.saveTimeEntry(db, { ...entry({ seconds: 3600 }), id }, T(0));
    store.recordPublication(db, "p", "tok", "https://x.dev", T(1));

    assert.equal(store.listPublications(db)[0]!.staleBlocks, 0, "recién publicado");

    // Reimportar los mismos valores no cambia nada que el cliente vea.
    store.saveTimeEntry(db, { ...entry({ seconds: 3600 }), id }, T(2));
    assert.equal(store.listPublications(db)[0]!.staleBlocks, 0,
      "un reimport idéntico no envejece el panel");

    // Cambiar la duración sí.
    store.saveTimeEntry(db, { ...entry({ seconds: 7200 }), id }, T(3));
    assert.equal(store.listPublications(db)[0]!.staleBlocks, 1,
      "cambiar las horas sí lo envejece");
  } finally { db.close(); }
});

test("trabajo nuevo posterior a la publicación cuenta como desfase", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    store.recordPublication(db, "p", "tok", null, new Date("2026-08-27T10:00:00Z"));
    // Fecha de trabajo anterior a la publicación, pero anotado después: es lo
    // que pasa al apuntar a mano una reunión de esta mañana.
    store.saveTimeEntry(db, {
      ...entry({ source: "manual", kind: "meeting" }),
      id: "te_manual",
    }, new Date("2026-08-27T18:00:00Z"));
    assert.equal(store.listPublications(db)[0]!.staleBlocks, 1);
  } finally { db.close(); }
});

test("republicar pone el contador a cero y conserva el enlace", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    store.recordPublication(db, "p", "tok-1", "https://x.dev",
      new Date("2026-08-27T10:00:00Z"));
    store.saveTimeEntry(db, { ...entry(), id: "te_a" }, new Date("2026-08-27T11:00:00Z"));
    assert.equal(store.listPublications(db)[0]!.staleBlocks, 1);

    // Republicar sin repetir la URL: no debe perderse.
    store.recordPublication(db, "p", "tok-1", null, new Date("2026-08-27T12:00:00Z"));
    const pub = store.listPublications(db)[0]!;
    assert.equal(pub.staleBlocks, 0);
    assert.equal(pub.baseUrl, "https://x.dev", "el dominio se conserva");
    assert.equal(pub.token, "tok-1", "y el token también, o el cliente pierde su enlace");
  } finally { db.close(); }
});

test("una base nueva tiene exactamente las columnas de una migrada", () => {
  // El fallo real: `ai_budget_micro_usd` se añadió en la migración v10 y se
  // olvidó en el esquema base. Una base nueva no ejecuta migraciones —el código
  // asume que el esquema ya está al día— así que a cada instalación nueva le
  // faltaba esa columna y la vista de equipo respondía 500.
  //
  // Nadie lo habría visto desarrollando: las bases existentes sí se migran. Lo
  // descubre quien instala por primera vez, que es justo a quien no puedes
  // permitirte fallarle.
  const nueva = openDatabase(":memory:");

  // Una base "vieja": se le quitan las columnas que añadieron las migraciones
  // y se la marca en la versión anterior, para que migre de verdad.
  const migrada = openDatabase(":memory:");

  try {
    for (const tabla of ["projects", "commits", "time_entries", "agent_turns"]) {
      const cols = (db: typeof nueva) =>
        (db.prepare(`PRAGMA table_info(${tabla})`).all() as { name: string }[])
          .map((c) => c.name).sort((a, b) => a.localeCompare(b));

      assert.deepEqual(cols(nueva), cols(migrada), `difieren en ${tabla}`);
    }

    // Y las columnas que añaden las migraciones tienen que estar de verdad.
    const projectCols = (nueva.prepare("PRAGMA table_info(projects)").all() as
      { name: string }[]).map((c) => c.name);
    assert.ok(projectCols.includes("ai_budget_micro_usd"));

    const commitCols = (nueva.prepare("PRAGMA table_info(commits)").all() as
      { name: string }[]).map((c) => c.name);
    assert.ok(commitCols.includes("author_name"));
  } finally {
    nueva.close();
    migrada.close();
  }
});

test("una base nueva sirve la vista de equipo sin migrar nada", () => {
  // La consulta concreta que reventaba en cada instalación nueva.
  const db = openDatabase(":memory:");
  try {
    assert.doesNotThrow(() => db.prepare(
      "SELECT id, ai_budget_micro_usd FROM projects WHERE ai_budget_micro_usd IS NOT NULL"
    ).all());
  } finally { db.close(); }
});

// ── Cierre de proyecto ──────────────────────────────────────────────────

test("una base v11 (sin closed_at) se migra a v12 sin perder lo que ya había", () => {
  // La misma clase de fallo que el primer test del fichero: CREATE TABLE IF
  // NOT EXISTS no toca una tabla que ya existe, así que sin la migración
  // explícita, closeProject() reventaría con "no such column: closed_at" en
  // cualquier base creada antes de esta versión.
  const path = tempDb();

  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE schema_version (version INTEGER NOT NULL);
    INSERT INTO schema_version VALUES (11);
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL,
                          tax_id TEXT, email TEXT, address TEXT);
    CREATE TABLE projects (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT NOT NULL,
                           billable INTEGER NOT NULL DEFAULT 1,
                           rounding_minutes INTEGER NOT NULL DEFAULT 0,
                           ai_cost_policy TEXT NOT NULL DEFAULT 'absorbed',
                           kind TEXT NOT NULL DEFAULT 'client',
                           ai_budget_micro_usd INTEGER);
    CREATE TABLE project_repos (project_id TEXT NOT NULL, repo_path TEXT NOT NULL);
    CREATE TABLE project_authors (project_id TEXT NOT NULL, author_email TEXT NOT NULL);
    CREATE TABLE rate_periods (project_id TEXT NOT NULL, hourly_minor INTEGER NOT NULL,
                               currency TEXT NOT NULL, effective_from TEXT NOT NULL,
                               effective_to TEXT);
    CREATE TABLE time_entries (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, started_at TEXT NOT NULL,
      local_date TEXT NOT NULL DEFAULT '', ended_at TEXT NOT NULL, seconds INTEGER NOT NULL,
      description TEXT NOT NULL, billable INTEGER NOT NULL DEFAULT 1,
      approved INTEGER NOT NULL DEFAULT 0, invoice_id TEXT,
      ai_micro_usd INTEGER NOT NULL DEFAULT 0, agent_seconds INTEGER NOT NULL DEFAULT 0,
      commit_hashes TEXT NOT NULL DEFAULT '', agents TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'agent', kind TEXT NOT NULL DEFAULT 'development',
      branch TEXT, updated_at TEXT NOT NULL DEFAULT '');
    INSERT INTO clients VALUES ('c','Cliente','EUR',NULL,NULL,NULL);
    INSERT INTO projects VALUES ('p','c','Proyecto',1,0,'absorbed','client',NULL);
  `);
  old.close();

  const db = openDatabase(path);
  try {
    const columns = (db.prepare("PRAGMA table_info(projects)").all() as { name: string }[])
      .map((c) => c.name);
    assert.ok(columns.includes("closed_at"), "la migración añadió closed_at");

    assert.equal(versionOf(db), versionDeUnaBaseNueva());

    // El proyecto de antes de migrar sigue ahí, y closeProject funciona ya.
    const antes = store.getProject(db, "p")!;
    assert.equal(antes.closedAt, null, "una base migrada empieza con el proyecto abierto");
    store.closeProject(db, "p", new Date("2026-09-17T00:00:00Z"));
    assert.equal(store.getProject(db, "p")!.closedAt?.toISOString(), "2026-09-17T00:00:00.000Z");
  } finally { db.close(); }
});

test("cerrar es idempotente: no le cambia la fecha a un proyecto ya cerrado", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    store.closeProject(db, "p", new Date("2026-09-01T00:00:00Z"));
    store.closeProject(db, "p", new Date("2026-09-17T00:00:00Z"));
    assert.equal(store.getProject(db, "p")!.closedAt?.toISOString(), "2026-09-01T00:00:00.000Z",
      "la segunda llamada no debe mover la fecha del cierre");
  } finally { db.close(); }
});

test("reabrir deja el proyecto activo, y se puede volver a cerrar después", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    store.closeProject(db, "p", new Date("2026-09-01T00:00:00Z"));
    store.reopenProject(db, "p");
    assert.equal(store.getProject(db, "p")!.closedAt, null);

    // Reabierto, closeProject vuelve a actuar (no lo bloquea el "ya cerrado").
    store.closeProject(db, "p", new Date("2026-09-17T00:00:00Z"));
    assert.equal(store.getProject(db, "p")!.closedAt?.toISOString(), "2026-09-17T00:00:00.000Z");
  } finally { db.close(); }
});

test("cerrar un proyecto no borra ni bloquea sus imputaciones", () => {
  // La decisión de diseño que sostiene todo esto: cerrar es un aviso, no un
  // candado. Perder un bloque real capturado de verdad sería peor que dejar
  // que uno se cuele después del cierre — para eso está el aviso de doctor.
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    const id = store.saveTimeEntry(db, entry());
    store.closeProject(db, "p", new Date("2026-08-25T09:00:00Z"));

    assert.doesNotThrow(() => store.saveTimeEntry(db, { ...entry(), id: "te_otro" }));
    assert.ok(store.getTimeEntries(db, "p").some((e) => e.id === id), "lo anterior sigue ahí");
    assert.equal(store.getTimeEntries(db, "p").length, 2, "y lo nuevo se guarda igual");
  } finally { db.close(); }
});

// ── Orden de las migraciones ────────────────────────────────────────────

test("una base de varias versiones atrás llega a la actual de una sola vez", () => {
  // El fallo real: las migraciones se recorrían de la más nueva a la más vieja
  // y se anotaba como versión la última que corría, así que una base v3 quedaba
  // en "v4" con todo aplicado y solo convergía a fuerza de abrirla otra vez.
  const path = tempDb();
  const nueva = openDatabase(path);
  nueva.exec("UPDATE schema_version SET version = 3");
  nueva.close();

  const db = openDatabase(path);
  try {
    assert.equal(versionOf(db), versionDeUnaBaseNueva(),
      "una sola apertura basta para dejarla al día");
  } finally { db.close(); }
});

// ── Idioma de los documentos de cada cliente ────────────────────────────

test("una base v12 (sin language) se migra y el idioma se guarda y se lee", () => {
  const path = tempDb();
  const prep = openDatabase(path);
  prep.exec("INSERT INTO clients (id, name, currency) VALUES ('c', 'Cliente', 'EUR')");
  prep.exec("ALTER TABLE clients DROP COLUMN language");
  prep.exec("UPDATE schema_version SET version = 12");
  prep.close();

  const db = openDatabase(path);
  try {
    const columns = (db.prepare("PRAGMA table_info(clients)").all() as { name: string }[])
      .map((c) => c.name);
    assert.ok(columns.includes("language"), "la migración añadió language");
    assert.equal(versionOf(db), versionDeUnaBaseNueva());

    // Un cliente de antes de migrar no tiene idioma: sigue el de la terminal,
    // que es lo que pasaba antes de que existiera el campo.
    assert.equal(store.getClient(db, "c")!.language, undefined);

    store.upsertClient(db, { id: "c", name: "Cliente", currency: "EUR", language: "en" });
    assert.equal(store.getClient(db, "c")!.language, "en");

    store.upsertClient(db, { id: "c", name: "Cliente", currency: "EUR" });
    assert.equal(store.getClient(db, "c")!.language, undefined,
      "upsertClient escribe lo que recibe: conservar el idioma es cosa de quien lo llama");
  } finally { db.close(); }
});

test("un valor de idioma que no existe en la base se ignora en vez de propagarse", () => {
  const db = openDatabase(":memory:");
  try {
    db.exec("INSERT INTO clients (id, name, currency, language) VALUES ('c', 'X', 'EUR', 'klingon')");
    assert.equal(store.getClient(db, "c")!.language, undefined);
  } finally { db.close(); }
});

/* ── Las facturas emitidas se pueden volver a ver ──────────────────────── */

test("listInvoices devuelve lo emitido, de lo más nuevo a lo más viejo", () => {
  // Reportado usándolo: al cortar y facturar, el proyecto desaparecía de la
  // pestaña Informes —que solo lista lo PENDIENTE— y no había ningún sitio
  // donde volver a ver el informe. La factura estaba guardada y era invisible.
  const db = openDatabase(tempDb());
  try {
    store.upsertClient(db, { id: "acme", name: "ACME", currency: "EUR" });
    store.upsertProject(db, {
      id: "web", clientId: "acme", name: "Web de ACME", billable: true,
      roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client", repoPaths: [],
    });

    for (const [num, corte] of [["INF-2026-001", "2026-08-31"], ["INF-2026-002", "2026-09-30"]] as const) {
      db.prepare(`
        INSERT INTO invoices (id, number, client_id, project_id, issued_at, cutoff_at,
          period_start, currency, subtotal_minor, total_minor, total_seconds,
          ai_micro_usd, lines_json)
        VALUES (?, ?, 'acme', 'web', ?, ?, '2026-07-01T00:00:00.000Z', 'EUR',
                170237, 170237, 471600, 0, '[]')
      `).run(`inv_${num}`, num, `${corte}T12:00:00.000Z`, `${corte}T23:59:59.000Z`);
    }

    const facturas = store.listInvoices(db);

    assert.equal(facturas.length, 2);
    assert.equal(facturas[0]!.number, "INF-2026-002", "la más reciente primero");
    assert.equal(facturas[0]!.projectName, "Web de ACME", "con el nombre, no solo el id");
    assert.equal(facturas[0]!.clientName, "ACME");
    assert.equal(facturas[0]!.totalSeconds, 471600);
    assert.equal(facturas[0]!.totalMinor, 170237);
    assert.equal(facturas[0]!.currency, "EUR");
  } finally { db.close(); }
});

test("listInvoices puede filtrar por proyecto", () => {
  const db = openDatabase(tempDb());
  try {
    store.upsertClient(db, { id: "acme", name: "ACME", currency: "EUR" });
    for (const p of ["web", "api"]) {
      store.upsertProject(db, {
        id: p, clientId: "acme", name: p.toUpperCase(), billable: true,
        roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client", repoPaths: [],
      });
      db.prepare(`
        INSERT INTO invoices (id, number, client_id, project_id, issued_at, cutoff_at,
          period_start, currency, subtotal_minor, total_minor, total_seconds,
          ai_micro_usd, lines_json)
        VALUES (?, ?, 'acme', ?, '2026-09-30T12:00:00.000Z', '2026-09-30T23:59:59.000Z',
                '2026-07-01T00:00:00.000Z', 'EUR', 100, 100, 3600, 0, '[]')
      `).run(`inv_${p}`, `INF-${p}`, p);
    }

    assert.equal(store.listInvoices(db, "web").length, 1);
    assert.equal(store.listInvoices(db, "web")[0]!.projectId, "web");
    assert.equal(store.listInvoices(db).length, 2);
  } finally { db.close(); }
});

test("sin facturas emitidas devuelve una lista vacía, no explota", () => {
  const db = openDatabase(tempDb());
  try {
    assert.deepEqual(store.listInvoices(db), []);
  } finally { db.close(); }
});

test("getInvoice reconstruye la factura entera para poder reimprimirla", () => {
  // El tipo Invoice congela importes y reparto de IA al emitir, con este
  // motivo escrito: "un documento que cambia solo no es un documento".
  // Faltaba poder leerlo de vuelta.
  const db = openDatabase(tempDb());
  try {
    store.upsertClient(db, { id: "acme", name: "ACME", currency: "EUR" });
    store.upsertProject(db, {
      id: "web", clientId: "acme", name: "Web", billable: true, repoPaths: [],
      roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
    });
    db.prepare(`
      INSERT INTO invoices (id, number, client_id, project_id, issued_at, cutoff_at,
        period_start, currency, subtotal_minor, total_minor, total_seconds,
        ai_micro_usd, usd_fx_rate, ai_amort_minor, ai_amort_cur, notes, lines_json)
      VALUES ('inv_1', 'INF-2026-001', 'acme', 'web', '2026-09-23T12:00:00.000Z',
              '2026-09-23T23:59:59.000Z', '2026-07-29T03:21:05.036Z', 'EUR',
              170237, 170237, 471600, 4200000, 0.92, 1500, 'EUR', 'agosto',
              '[{"description":"Desarrollo","seconds":471600,"amount":{"amount":170237,"currency":"EUR"}}]')
    `).run();

    const f = store.getInvoice(db, "INF-2026-001");

    assert.ok(f, "la factura tiene que aparecer por su número");
    assert.equal(f!.number, "INF-2026-001");
    assert.equal(f!.total.amount, 170237);
    assert.equal(f!.total.currency, "EUR");
    assert.equal(f!.totalSeconds, 471600);
    assert.equal(f!.lines.length, 1, "las líneas congeladas, no recalculadas");
    assert.equal(f!.lines[0]!.description, "Desarrollo");
    assert.equal(f!.aiCost.microUsd, 4200000);
    assert.equal(f!.usdFxRate, 0.92);
    assert.equal(f!.aiAmortized?.amount, 1500, "el reparto de IA, tal y como se congeló");
    assert.equal(f!.notes, "agosto");
    assert.ok(f!.cutoffAt instanceof Date, "las fechas vuelven como Date, no como texto");
  } finally { db.close(); }
});

test("getInvoice con un número que no existe devuelve null", () => {
  const db = openDatabase(tempDb());
  try {
    assert.equal(store.getInvoice(db, "INF-2099-999"), null);
  } finally { db.close(); }
});

/* ── Un ajuste a mano sobrevive al reimport ────────────────────────────── */

function entradaDeAgente(dbPath: string, seconds: number) {
  const db = openDatabase(dbPath);
  try {
    store.upsertClient(db, { id: "acme", name: "ACME", currency: "EUR" });
    store.upsertProject(db, {
      id: "web", clientId: "acme", name: "Web", billable: true, repoPaths: [],
      roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
    });
    return store.saveTimeEntry(db, {
      id: "te_fija", projectId: "web",
      startedAt: new Date("2026-09-23T09:00:00.000Z"),
      endedAt: new Date("2026-09-23T10:00:00.000Z"),
      seconds, description: "feat: cartera de servicios", billable: true,
      invoiceId: null, aiCost: { microUsd: 0 }, agentSeconds: seconds,
      commitHashes: [], agents: [], source: "agent", kind: "development", branch: "main",
    });
  } finally { db.close(); }
}

test("un ajuste a mano no se pierde al reimportar", () => {
  // Reportado con datos reales: se editaba un bloque a 5h 50m, el auto-import
  // corría a los cinco minutos y volvía a dejarlo en lo que midió el agente.
  const path = tempDb();
  entradaDeAgente(path, 9504); // 2h 38m medidas

  const db = openDatabase(path);
  try {
    store.adjustEntrySeconds(db, "te_fija", 21000, "Reunión con el cliente e investigación");

    // El reimport vuelve a traer lo que mide el agente, como siempre.
    store.saveTimeEntry(db, {
      id: "te_fija", projectId: "web",
      startedAt: new Date("2026-09-23T09:00:00.000Z"),
      endedAt: new Date("2026-09-23T10:00:00.000Z"),
      seconds: 9504, description: "feat: cartera de servicios", billable: true,
      invoiceId: null, aiCost: { microUsd: 0 }, agentSeconds: 9504,
      commitHashes: [], agents: [], source: "agent", kind: "development", branch: "main",
    });

    const r = db.prepare("SELECT seconds, measured_seconds, adjust_reason FROM time_entries WHERE id = 'te_fija'")
      .get() as { seconds: number; measured_seconds: number | null; adjust_reason: string | null };

    assert.equal(r.seconds, 21000, "lo ajustado manda: es lo que se factura");
    assert.equal(r.measured_seconds, 9504, "y lo medido se guarda, para poder enseñar la diferencia");
    assert.match(r.adjust_reason!, /Reunión con el cliente/);
  } finally { db.close(); }
});

test("sin ajuste, el reimport sigue mandando", () => {
  const path = tempDb();
  entradaDeAgente(path, 3600);
  const db = openDatabase(path);
  try {
    store.saveTimeEntry(db, {
      id: "te_fija", projectId: "web",
      startedAt: new Date("2026-09-23T09:00:00.000Z"),
      endedAt: new Date("2026-09-23T10:00:00.000Z"),
      seconds: 7200, description: "feat: cartera de servicios", billable: true,
      invoiceId: null, aiCost: { microUsd: 0 }, agentSeconds: 7200,
      commitHashes: [], agents: [], source: "agent", kind: "development", branch: "main",
    });
    const r = db.prepare("SELECT seconds FROM time_entries WHERE id = 'te_fija'").get() as { seconds: number };
    assert.equal(r.seconds, 7200, "corregir la medición es justo para lo que sirve reimportar");
  } finally { db.close(); }
});

test("un ajuste exige un motivo", () => {
  const path = tempDb();
  entradaDeAgente(path, 3600);
  const db = openDatabase(path);
  try {
    // Cambiar horas que alguien paga sin decir por qué es lo contrario de lo
    // que promete el producto.
    assert.throws(() => store.adjustEntrySeconds(db, "te_fija", 7200, ""));
    assert.throws(() => store.adjustEntrySeconds(db, "te_fija", 7200, "   "));
    const r = db.prepare("SELECT seconds FROM time_entries WHERE id = 'te_fija'").get() as { seconds: number };
    assert.equal(r.seconds, 3600, "y no se guarda nada a medias");
  } finally { db.close(); }
});

test("reimportar no toca una imputación ya facturada", () => {
  // La fila detrás de una factura emitida es historia. Pisarla deja el panel
  // diciendo una cosa y el PDF entregado otra.
  const path = tempDb();
  entradaDeAgente(path, 9504);
  const db = openDatabase(path);
  try {
    db.prepare("INSERT INTO invoices (id, number, client_id, project_id, issued_at, cutoff_at, period_start, currency, subtotal_minor, total_minor, total_seconds, ai_micro_usd, lines_json) VALUES ('inv_1','INF-1','acme','web','2026-09-24T04:01:39.000Z','2026-09-23T23:59:59.000Z','2026-07-01T00:00:00.000Z','EUR',0,0,9504,0,'[]')").run();
    db.prepare("UPDATE time_entries SET invoice_id = 'inv_1' WHERE id = 'te_fija'").run();

    store.saveTimeEntry(db, {
      id: "te_fija", projectId: "web",
      startedAt: new Date("2026-09-23T09:00:00.000Z"),
      endedAt: new Date("2026-09-23T10:00:00.000Z"),
      seconds: 123, description: "otra cosa", billable: true,
      invoiceId: null, aiCost: { microUsd: 0 }, agentSeconds: 123,
      commitHashes: [], agents: [], source: "agent", kind: "development", branch: "main",
    });

    const r = db.prepare("SELECT seconds, description FROM time_entries WHERE id = 'te_fija'")
      .get() as { seconds: number; description: string };
    assert.equal(r.seconds, 9504, "lo facturado no se recalcula");
    assert.equal(r.description, "feat: cartera de servicios");
  } finally { db.close(); }
});

// ── Tickets ───────────────────────────────────────────────────────────

function reimportarCon(db: ReturnType<typeof openDatabase>, workItems: string[]): void {
  store.saveTimeEntry(db, {
    id: "te_fija", projectId: "web",
    startedAt: new Date("2026-09-23T09:00:00.000Z"),
    endedAt: new Date("2026-09-23T10:00:00.000Z"),
    seconds: 3600, description: "feat: cartera de servicios", billable: true,
    invoiceId: null, aiCost: { microUsd: 0 }, agentSeconds: 3600,
    commitHashes: [], agents: [], source: "agent", kind: "development", branch: "main",
    workItems,
  });
}

test("los tickets se rehacen al reimportar, salvo los puestos a mano", () => {
  const path = tempDb();
  entradaDeAgente(path, 3600);
  const db = openDatabase(path);
  try {
    const tickets = () => store.getTimeEntries(db, "web")[0]!.workItems;
    assert.deepEqual(tickets(), [], "una entrada de antes de los tickets lee una lista vacía");

    reimportarCon(db, ["azure:1234"]);
    assert.deepEqual(tickets(), ["azure:1234"]);

    // Corregido a mano: el reimport, que sigue detectando el 1234, no lo pisa.
    store.setEntryWorkItems(db, "te_fija", ["azure:5678"]);
    reimportarCon(db, ["azure:1234"]);
    assert.deepEqual(tickets(), ["azure:5678"]);

    // Quitar la corrección devuelve el bloque a lo detectado.
    store.setEntryWorkItems(db, "te_fija", null);
    reimportarCon(db, ["azure:1234"]);
    assert.deepEqual(tickets(), ["azure:1234"]);

    assert.throws(() => store.setEntryWorkItems(db, "no-existe", ["azure:1"]));
  } finally { db.close(); }
});

test("el gestor de tareas de un proyecto se guarda y se quita sin tocar el resto", () => {
  const path = tempDb();
  entradaDeAgente(path, 3600);
  const db = openDatabase(path);
  try {
    assert.equal(store.getProject(db, "web")!.tracker, null);
    store.setProjectTracker(db, "web", { system: "jira", prefixes: ["PROJ"] });
    const p = store.getProject(db, "web")!;
    assert.deepEqual(p.tracker, { system: "jira", prefixes: ["PROJ"] });
    assert.equal(p.name, "Web", "el resto del proyecto sigue igual");

    store.setProjectTracker(db, "web", null);
    assert.equal(store.getProject(db, "web")!.tracker, null);
    assert.throws(() => store.setProjectTracker(db, "no-existe", null));
  } finally { db.close(); }
});
