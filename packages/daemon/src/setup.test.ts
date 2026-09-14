import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { applySetup, projectFromRepo, summaryLine, type SetupPlan } from "./setup.js";

function fresh() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), "estela-setup-")), "t.db"));
}

function plan(over: Partial<SetupPlan> = {}): SetupPlan {
  return {
    repoPath: "/dev/acme/api", projectId: "api", name: "api",
    emails: ["yo@acme.com"], existing: false, ...over,
  };
}

test("el nombre del proyecto sale de la carpeta, no de la ruta", () => {
  // Un desplegable con rutas absolutas no lo lee nadie.
  assert.deepEqual(projectFromRepo("/Users/x/dev/acme/api"), { id: "api", name: "api" });
  assert.deepEqual(projectFromRepo("/x/Portal_Ventas"),
    { id: "portal-ventas", name: "Portal_Ventas" });
  assert.equal(projectFromRepo("/").id, "proyecto");
});

test("crea los proyectos sin tarifa y como internos", () => {
  // Marcarlos como cliente facturable haría que `doctor` reclamara una tarifa
  // que nadie pactó, y pondría importes inventados en la primera pantalla.
  const db = fresh();
  try {
    assert.equal(applySetup(db, [plan()]), 1);
    const p = store.getProject(db, "api")!;
    assert.equal(p.kind, "internal");
    assert.equal(p.billable, false);
    assert.equal(store.getRates(db, "api").length, 0);
    assert.deepEqual(store.getProjectAuthors(db, "api"), ["yo@acme.com"]);
  } finally { db.close(); }
});

test("volver a ejecutarlo no deshace lo que configuraste a mano", () => {
  // Es la garantía sin la cual nadie se atreve a ejecutar `setup` dos veces.
  const db = fresh();
  try {
    applySetup(db, [plan()]);
    store.addRatePeriod(db, {
      projectId: "api", hourlyRate: { amount: 5000, currency: "EUR" },
      effectiveFrom: new Date(0), effectiveTo: null,
    });

    // El mismo repositorio, ya asignado: llega marcado como existente.
    assert.equal(applySetup(db, [plan({ existing: true })]), 0);
    assert.equal(store.getRates(db, "api").length, 1, "se perdió la tarifa");
  } finally { db.close(); }
});

test("dos repositorios con el mismo nombre no se pisan", () => {
  // `~/trabajo/api` y `~/personal/api` son proyectos distintos.
  const db = fresh();
  try {
    applySetup(db, [plan()]);
    applySetup(db, [plan({ repoPath: "/otro/api", projectId: "api-2" })]);

    assert.equal(store.projectForRepo(db, "/dev/acme/api"), "api");
    assert.equal(store.projectForRepo(db, "/otro/api"), "api-2");
  } finally { db.close(); }
});

test("un repositorio sin autor claro se crea igual, pero sin autores", () => {
  // Perder el proyecto sería peor: el trabajo quedaría sin imputar y sin
  // rastro. Sin autores no captura commits, y `doctor` lo dice.
  const db = fresh();
  try {
    applySetup(db, [plan({ emails: [] })]);
    assert.ok(store.getProject(db, "api"));
    assert.deepEqual(store.getProjectAuthors(db, "api"), []);
  } finally { db.close(); }
});

test("el resumen habla de horas, no de filas insertadas", () => {
  // Es lo único que esa persona va a leer, y tiene que responder a "¿esto sabe
  // algo de verdad sobre mi trabajo?".
  assert.match(
    summaryLine({ seconds: 900_651, days: 92, projects: 17, people: 100, from: "", to: "" }),
    /250h 11m reconstruidas · 92 días · 17 proyectos/);

  // Sin nada que enseñar hay que decirlo, no imprimir "0h".
  assert.match(summaryLine({ seconds: 0, days: 0, projects: 0, people: 0, from: "", to: "" }),
    /No se ha podido reconstruir/);
});

test("singulares y plurales", () => {
  assert.match(summaryLine({ seconds: 3600, days: 1, projects: 1, people: 1, from: "", to: "" }),
    /1 día · 1 proyecto$/);
});

test("allProjectRepoPaths: el repo que setup acaba de registrar aparece, aunque no venga de ningún transcript", () => {
  // El fallo real que esto cierra: `cmdImport` derivaba sus repos SOLO de los
  // transcripts de Claude Code, así que un proyecto sin ninguna sesión de
  // agente detrás — quien programa con Cursor, o sin IA — quedaba registrado
  // por `setup` pero con cero commits importados: `allProjectRepoPaths` es lo
  // que `cmdImport` tiene que consultar además de los transcripts.
  const db = fresh();
  assert.deepEqual(store.allProjectRepoPaths(db), []);

  applySetup(db, [plan({ repoPath: "/dev/acme/api", projectId: "api" })]);
  assert.deepEqual(store.allProjectRepoPaths(db), ["/dev/acme/api"]);

  applySetup(db, [plan({ repoPath: "/dev/otro/web", projectId: "web" })]);
  assert.deepEqual(
    store.allProjectRepoPaths(db).sort(),
    ["/dev/acme/api", "/dev/otro/web"]);
});
