import assert from "node:assert/strict";
import { test } from "node:test";

import type { TimeEntry } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { diagnose } from "./doctor.js";

/**
 * Las demás comprobaciones de diagnose() no tienen test todavía — esta
 * cubre solo la que se añadió junto con el cierre de proyectos. El resto
 * queda para otra tanda, no forma parte de este cambio.
 */

function seedProject(db: ReturnType<typeof openDatabase>): void {
  store.upsertClient(db, { id: "c", name: "Cliente", currency: "EUR" });
  store.upsertProject(db, {
    id: "p", clientId: "c", name: "Proyecto", repoPaths: ["/repo"],
    billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
  });
  store.addRatePeriod(db, {
    projectId: "p", hourlyRate: { amount: 5000, currency: "EUR" },
    effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null,
  });
  store.setProjectAuthors(db, "p", ["yo@ejemplo.com"]);
}

function entry(over: Partial<TimeEntry> = {}): Omit<TimeEntry, "id"> {
  const startedAt = new Date("2026-09-01T10:00:00Z");
  return {
    projectId: "p", startedAt,
    endedAt: new Date(startedAt.getTime() + 3600_000),
    seconds: 3600, description: "Bloque", billable: true, invoiceId: null,
    aiCost: { microUsd: 0 }, agentSeconds: 3600, commitHashes: [], agents: ["claude-code"],
    source: "agent", kind: "development", branch: "main",
    ...over,
  };
}

function findingSobre(db: ReturnType<typeof openDatabase>, textoDelTitulo: string) {
  return diagnose(db).find((f) => f.title.includes(textoDelTitulo));
}

test("un proyecto cerrado sin actividad posterior no genera ningún aviso", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    store.saveTimeEntry(db, entry());
    store.closeProject(db, "p", new Date("2026-09-02T00:00:00Z"));

    assert.equal(findingSobre(db, "volvió a captar trabajo"), undefined);
  } finally { db.close(); }
});

test("un proyecto cerrado que vuelve a captar trabajo sí avisa", () => {
  // El caso real que motiva esto: alguien cierra el proyecto, factura todo, y
  // luego un compañero (o el mismo, sin acordarse) vuelve a commitear ahí. Sin
  // este aviso, esas horas quedan capturadas pero nadie sabe que existen.
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    store.closeProject(db, "p", new Date("2026-09-02T00:00:00Z"));
    store.saveTimeEntry(db, {
      ...entry({ startedAt: new Date("2026-09-10T10:00:00Z"),
                 endedAt: new Date("2026-09-10T11:30:00Z"), seconds: 5400 }),
      id: "te_posterior",
    });

    const f = findingSobre(db, "volvió a captar trabajo");
    assert.ok(f, "debe aparecer el aviso");
    assert.equal(f!.severity, "warning");
    assert.match(f!.title, /"Proyecto"/);
    assert.match(f!.detail, /1 bloque nuevo/);
    assert.match(f!.detail, /2026-09-02/, "la fecha del cierre tiene que verse");
    assert.match(f!.fix, /estela project reopen --project p/);
  } finally { db.close(); }
});

test("varios bloques posteriores al cierre se cuentan y suman, no solo el último", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    store.closeProject(db, "p", new Date("2026-09-02T00:00:00Z"));
    store.saveTimeEntry(db, {
      ...entry({ startedAt: new Date("2026-09-10T10:00:00Z"), seconds: 3600 }), id: "a",
    });
    store.saveTimeEntry(db, {
      ...entry({ startedAt: new Date("2026-09-11T10:00:00Z"), seconds: 1800 }), id: "b",
    });

    const f = findingSobre(db, "volvió a captar trabajo")!;
    assert.match(f.detail, /2 bloques nuevos/, "cuenta los dos, no en singular");
    assert.match(f.detail, /1h 30m/, "3600 + 1800 segundos");
  } finally { db.close(); }
});

test("cerrar al final del día no avisa por horas del mismo día anotadas después", () => {
  // El fallo real: "estela log" fecha las horas manuales de hoy a las 10:00
  // hora local sin importar cuándo se anoten de verdad (a propósito, para no
  // fingir precisión). Si el cierre usara el instante exacto del reloj en vez
  // del final del día, cerrar por la tarde y anotar "las 10 de hoy" DESPUÉS
  // avisaría de un problema que no existe. "estela project close" cierra al
  // final del día local exactamente para evitar esto (ver cli.ts).
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    store.saveTimeEntry(db, {
      ...entry({ startedAt: new Date("2026-09-17T15:00:00Z") }), id: "manana",
    });
    // Cierre "al final del día", como hace la CLI — no el instante exacto.
    store.closeProject(db, "p", new Date("2026-09-17T23:59:59"));
    // Más horas del MISMO día, anotadas después del cierre.
    store.saveTimeEntry(db, {
      ...entry({ startedAt: new Date("2026-09-17T15:00:00Z"), seconds: 1800 }), id: "tarde",
    });

    assert.equal(findingSobre(db, "volvió a captar trabajo"), undefined,
      "trabajo del mismo día del cierre no es un aviso, aunque se anote después");
  } finally { db.close(); }
});

test("un proyecto abierto normal no dispara este aviso aunque nunca se haya cerrado", () => {
  const db = openDatabase(":memory:");
  try {
    seedProject(db);
    store.saveTimeEntry(db, entry());
    assert.equal(findingSobre(db, "volvió a captar trabajo"), undefined);
  } finally { db.close(); }
});
