import assert from "node:assert/strict";
import { test } from "node:test";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { seedDemo } from "./demo.js";

/**
 * `estela demo`.
 *
 * Lo que tiene que ser cierto: que enseñe algo parecido a una instalación real
 * usada unas semanas, que no invente futuro, y —lo importante— que no toque ni
 * lea nada de quien la está mirando.
 */

const HOY = new Date("2026-09-15T18:00:00");

function demo(now = HOY) {
  const db = openDatabase(":memory:");
  seedDemo(db, { now });
  return db;
}

test("demo: sale una instalación con varios proyectos y semanas de trabajo", () => {
  const db = demo();
  try {
    const proyectos = store.listProjects(db);
    assert.equal(proyectos.length, 3);
    assert.ok(proyectos.some((p) => p.kind === "client"), "alguno de cliente, o no hay importes");
    assert.ok(proyectos.some((p) => p.kind === "internal"), "y alguno interno");

    const entradas = proyectos.flatMap((p) => store.getTimeEntries(db, p.id));
    assert.ok(entradas.length > 30, `pocos bloques: ${entradas.length}`);
    const horas = entradas.reduce((s, e) => s + e.seconds, 0) / 3600;
    assert.ok(horas > 40 && horas < 400, `horas poco creíbles: ${horas}`);

    // Con agente y sin agente: la demo tiene que poder enseñar las dos cosas.
    assert.ok(entradas.some((e) => e.source === "agent"));
    assert.ok(entradas.some((e) => e.source === "manual"), "faltan las horas anotadas a mano");
    assert.ok(entradas.some((e) => e.aiCost.microUsd > 0), "sin coste de IA no se ve la mitad del producto");
  } finally { db.close(); }
});

test("demo: no inventa trabajo en el futuro", () => {
  // Una demo con bloques de mañana se nota al instante y tira por tierra el
  // resto de las cifras.
  const db = demo();
  try {
    const futuro = store.listProjects(db)
      .flatMap((p) => store.getTimeEntries(db, p.id))
      .filter((e) => e.endedAt > HOY);
    assert.deepEqual(futuro.map((e) => e.id), []);
  } finally { db.close(); }
});

test("demo: lo antiguo aparece revisado y lo reciente no", () => {
  // Recién importado, TODO sale pendiente y el panel se llena de avisos. Una
  // instalación con semanas de uso no está así.
  const db = demo();
  try {
    const filas = db.prepare(
      "SELECT approved, COUNT(*) AS n FROM time_entries GROUP BY approved"
    ).all() as { approved: number; n: number }[];
    const revisados = filas.find((f) => f.approved === 1)?.n ?? 0;
    const pendientes = filas.find((f) => f.approved === 0)?.n ?? 0;
    assert.ok(revisados > pendientes, `revisados ${revisados}, pendientes ${pendientes}`);
    assert.ok(pendientes > 0, "algo pendiente tiene que quedar, o no se ve para qué sirve revisar");
  } finally { db.close(); }
});

test("demo: hay compañeros que no usan Estela, para la vista de equipo", () => {
  const db = demo();
  try {
    const autores = db.prepare("SELECT DISTINCT author_email FROM commits").all() as { author_email: string }[];
    assert.ok(autores.length >= 4, `solo ${autores.length} personas commitean`);
    // Sus commits están, pero sus horas no se imputan a nadie: se estiman.
    const mios = db.prepare(
      "SELECT COUNT(*) AS n FROM commits WHERE author_email = 'sam@riveradev.io'"
    ).get() as { n: number };
    assert.ok(mios.n > 0 && mios.n < autores.length * 1000);
  } finally { db.close(); }
});

test("demo: dos ejecuciones dan exactamente lo mismo", () => {
  // Para que una captura de hoy y otra de dentro de un mes se puedan comparar,
  // y para que los tests no dependan del azar.
  const a = demo(), b = demo();
  try {
    const filas = (db: ReturnType<typeof openDatabase>) =>
      db.prepare("SELECT id, seconds, description FROM time_entries ORDER BY id").all();
    assert.deepEqual(filas(a), filas(b));
  } finally { a.close(); b.close(); }
});

test("demo: solo escribe en la base que se le da", () => {
  // La garantía que se le promete a quien ejecuta `estela demo`: su historial
  // no se lee y su base no se toca. Aquí se comprueba lo segundo.
  const real = openDatabase(":memory:");
  store.upsertClient(real, { id: "mio", name: "Cliente real", currency: "EUR" });
  const demoDb = openDatabase(":memory:");
  try {
    seedDemo(demoDb, { now: HOY });
    assert.deepEqual(store.listClients(real).map((c) => c.id), ["mio"]);
    assert.equal(store.listProjects(real).length, 0);
  } finally { real.close(); demoDb.close(); }
});
