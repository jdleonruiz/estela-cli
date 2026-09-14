import type { Client, Invoice, Project, TimeEntry } from "@estela/shared";
import { billableAmount, formatMoney } from "@estela/shared";

/**
 * Export a CSV.
 *
 * Existe para que puedas llevarte tus datos a Excel, a tu gestoría o a otra
 * herramienta. Poder salir es parte de merecer que te dejen entrar.
 */

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
  const header = [
    "fecha", "inicio", "fin", "horas", "descripcion", "proyecto", "cliente",
    "facturable", "tarifa", "moneda", "importe", "coste_ia_usd", "factura", "commits",
  ];

  const lines: unknown[][] = [header];

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
      e.billable ? "si" : "no",
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
  const lines: unknown[][] = [
    ["factura", invoice.number],
    ["cliente", client.name],
    ["proyecto", project.name],
    ["emitida", invoice.issuedAt.toISOString().slice(0, 10)],
    ["periodo", `${invoice.periodStart.toISOString().slice(0, 10)} a ${invoice.cutoffAt.toISOString().slice(0, 10)}`],
    ["moneda", invoice.currency],
    [],
    ["concepto", "horas", "tarifa", "importe"],
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
  lines.push(["subtotal", "", "", (invoice.subtotal.amount / 100).toFixed(2)]);
  if (invoice.aiCostBilled) {
    lines.push(["coste_ia_repercutido", "", "", (invoice.aiCostBilled.amount / 100).toFixed(2)]);
  }
  lines.push(["total", "", "", (invoice.total.amount / 100).toFixed(2)]);
  lines.push(["consumo_ia_usd_equiv_api", "", "", (invoice.aiCost.microUsd / 1_000_000).toFixed(4)]);

  return rows(lines);
}

export { formatMoney };
