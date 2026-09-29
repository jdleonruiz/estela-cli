import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { inflateSync } from "node:zlib";

import type { EntrySource, TimeEntry } from "@estela/shared";

import { openDatabase } from "../db/schema.js";
import * as store from "../db/store.js";
import { EN } from "../i18n/en.js";
import { PRICE_CATALOG } from "../pricing/catalog.js";
import { hasGlyph } from "./pixelfont.js";
import { crc32, Lienzo } from "./png.js";
import { receiptData, receiptText, renderReceipt } from "./receipt.js";

// ── El PNG ──────────────────────────────────────────────────────────────

/** Lee los trozos de un PNG: lo justo para comprobar que es uno de verdad. */
function trozos(png: Buffer): Map<string, Buffer> {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const out = new Map<string, Buffer>();
  let i = 8;
  while (i < png.length) {
    const largo = png.readUInt32BE(i);
    const tipo = png.subarray(i + 4, i + 8).toString("ascii");
    const datos = png.subarray(i + 8, i + 8 + largo);
    assert.equal(png.readUInt32BE(i + 8 + largo), crc32(png.subarray(i + 4, i + 8 + largo)), `CRC de ${tipo}`);
    out.set(tipo, Buffer.concat([out.get(tipo) ?? Buffer.alloc(0), datos]));
    i += 12 + largo;
  }
  return out;
}

test("crc32 da el valor de referencia", () => {
  // El CRC del trozo IEND vacío: está en todos los PNG del mundo.
  assert.equal(crc32(Buffer.from("IEND", "ascii")), 0xae426082);
});

test("el PNG se decodifica con las medidas y los píxeles que se pintaron", () => {
  const l = new Lienzo(3, 2, [255, 255, 255]);
  l.set(1, 1, [10, 20, 30]);
  const t = trozos(l.png());
  assert.equal(t.get("IHDR")!.readUInt32BE(0), 3);
  assert.equal(t.get("IHDR")!.readUInt32BE(4), 2);
  const crudo = inflateSync(t.get("IDAT")!);
  assert.equal(crudo.length, (3 * 3 + 1) * 2);
  // Fila 1, columna 1: saltar la fila 0 entera (10 bytes) y el byte de filtro.
  assert.deepEqual([...crudo.subarray(10 + 1 + 3, 10 + 1 + 6)], [10, 20, 30]);
  assert.ok(t.has("IEND"));
});

// ── La fuente ───────────────────────────────────────────────────────────

test("la fuente tiene todas las letras de las etiquetas del recibo, en los dos idiomas", () => {
  const etiquetas = ["RECIBO DE LA SEMANA", "RECIBO DE TU HISTORIAL", "HORAS MEDIDAS", "HORAS ESTIMADAS",
    "AÑADIDAS A MANO", "TOTAL", "{0} MEDIDO", "COSTE DE IA", "(A TARIFA API)", "AHORRO POR CACHÉ",
    "PROYECTO MÁS CARO", "RAMA MÁS CARA", "SIN CONSUMO DE IA", "HORAS QUE NO TUVISTE QUE RELLENAR"];
  const textos = [...etiquetas, ...etiquetas.map((e) => EN[e]!), "getestela.dev", "SEPT – OCT $1,204.50 100%"];
  for (const texto of textos) {
    for (const ch of texto.replace("{0}", "")) assert.ok(hasGlyph(ch), `falta el glifo "${ch}" (en "${texto}")`);
  }
});

// ── Los números ─────────────────────────────────────────────────────────

function bloque(id: string, projectId: string, day: string, source: EntrySource, hours: number,
                aiUsd: number, branch: string | null = "main"): TimeEntry {
  const startedAt = new Date(`${day}T10:00:00Z`);
  return {
    id, projectId, startedAt, endedAt: new Date(startedAt.getTime() + hours * 3600_000),
    seconds: hours * 3600, description: "Trabajo", billable: true, invoiceId: null,
    aiCost: { microUsd: aiUsd * 1_000_000 }, agentSeconds: 0, commitHashes: [], agents: [],
    source, kind: "development", branch,
  };
}

const NOMBRES = new Map([["web", "Web"], ["app", "App"]]);

test("el recibo separa medido, estimado y a mano, y solo cuenta lo del periodo", () => {
  const d = receiptData({
    entries: [
      bloque("a", "web", "2026-09-22", "agent", 5, 10),
      bloque("b", "web", "2026-09-23", "commit", 2, 0),
      bloque("c", "app", "2026-09-24", "manual", 1, 0),
      bloque("fuera", "web", "2026-09-01", "agent", 50, 500),
    ],
    projectNames: NOMBRES, turns: [],
    from: new Date("2026-09-22T00:00:00Z"), to: new Date("2026-09-29T00:00:00Z"),
  });
  assert.equal(d.measuredSeconds, 5 * 3600);
  assert.equal(d.estimatedSeconds, 2 * 3600);
  assert.equal(d.manualSeconds, 3600);
  assert.equal(d.aiCost.microUsd, 10_000_000);
});

test("el proyecto y la rama más caros son los de más coste de IA, no los de más horas", () => {
  const d = receiptData({
    entries: [
      bloque("a", "web", "2026-09-22", "agent", 20, 5, "feat/login"),
      bloque("b", "app", "2026-09-23", "agent", 2, 30, "feat/pagos"),
      bloque("c", "app", "2026-09-24", "agent", 1, 4, "fix/menu"),
    ],
    projectNames: NOMBRES, turns: [], from: null, to: new Date("2026-10-01T00:00:00Z"),
  });
  assert.deepEqual(d.topProject, { name: "App", cost: { microUsd: 34_000_000 } });
  assert.equal(d.topFeature!.name, "feat/pagos");
  // Sin --week empieza en el primer bloque.
  assert.equal(d.from.toISOString(), "2026-09-22T10:00:00.000Z");
});

test("por defecto el recibo no lleva nombres de proyectos ni de ramas: suelen ser de clientes", () => {
  const d = receiptData({
    entries: [bloque("a", "app", "2026-09-22", "agent", 2, 30, "feat/pagos-acme")],
    projectNames: new Map([["app", "ACME Banca"]]), turns: [], from: null, to: new Date("2026-10-01T00:00:00Z"),
  });
  const sin = receiptText(d, { week: false }).join("\n");
  assert.doesNotMatch(sin, /ACME|pagos-acme/);
  assert.match(sin, /PROYECTO MÁS CARO \$30\.00/);
  assert.match(sin, /RAMA MÁS CARA \$30\.00/);

  const con = receiptText(d, { week: false, names: true }).join("\n");
  assert.match(con, /ACME Banca \$30\.00/);
  assert.match(con, /feat\/pagos-acme \$30\.00/);
});

test("sin consumo de IA no hay proyecto ni rama más caros que enseñar", () => {
  const d = receiptData({
    entries: [bloque("a", "web", "2026-09-22", "commit", 3, 0)],
    projectNames: NOMBRES, turns: [], from: null, to: new Date("2026-10-01T00:00:00Z"),
  });
  assert.equal(d.topProject, null);
  assert.equal(d.topFeature, null);
});

test("el ahorro por caché: lo leído de caché a precio completo, menos lo que costó escribir en ella", () => {
  const precio = PRICE_CATALOG[0]!;
  const at = new Date(new Date(precio.effectiveFrom).getTime() + 86_400_000);
  const d = receiptData({
    entries: [], projectNames: NOMBRES, from: null, to: new Date(at.getTime() + 86_400_000),
    turns: [{ at, model: precio.modelPrefix, cacheRead: 1_000_000, cacheWrite5m: 100_000, cacheWrite1h: 0 }],
  });
  const esperado = precio.inputPerMTok * (1 - precio.cacheReadMultiplier)
    - 0.1 * precio.inputPerMTok * (precio.cacheWrite5mMultiplier - 1);
  assert.equal(d.cacheSavings.microUsd, Math.round(esperado * 1_000_000));
});

test("el recibo pintado es un PNG con el ancho de un ticket", () => {
  const d = receiptData({
    entries: [bloque("a", "web", "2026-09-22", "agent", 5, 10, "feat/una-rama-con-un-nombre-muy-largo")],
    projectNames: NOMBRES, turns: [], from: null, to: new Date("2026-10-01T00:00:00Z"),
  });
  const t = trozos(renderReceipt(d, { week: false }));
  const ancho = t.get("IHDR")!.readUInt32BE(0);
  const alto = t.get("IHDR")!.readUInt32BE(4);
  assert.ok(ancho > 600 && ancho < 900, `ancho ${ancho}`);
  assert.ok(alto > ancho, "un ticket es más alto que ancho");
});

// ── El comando ──────────────────────────────────────────────────────────

const BIN = join(__dirname, "..", "bin.js");

test("estela receipt deja un PNG en disco y dice dónde", () => {
  const dir = mkdtempSync(join(tmpdir(), "estela-receipt-"));
  const dbPath = join(dir, "estela.db");
  const db = openDatabase(dbPath);
  try {
    store.upsertClient(db, { id: "c", name: "Interno", currency: "EUR" });
    store.upsertProject(db, {
      id: "web", clientId: "c", name: "Web", repoPaths: [],
      billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
    });
    store.saveTimeEntry(db, bloque("a", "web", new Date().toISOString().slice(0, 10), "agent", 2, 3));
  } finally { db.close(); }

  const out = join(dir, "recibo.png");
  const r = spawnSync(process.execPath, [BIN, "receipt", "--week", "--out", out, "--db", dbPath], {
    encoding: "utf8", env: { ...process.env, ESTELA_LANG: "es", NO_COLOR: "1" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Recibo guardado en .*recibo\.png/);
  assert.match(r.stdout, /no se ha enviado a ningún sitio/);
  assert.match(r.stdout, /Sin nombres de proyectos ni ramas/);
  trozos(readFileSync(out));
});
