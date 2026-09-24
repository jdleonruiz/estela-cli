import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client, Invoice, Project } from "@estela/shared";
import { money } from "@estela/shared";

import { invoiceToPdf } from "./invoice-pdf.js";
import { PdfDocument } from "./pdf.js";

test("produce un PDF con cabecera, xref y EOF", () => {
  const doc = new PdfDocument();
  doc.text(50, 50, "Hola");
  const pdf = doc.toBuffer();
  const text = pdf.toString("latin1");

  assert.ok(text.startsWith("%PDF-1.4"), "cabecera PDF");
  assert.ok(text.includes("/Type /Catalog"));
  assert.ok(text.includes("/Type /Pages"));
  assert.ok(text.includes("xref"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
});

test("los offsets de xref apuntan de verdad a cada objeto", () => {
  // Un xref mal calculado abre en algunos lectores y falla en otros. Este test
  // comprueba lo que un lector estricto comprueba.
  const doc = new PdfDocument();
  doc.text(50, 50, "Prueba");
  doc.newPage();
  doc.text(50, 50, "Segunda");
  const pdf = doc.toBuffer();
  const text = pdf.toString("latin1");

  const startxref = Number(/startxref\s+(\d+)/.exec(text)![1]);
  assert.ok(text.slice(startxref).startsWith("xref"), "startxref apunta a la tabla");

  const entries = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)];
  assert.ok(entries.length >= 5);
  entries.forEach((entry, i) => {
    const offset = Number(entry[1]);
    assert.ok(text.slice(offset).startsWith(`${i + 1} 0 obj`),
      `el objeto ${i + 1} debe empezar en el offset ${offset}`);
  });
});

test("los acentos y el euro se codifican en WinAnsi", () => {
  const doc = new PdfDocument();
  doc.text(50, 50, "Migración de diseño — €13,00/h en Cataluña");
  const text = doc.toBuffer().toString("latin1");

  assert.ok(text.includes("\\200"), "el euro se escapa como octal 200 (WinAnsi)");
  assert.ok(text.includes("\\361"), "la eñe se escapa como octal 361");
  assert.ok(text.includes("\\363"), "la o acentuada se escapa como octal 363");
});

test("los paréntesis y la barra invertida se escapan", () => {
  const doc = new PdfDocument();
  doc.text(50, 50, "feat(auth): C:\\ruta (importante)");
  const text = doc.toBuffer().toString("latin1");

  assert.ok(text.includes("feat\\(auth\\)"), "paréntesis escapados");
  assert.ok(text.includes("C:\\\\ruta"), "barra invertida escapada");
});

test("las anchuras permiten alinear a la derecha", () => {
  // Si measure() devolviera siempre lo mismo, la columna de importes bailaría.
  const ancho = PdfDocument.measure("MMMMM", "Helvetica", 10);
  const estrecho = PdfDocument.measure("iiiii", "Helvetica", 10);
  assert.ok(ancho > estrecho * 2, `M debe ser mucho más ancha que i (${ancho} vs ${estrecho})`);

  // Courier es monoespaciada: cinco caracteres siempre miden lo mismo.
  assert.equal(
    PdfDocument.measure("MMMMM", "Courier", 10),
    PdfDocument.measure("iiiii", "Courier", 10));
});

test("una vocal acentuada mide lo mismo que su base", () => {
  assert.equal(
    PdfDocument.measure("a", "Helvetica", 10),
    PdfDocument.measure("á", "Helvetica", 10));
  assert.equal(
    PdfDocument.measure("n", "Helvetica", 10),
    PdfDocument.measure("ñ", "Helvetica", 10));
});

test("trunca en vez de desbordar la columna", () => {
  const largo = "feat(permisos): rediseño completo del gestor de tablas y sus filtros";
  const corto = PdfDocument.truncate(largo, "Helvetica", 10, 120);

  assert.ok(corto.endsWith("..."));
  assert.ok(PdfDocument.measure(corto, "Helvetica", 10) <= 120);
  assert.ok(corto.length < largo.length);
});

test("wrap parte el texto respetando el ancho", () => {
  const lines = PdfDocument.wrap(
    "Pago a 30 días mediante transferencia bancaria a la cuenta indicada.",
    "Helvetica", 9, 150);

  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(PdfDocument.measure(line, "Helvetica", 9) <= 150, `"${line}" cabe`);
  }
  assert.equal(lines.join(" ").replace(/\s+/g, " "),
    "Pago a 30 días mediante transferencia bancaria a la cuenta indicada.");
});

// ---------------------------------------------------------------------------

const CLIENT: Client = { id: "nebula", name: "Nebula", currency: "EUR", taxId: "B-12345678" };
const PROJECT: Project = {
  id: "p", clientId: "nebula", name: "Portal Ventas", repoPaths: [],
  billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client", closedAt: null,
};

function invoice(lineCount: number): Invoice {
  const lines = Array.from({ length: lineCount }, (_, i) => ({
    description: `Desarrollo en servicios-socios-cartera día ${i + 1}`,
    seconds: 3600, hourlyRate: money(1300, "EUR"), amount: money(1300, "EUR"),
  }));
  return {
    id: "inv", number: "F-2026-001", clientId: "nebula", projectId: "p",
    issuedAt: new Date("2026-08-26T10:00:00Z"),
    cutoffAt: new Date("2026-08-26T23:59:59Z"),
    periodStart: new Date("2026-07-29T00:00:00Z"),
    currency: "EUR", lines,
    subtotal: money(1300 * lineCount, "EUR"), total: money(1300 * lineCount, "EUR"),
    totalSeconds: 3600 * lineCount, aiCost: { microUsd: 315_950_000 },
    usdFxRate: null, aiCostBilled: null, aiAmortized: null,
  };
}

test("el informe en PDF incluye los datos clave", () => {
  const pdf = invoiceToPdf(invoice(3), CLIENT, PROJECT, {
    issuer: { name: "Jonathan León", taxId: "1712345678", email: "jd@ejemplo.com" },
  });
  const text = pdf.toString("latin1");

  assert.ok(text.includes("INFORME DE HORAS"));
  assert.ok(!text.includes("FACTURA"), "no se presenta como documento fiscal");
  assert.ok(text.includes("F-2026-001"));
  assert.ok(text.includes("Nebula"));
  assert.ok(text.includes("Le\\363n"), "el emisor con acento va codificado");
  assert.ok(pdf.length > 1500);
});

test("muchos conceptos generan varias páginas en vez de desbordar", () => {
  const una = invoiceToPdf(invoice(5), CLIENT, PROJECT);
  const muchas = invoiceToPdf(invoice(80), CLIENT, PROJECT);

  const count = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;
  assert.equal(count(una), 1);
  assert.ok(count(muchas) >= 3, `80 conceptos deben ocupar varias páginas, salieron ${count(muchas)}`);
});

test("una descripción larga no invade la columna de tiempo", () => {
  // El fallo que esto previene: reservar un hueco fijo en vez del ancho real de
  // la columna TIEMPO, que se alinea a la derecha y crece hacia la izquierda.
  const inv = invoice(1);
  const largo = {
    ...inv.lines[0]!,
    description: "feat: permisos por tabla y rediseño del generador de informes con filtros avanzados",
    seconds: 4 * 3600 + 16 * 60,
  };
  const text = invoiceToPdf({ ...inv, lines: [largo] }, CLIENT, PROJECT).toString("latin1");

  // Extrae los dos textos de esa fila y comprueba que no se solapan.
  const ops = [...text.matchAll(/BT \/F1 10 Tf ([\d.]+) ([\d.]+) Td \((.*?)\) Tj ET/g)];
  const desc = ops.find((o) => o[3]!.startsWith("feat"));
  const time = ops.find((o) => o[3] === "4h 16m");

  assert.ok(desc, "la descripción está en el PDF");
  assert.ok(time, "el tiempo está en el PDF");
  assert.equal(desc![2], time![2], "van en la misma fila");

  const descEnd = Number(desc![1]) + PdfDocument.measure(
    desc![3]!.replace(/\\(\d{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
             .replace(/\\([()\\])/g, "$1"),
    "Helvetica", 10);
  assert.ok(descEnd <= Number(time![1]),
    `la descripción acaba en ${descEnd.toFixed(1)} y el tiempo empieza en ${time![1]}`);
});

test("el coste de IA no aparece en el informe, ni siquiera como nota", () => {
  // Estaba como "NOTA INTERNA (no se comparte)" al pie. Pero esa frase era un
  // deseo, no un mecanismo: este PDF es justo el que se adjunta a la factura
  // del cliente, así que en cuanto se envía, se comparte.
  //
  // Y contradice lo que promete la web: "nunca tu tarifa ni tu consumo de IA,
  // porque un cliente que sabe qué parte generó una IA tiene un argumento
  // nuevo para negociar tu tarifa". Tu gasto de IA sigue estando en
  // `estela ai-cost` y en el panel local, que son tuyos.
  const inv = invoice(2);
  const text = invoiceToPdf(inv, CLIENT, PROJECT).toString("latin1");

  assert.ok(!text.includes("NOTA INTERNA"), "no puede quedar rastro de la nota");
  assert.ok(!text.includes("no se comparte"));
  assert.ok(!text.includes("Consumo de IA"));
  assert.ok(!text.includes("tarifa API"));
  assert.equal(inv.total.amount, 2600, "el valor sigue siendo solo las horas");
});

test("tampoco cuando el coste de IA se repercute al cliente", () => {
  // Si se repercute, aparece como una línea de la factura, que es otra cosa:
  // ahí el cliente lo paga y tiene derecho a verlo. Lo que no puede salir es
  // la nota con tu consumo cuando lo pagas tú.
  const inv = invoice(2);
  const text = invoiceToPdf(inv, CLIENT, PROJECT, {
    amortizedAiCost: { amount: 13205, currency: "EUR" },
  }).toString("latin1");

  assert.ok(!text.includes("NOTA INTERNA"));
  assert.ok(!text.includes("Coste real imputado"));
});
