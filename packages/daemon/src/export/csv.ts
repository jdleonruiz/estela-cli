import type { Client, Invoice, Project, TimeEntry } from "@estela/shared";
import { billableAmount, formatMoney } from "@estela/shared";

import { getLang } from "../i18n/index.js";

/**
 * Export a CSV.
 *
 * Existe para que puedas llevarte tus datos a Excel, a tu gestoría o a otra
 * herramienta. Poder salir es parte de merecer que te dejen entrar.
 */

/**
 * Las cabeceras y etiquetas del CSV, por idioma.
 *
 * Es una tabla y no `tr`: son nombres de columna, un formato de datos. Quien
 * ya procesa el CSV en español (una macro de Excel, el programa de su gestoría)
 * depende de que esos nombres no cambien nunca, así que el español está fijo
 * aquí, aparte del catálogo de frases, que sí se retoca con el tiempo.
 */
const COLUMNS = {
  es: {
    entries: ["fecha", "inicio", "fin", "horas", "descripcion", "proyecto", "cliente",
              "facturable", "tarifa", "moneda", "importe", "coste_ia_usd", "factura", "commits"],
    yes: "si", no: "no",
    invoice: "factura", client: "cliente", project: "proyecto", issued: "emitida",
    period: "periodo", to: "a", currency: "moneda",
    lineHeader: ["concepto", "horas", "tarifa", "importe"],
    subtotal: "subtotal", aiBilled: "coste_ia_repercutido", total: "total",
    aiUsage: "consumo_ia_usd_equiv_api",
  },
  en: {
    entries: ["date", "start", "end", "hours", "description", "project", "client",
              "billable", "rate", "currency", "amount", "ai_cost_usd", "invoice", "commits"],
    yes: "yes", no: "no",
    invoice: "invoice", client: "client", project: "project", issued: "issued",
    period: "period", to: "to", currency: "currency",
    lineHeader: ["item", "hours", "rate", "amount"],
    subtotal: "subtotal", aiBilled: "ai_cost_passed_on", total: "total",
    aiUsage: "ai_usage_usd_api_equiv",
  },
} as const;

/** Escapa un campo. Sin esto, un commit con una coma parte la fila en dos. */
function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rows(lines: readonly (readonly unknown[])[]): string {
  // BOM para que Excel abra los acentos y el euro sin destrozarlos.
  return "﻿" + lines.map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function timeEntriesToCsv(
  entries: readonly TimeEntry[],
  project: Project,
  client: Client,
  hourlyRateOf: (at: Date) => { amount: number; currency: string } | null,
): string {
  const c = COLUMNS[getLang()];
  const lines: unknown[][] = [[...c.entries]];

  for (const e of entries) {
    const rate = hourlyRateOf(e.startedAt);
    const amount = rate
      ? billableAmount(e.seconds, rate as never).amount / 100
      : null;

    lines.push([
      e.startedAt.toISOString().slice(0, 10),
      e.startedAt.toISOString().slice(11, 16),
      e.endedAt.toISOString().slice(11, 16),
      (e.seconds / 3600).toFixed(4),
      e.description,
      project.name,
      client.name,
      e.billable ? c.yes : c.no,
      rate ? (rate.amount / 100).toFixed(2) : "",
      rate?.currency ?? "",
      amount === null ? "" : amount.toFixed(2),
      (e.aiCost.microUsd / 1_000_000).toFixed(4),
      e.invoiceId ?? "",
      e.commitHashes.join(" "),
    ]);
  }

  return rows(lines);
}

export function invoiceToCsv(invoice: Invoice, client: Client, project: Project): string {
  const c = COLUMNS[getLang()];
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const lines: unknown[][] = [
    [c.invoice, invoice.number],
    [c.client, client.name],
    [c.project, project.name],
    [c.issued, day(invoice.issuedAt)],
    [c.period, `${day(invoice.periodStart)} ${c.to} ${day(invoice.cutoffAt)}`],
    [c.currency, invoice.currency],
    [],
    [...c.lineHeader],
  ];

  for (const line of invoice.lines) {
    lines.push([
      line.description,
      (line.seconds / 3600).toFixed(4),
      (line.hourlyRate.amount / 100).toFixed(2),
      (line.amount.amount / 100).toFixed(2),
    ]);
  }

  lines.push([]);
  lines.push([c.subtotal, "", "", (invoice.subtotal.amount / 100).toFixed(2)]);
  if (invoice.aiCostBilled) {
    lines.push([c.aiBilled, "", "", (invoice.aiCostBilled.amount / 100).toFixed(2)]);
  }
  lines.push([c.total, "", "", (invoice.total.amount / 100).toFixed(2)]);
  lines.push([c.aiUsage, "", "", (invoice.aiCost.microUsd / 1_000_000).toFixed(4)]);

  return rows(lines);
}

export { formatMoney };
