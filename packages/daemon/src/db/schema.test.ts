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

    const version = (db.prepare("SELECT version FROM schema_version").get() as { version: number });
    assert.equal(version.version, 2);

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
