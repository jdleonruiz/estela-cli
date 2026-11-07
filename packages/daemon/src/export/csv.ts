import type { Client, Invoice, Project, TimeEntry } from "@estela/shared";
import { billableAmount, formatMoney, formatWorkItem, MINOR_UNIT_DIGITS } from "@estela/shared";

import { localizeDescription } from "../billing/localize.js";
import { getLang } from "../i18n/index.js";
import type { SpendBy, SpendProject, SpendProjectReport } from "../metrics/spend.js";
import { shareOf, type Spend, type UndeliveredReport } from "../metrics/undelivered.js";

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
              "facturable", "tarifa", "moneda", "importe", "coste_ia_usd", "factura", "commits",
              // Al final a propósito: quien lee las columnas por posición no se rompe.
              "tickets"],
    yes: "si", no: "no",
    invoice: "factura", client: "cliente", project: "proyecto", issued: "emitida",
    period: "periodo", to: "a", currency: "moneda",
    lineHeader: ["concepto", "horas", "tarifa", "importe"],
    subtotal: "subtotal", aiBilled: "coste_ia_repercutido", total: "total",
    aiUsage: "consumo_ia_usd_equiv_api",
    spend: ["proyecto", "cliente", "unidad", "atribuido", "ramas", "tickets", "pr", "segun", "horas",
            "coste_ia_usd_equiv_api", "gasto_real", "moneda", "gasto_real_parcial", "incluye_copilot_sin_coste"],
    undelivered: ["proyecto", "cliente", "bloque", "detalle", "cuenta", "dias_sin_actividad",
                  "coste_ia_usd_equiv_api", "gasto_real", "moneda", "gasto_real_parcial", "pct_del_gasto"],
    blocks: { total: "gasto_del_periodo", sessions: "sesiones_sin_commit", later: "de_ellas_con_commit_despues",
              unverifiable: "sesiones_sin_datos_de_commits",
              unmerged: "rama_sin_fusionar", open: "rama_abierta", unknown: "rama_desconocida",
              undelivered: "sin_entrega_total" },
  },
  en: {
    entries: ["date", "start", "end", "hours", "description", "project", "client",
              "billable", "rate", "currency", "amount", "ai_cost_usd", "invoice", "commits",
              "tickets"],
    yes: "yes", no: "no",
    invoice: "invoice", client: "client", project: "project", issued: "issued",
    period: "period", to: "to", currency: "currency",
    lineHeader: ["item", "hours", "rate", "amount"],
    subtotal: "subtotal", aiBilled: "ai_cost_passed_on", total: "total",
    aiUsage: "ai_usage_usd_api_equiv",
    spend: ["project", "client", "unit", "attributed", "branches", "tickets", "pr", "basis", "hours",
            "ai_cost_usd_api_equiv", "real_spend", "currency", "real_spend_partial", "includes_unpriced_copilot"],
    undelivered: ["project", "client", "block", "detail", "counts", "idle_days",
                  "ai_cost_usd_api_equiv", "real_spend", "currency", "real_spend_partial", "pct_of_spend"],
    blocks: { total: "period_spend", sessions: "sessions_without_commit", later: "of_which_committed_later",
              unverifiable: "sessions_without_commit_data",
              unmerged: "unmerged_branch", open: "open_branch", unknown: "unknown_branch",
              undelivered: "undelivered_total" },
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
      localizeDescription(e),
      project.name,
      client.name,
      e.billable ? c.yes : c.no,
      rate ? (rate.amount / 100).toFixed(2) : "",
      rate?.currency ?? "",
      amount === null ? "" : amount.toFixed(2),
      (e.aiCost.microUsd / 1_000_000).toFixed(4),
      e.invoiceId ?? "",
      e.commitHashes.join(" "),
      (e.workItems ?? []).map(formatWorkItem).join(" "),
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

/**
 * `estela ai-cost --by … --csv`: una fila por rama o ticket. "Sin atribuir"
 * va con la unidad vacía y atribuido = no, para que una tabla dinámica no la
 * confunda con una rama que se llame así.
 */
export function spendToCsv(reports: readonly SpendProjectReport[], by: SpendBy): string {
  const c = COLUMNS[getLang()];
  const lines: unknown[][] = [[...c.spend]];
  for (const r of reports) {
    for (const u of r.units) {
      lines.push([
        r.project.name,
        r.project.clientName,
        u.key === null ? "" : by === "branch" ? u.key : u.items.map(formatWorkItem).join(" "),
        u.key === null ? c.no : c.yes,
        u.branches.join(" "),
        u.items.map(formatWorkItem).join(" "),
        u.prs.map(formatWorkItem).join(" "),
        u.basis.join(" "),
        (u.seconds / 3600).toFixed(4),
        (u.consumption.microUsd / 1_000_000).toFixed(4),
        u.real ? (u.real.amount / 10 ** MINOR_UNIT_DIGITS[u.real.currency]).toFixed(MINOR_UNIT_DIGITS[u.real.currency]) : "",
        u.real?.currency ?? "",
        u.realPartial ? c.yes : c.no,
        u.unpricedAgents ? c.yes : c.no,
      ]);
    }
  }
  return rows(lines);
}

/**
 * `estela ai-cost --undelivered --csv`: una fila por bloque y por rama. La
 * columna "cuenta" dice si suma al gasto sin entrega: las ramas abiertas o de
 * estado desconocido se listan, pero no cuentan.
 */
export function undeliveredToCsv(
  reports: readonly UndeliveredReport[], projects: ReadonlyMap<string, SpendProject>,
): string {
  const c = COLUMNS[getLang()];
  const lines: unknown[][] = [[...c.undelivered]];
  const amount = (s: Spend) => s.real
    ? (s.real.amount / 10 ** MINOR_UNIT_DIGITS[s.real.currency]).toFixed(MINOR_UNIT_DIGITS[s.real.currency]) : "";
  for (const r of reports) {
    const p = projects.get(r.projectId);
    const push = (block: string, detail: string, counts: boolean, idle: number | null, s: Spend) => lines.push([
      p?.name ?? r.projectId, p?.clientName ?? "", block, detail, counts ? c.yes : c.no, idle ?? "",
      (s.consumption.microUsd / 1_000_000).toFixed(4), amount(s), s.real?.currency ?? "",
      s.realPartial ? c.yes : c.no, shareOf(s, r.total)?.toFixed(2) ?? "",
    ]);
    push(c.blocks.total, "", false, null, r.total);
    push(c.blocks.sessions, String(r.sessionsWithoutCommit.count), true, null, r.sessionsWithoutCommit);
    push(c.blocks.later, String(r.sessionsWithoutCommit.laterCommitted.count), false, null, r.sessionsWithoutCommit.laterCommitted);
    push(c.blocks.unverifiable, String(r.unverifiable.count), false, null, r.unverifiable);
    for (const b of r.unmerged.branches) push(c.blocks.unmerged, b.branch, true, b.idleDays, b);
    for (const b of r.notCounted) push(b.state === "open" ? c.blocks.open : c.blocks.unknown, b.branch, false, b.idleDays, b);
    push(c.blocks.undelivered, "", false, null, r.undelivered);
  }
  return rows(lines);
}

export { formatMoney };
