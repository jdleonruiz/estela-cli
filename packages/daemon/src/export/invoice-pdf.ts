import type { Client, Invoice, Money, Project } from "@estela/shared";
import { formatAiCost, formatDuration, formatMoney } from "@estela/shared";

import { getLang, moneyLocale, tr } from "../i18n/index.js";
import { PdfDocument } from "./pdf.js";

/**
 * Maqueta la factura en PDF.
 *
 * Las columnas se alinean por el borde derecho porque una columna de importes
 * desalineada es lo primero que hace que una factura parezca improvisada.
 */

export interface InvoicePdfOptions {
  /** Datos de quien emite. Van en la cabecera. */
  readonly issuer?: {
    readonly name: string;
    readonly taxId?: string;
    readonly email?: string;
    readonly address?: string;
  };
  /** Coste real de IA imputado al periodo (cuota amortizada). Solo informativo. */
  readonly amortizedAiCost?: Money;
  readonly footer?: string;
}

const M = 56;              // margen
const COL_TIME = 372;      // bordes derechos de cada columna
const COL_RATE = 452;
const COL_AMOUNT = 539;
const BOTTOM = 780;

export function invoiceToPdf(
  invoice: Invoice,
  client: Client,
  project: Project,
  options: InvoicePdfOptions = {},
): Buffer {
  const doc = new PdfDocument();
  const date = (d: Date) => d.toISOString().slice(0, 10);
  // Los importes van con el locale del documento, no con el de la terminal: el
  // cliente lee "€1.254,79" o "€1,254.79" según SU idioma.
  const money = (m: Money) => formatMoney(m, moneyLocale(getLang()));
  let y = M;

  // --- Cabecera -------------------------------------------------------------
  doc.text(M, y + 4, tr`INFORME DE HORAS`, "Helvetica-Bold", 20);
  doc.textRight(COL_AMOUNT, y - 2, invoice.number, "Helvetica-Bold", 12);
  doc.textRight(COL_AMOUNT, y + 12, tr`Emitido el ${date(invoice.issuedAt)}`, "Helvetica", 9, 0.4);
  y += 30;

  doc.line(M, y, COL_AMOUNT, y, 1.2, 0.15);
  y += 24;

  // --- Emisor y cliente, en dos columnas -----------------------------------
  const rightCol = M + 260;
  const issuer = options.issuer;

  if (issuer) {
    doc.text(M, y, tr`DE`, "Helvetica-Bold", 8, 0.45);
    doc.text(M, y + 15, issuer.name, "Helvetica-Bold", 11);
    let sub = y + 29;
    for (const line of [issuer.taxId, issuer.email, issuer.address]) {
      if (!line) continue;
      doc.text(M, sub, line, "Helvetica", 9, 0.35);
      sub += 12;
    }
  }

  doc.text(rightCol, y, tr`PARA`, "Helvetica-Bold", 8, 0.45);
  doc.text(rightCol, y + 15, client.name, "Helvetica-Bold", 11);
  let clientY = y + 29;
  for (const line of [client.taxId, client.email, client.address]) {
    if (!line) continue;
    doc.text(rightCol, clientY, line, "Helvetica", 9, 0.35);
    clientY += 12;
  }

  y = Math.max(clientY, y + 70) + 14;

  // --- Proyecto y periodo ---------------------------------------------------
  doc.rect(M, y - 12, COL_AMOUNT - M, 34, 0.96);
  doc.text(M + 12, y, tr`PROYECTO`, "Helvetica-Bold", 8, 0.45);
  doc.text(M + 12, y + 13, project.name, "Helvetica", 10);
  doc.text(rightCol, y, tr`PERIODO`, "Helvetica-Bold", 8, 0.45);
  doc.text(rightCol, y + 13,
    tr`${date(invoice.periodStart)}  al  ${date(invoice.cutoffAt)}`, "Helvetica", 10);
  y += 48;

  // --- Cabecera de tabla ----------------------------------------------------
  const header = () => {
    doc.text(M, y, tr`CONCEPTO`, "Helvetica-Bold", 8, 0.45);
    doc.textRight(COL_TIME, y, tr`TIEMPO`, "Helvetica-Bold", 8, 0.45);
    doc.textRight(COL_RATE, y, tr`TARIFA`, "Helvetica-Bold", 8, 0.45);
    doc.textRight(COL_AMOUNT, y, tr`IMPORTE`, "Helvetica-Bold", 8, 0.45);
    y += 7;
    doc.line(M, y, COL_AMOUNT, y, 0.8, 0.3);
    y += 15;
  };
  header();

  // --- Conceptos ------------------------------------------------------------
  // La columna TIEMPO se alinea a la derecha en COL_TIME, así que su texto crece
  // hacia la izquierda. Hay que restar el más ancho de esos textos, no un hueco
  // fijo, o la descripción se le mete encima.
  const widestTime = invoice.lines.reduce(
    (max, l) => Math.max(max, PdfDocument.measure(formatDuration(l.seconds), "Helvetica", 10)), 0);
  const maxDescWidth = COL_TIME - M - widestTime - 14;

  for (const line of invoice.lines) {
    if (y > BOTTOM - 60) {
      doc.newPage();
      y = M;
      header();
    }

    const text = PdfDocument.truncate(line.description, "Helvetica", 10, maxDescWidth);
    doc.text(M, y, text, "Helvetica", 10);
    doc.textRight(COL_TIME, y, formatDuration(line.seconds), "Helvetica", 10, 0.2);
    doc.textRight(COL_RATE, y, `${money(line.hourlyRate)}/h`, "Helvetica", 10, 0.4);
    doc.textRight(COL_AMOUNT, y, money(line.amount), "Helvetica", 10);
    y += 9;
    doc.line(M, y, COL_AMOUNT, y, 0.4, 0.9);
    y += 12;
  }

  // --- Totales --------------------------------------------------------------
  if (y > BOTTOM - 110) { doc.newPage(); y = M; }

  y += 8;
  doc.line(M, y, COL_AMOUNT, y, 0.8, 0.3);
  y += 18;

  doc.text(M, y, invoice.lines.length === 1 ? tr`1 concepto` : tr`${invoice.lines.length} conceptos`, "Helvetica", 9, 0.4);
  doc.textRight(COL_TIME, y, formatDuration(invoice.totalSeconds), "Helvetica-Bold", 10);
  doc.textRight(COL_AMOUNT, y, money(invoice.subtotal), "Helvetica", 10);
  y += 18;

  if (invoice.aiCostBilled) {
    doc.text(M, y,
      tr`Coste de IA repercutido (1 USD = ${invoice.usdFxRate} ${invoice.currency})`,
      "Helvetica", 9, 0.4);
    doc.textRight(COL_AMOUNT, y, money(invoice.aiCostBilled), "Helvetica", 10);
    y += 18;
  }

  y += 4;
  doc.rect(rightCol - 20, y - 14, COL_AMOUNT - rightCol + 20, 32, 0.94);
  doc.text(rightCol - 8, y + 2, tr`VALOR`, "Helvetica-Bold", 11);
  doc.textRight(COL_AMOUNT - 8, y + 3, money(invoice.total), "Helvetica-Bold", 14);
  y += 46;

  // --- Nota interna ---------------------------------------------------------
  // Lo que costó la IA es tuyo, no del cliente: va en gris, al pie, y nunca
  // dentro del bloque de totales.
  if (invoice.aiCost.microUsd > 0 && !invoice.aiCostBilled) {
    doc.line(M, y, COL_AMOUNT, y, 0.4, 0.85);
    y += 14;
    doc.text(M, y, tr`NOTA INTERNA (no se comparte)`, "Helvetica-Bold", 7, 0.55);
    y += 12;

    const consumption = tr`Consumo de IA del periodo: ${formatAiCost(invoice.aiCost)} en tarifa API equivalente.`;
    doc.text(M, y, consumption, "Helvetica", 8, 0.5);
    y += 11;

    if (options.amortizedAiCost) {
      doc.text(M, y,
        tr`Coste real imputado desde tu suscripción: ${money(options.amortizedAiCost)}.`,
        "Helvetica", 8, 0.5);
      y += 11;
    }
  }

  if (invoice.notes) {
    y += 6;
    for (const line of PdfDocument.wrap(invoice.notes, "Helvetica", 9, COL_AMOUNT - M)) {
      doc.text(M, y, line, "Helvetica", 9, 0.35);
      y += 12;
    }
  }

  if (options.footer) {
    doc.text(M, BOTTOM + 20, options.footer, "Helvetica", 8, 0.55);
  }

  return doc.toBuffer();
}
