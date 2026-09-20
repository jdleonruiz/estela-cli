import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";

/**
 * El idioma de los documentos, ejecutando la CLI de verdad.
 *
 * Lo que se prueba aquí es lo que ve una persona: qué idioma sale en el fichero
 * que le manda a su cliente, cuándo se le avisa de dónde fijarlo, y que volver a
 * ejecutar `client add` para cambiar un correo no le cambie los PDFs de idioma
 * sin decirle nada. Ver `documentLang` en i18n/index.ts.
 */

const BIN = join(__dirname, "bin.js");

interface Salida { readonly code: number | null; readonly out: string }

function estela(db: string, lang: "es" | "en", ...args: string[]): Salida {
  const r = spawnSync(process.execPath, [BIN, ...args, "--db", db], {
    encoding: "utf8",
    env: { ...process.env, ESTELA_LANG: lang, NO_COLOR: "1" },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

/** Una base con un cliente, un proyecto con tarifa y un bloque facturable. */
function preparar(language?: "es" | "en"): { db: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "estela-idioma-"));
  const path = join(dir, "estela.db");
  const db = openDatabase(path);
  try {
    store.upsertClient(db, {
      id: "acme", name: "ACME", currency: "EUR", taxId: "B-1", email: "ap@acme.test",
      ...(language ? { language } : {}),
    });
    store.upsertProject(db, {
      id: "p", clientId: "acme", name: "Web", repoPaths: [],
      billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
    });
    store.addRatePeriod(db, {
      projectId: "p", hourlyRate: { amount: 5000, currency: "EUR" },
      effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null,
    });
    const startedAt = new Date("2026-08-10T10:00:00Z");
    store.saveTimeEntry(db, {
      id: "e1", projectId: "p", startedAt,
      endedAt: new Date(startedAt.getTime() + 3600_000), seconds: 3600,
      description: "Trabajo", billable: true, invoiceId: null,
      aiCost: { microUsd: 0 }, agentSeconds: 3600, commitHashes: [], agents: [],
      source: "agent", kind: "development", branch: "main",
    });
  } finally { db.close(); }
  return { db: path, dir };
}

const htmlLang = (file: string) => /<html lang="(\w+)"/.exec(readFileSync(file, "utf8"))![1];

// ── share: el documento sale en el idioma del cliente ───────────────────

test("sin idioma fijado, el informe sale en el de la terminal y avisa dónde fijarlo", () => {
  const { db, dir } = preparar();
  const out = join(dir, "r.html");

  const es = estela(db, "es", "share", "--project", "p", "--out", out);
  assert.equal(es.code, 0, es.out);
  assert.equal(htmlLang(out), "es");
  assert.match(es.out, /Sale en español, el idioma de tu terminal/);
  // El comando viene ya escrito, con los datos del cliente: `client add` reescribe
  // la ficha entera y teclearlo de memoria es perder el NIF sin querer.
  assert.match(es.out,
    /estela client add --id acme --name "ACME" --currency EUR --tax-id "B-1" --email "ap@acme.test" --language <es\|en>/);

  const en = estela(db, "en", "share", "--project", "p", "--out", out);
  assert.equal(htmlLang(out), "en");
  assert.match(en.out, /It comes out in English, your terminal's language/);
});

test("el idioma del cliente manda sobre el de la terminal, y no hay aviso", () => {
  // Es el caso para el que existe todo esto: terminal en inglés, cliente en español.
  const { db, dir } = preparar("es");
  const out = join(dir, "r.html");

  const r = estela(db, "en", "share", "--project", "p", "--out", out);
  assert.equal(r.code, 0, r.out);
  assert.equal(htmlLang(out), "es", "el documento sale en el idioma del cliente");
  assert.doesNotMatch(r.out, /It comes out in|To set it/, "ya está decidido: no se avisa");
  assert.match(r.out, /Report:/, "lo que imprime la terminal sigue en el idioma de la terminal");
});

test("--lang en el comando manda sobre todo", () => {
  const { db, dir } = preparar("es");
  const out = join(dir, "r.html");
  const r = estela(db, "es", "share", "--project", "p", "--out", out, "--lang", "en");
  assert.equal(r.code, 0, r.out);
  assert.equal(htmlLang(out), "en");
  assert.doesNotMatch(r.out, /To set it|Para fijarlo/);
});

// ── export y report ─────────────────────────────────────────────────────

test("el CSV sale en el idioma del cliente; por la salida estándar no lleva ningún aviso dentro", () => {
  const { db, dir } = preparar("en");

  const aFichero = estela(db, "es", "export", "--project", "p", "--out", join(dir, "h.csv"));
  assert.equal(aFichero.code, 0, aFichero.out);
  assert.ok(readFileSync(join(dir, "h.csv"), "utf8").includes("date,start,end,hours"));

  // Sin idioma fijado y por stdout: el aviso se colaría dentro del CSV.
  const sin = preparar();
  const porStdout = estela(sin.db, "es", "export", "--project", "p");
  assert.equal(porStdout.code, 0, porStdout.out);
  assert.doesNotMatch(porStdout.out, /Para fijarlo|Sale en/);
  assert.ok(porStdout.out.replace("﻿", "").startsWith("fecha,inicio"));
});

test("el PDF del informe de horas sale en el idioma del cliente", () => {
  const en = preparar("en");
  const pdf = join(en.dir, "f.pdf");
  const r = estela(en.db, "es", "report", "--project", "p", "--cutoff", "2026-08-31",
    "--dry-run", "--pdf", pdf);
  assert.equal(r.code, 0, r.out);
  const texto = readFileSync(pdf).toString("latin1");
  assert.ok(texto.includes("(HOURS REPORT)"));
  assert.ok(!texto.includes("INFORME DE HORAS"));

  const es = preparar("es");
  const pdfEs = join(es.dir, "f.pdf");
  estela(es.db, "en", "report", "--project", "p", "--cutoff", "2026-08-31", "--dry-run", "--pdf", pdfEs);
  assert.ok(readFileSync(pdfEs).toString("latin1").includes("(INFORME DE HORAS)"));
});

// ── client add ──────────────────────────────────────────────────────────

const idiomaEnBase = (db: string): string | undefined => {
  const conn = openDatabase(db);
  try { return store.getClient(conn, "acme")?.language; } finally { conn.close(); }
};

test("client add --language lo fija, volver a ejecutarlo sin él lo conserva, y auto lo quita", () => {
  const { db } = preparar();

  const fija = estela(db, "es", "client", "add", "--id", "acme", "--name", "ACME",
    "--currency", "EUR", "--language", "en");
  assert.equal(fija.code, 0, fija.out);
  assert.match(fija.out, /Sus documentos salen en inglés/);
  assert.equal(idiomaEnBase(db), "en");

  // Cambiar un correo no puede cambiar el idioma de los PDFs sin avisar.
  estela(db, "es", "client", "add", "--id", "acme", "--name", "ACME",
    "--currency", "EUR", "--email", "nuevo@acme.test");
  assert.equal(idiomaEnBase(db), "en", "sin --language se conserva el que había");

  estela(db, "es", "client", "add", "--id", "acme", "--name", "ACME",
    "--currency", "EUR", "--language", "auto");
  assert.equal(idiomaEnBase(db), undefined, "auto vuelve a seguir la terminal");
});

test("client add rechaza un idioma que no existe, sin guardar nada", () => {
  const { db } = preparar();
  const r = estela(db, "es", "client", "add", "--id", "acme", "--name", "Otro",
    "--currency", "EUR", "--language", "fr");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /--language admite es, en o auto, y recibí "fr"/);

  const conn = openDatabase(db);
  try { assert.equal(store.getClient(conn, "acme")!.name, "ACME", "no se tocó la ficha"); }
  finally { conn.close(); }
});
