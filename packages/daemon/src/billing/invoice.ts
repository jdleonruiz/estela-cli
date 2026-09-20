import type {
  AiCost, Client, Invoice, InvoiceLine, Money, Project, RatePeriod, TimeEntry,
} from "@estela/shared";
import {
  aiCostToMoney, addMoney, billableAmount, formatAiCost, formatDuration,
  formatMoney, money, roundSeconds, sumAiCost, sumMoney,
} from "@estela/shared";
import { tr } from "../i18n/index.js";
import { localizeDescription } from "./localize.js";

/**
 * Emisión de facturas.
 *
 * Tres reglas que no se negocian, porque son las que hacen que una factura de
 * hace seis meses siga cuadrando hoy:
 *
 *  1. La tarifa se busca por la fecha del trabajo, no por la de hoy. Si subes
 *     el precio a mitad de proyecto, lo ya trabajado mantiene el suyo.
 *  2. El tipo de cambio se captura al emitir y se guarda en la factura. Jamás
 *     se recalcula con el del día.
 *  3. El coste de IA está en USD porque es la moneda en la que factura el
 *     proveedor. Nunca se suma a un importe en otra moneda sin un tipo
 *     explícito.
 */

export interface IssueInvoiceInput {
  readonly client: Client;
  readonly project: Project;
  readonly rates: readonly RatePeriod[];
  readonly entries: readonly TimeEntry[];
  /** Fecha de corte, inclusive. Se factura todo lo anterior o igual. */
  readonly cutoffAt: Date;
  readonly number: string;
  readonly issuedAt?: Date;
  /**
   * Unidades de la moneda del cliente por 1 USD. Obligatorio solo cuando el
   * proyecto repercute el coste de IA y la moneda no es USD.
   */
  readonly usdFxRate?: number;
  /**
   * Parte de la cuota de suscripción que le toca a este periodo. Se calcula
   * fuera y se guarda tal cual: es un valor derivado que cambia cuando entran
   * más datos, así que el informe tiene que quedarse con el de su día.
   */
  readonly aiAmortized?: Money;
  readonly notes?: string;
}

export class InvoiceError extends Error {}

export function issueInvoice(input: IssueInvoiceInput): Invoice {
  const { client, project, rates, cutoffAt } = input;
  const issuedAt = input.issuedAt ?? new Date();

  const pending = input.entries
    .filter((e) => e.projectId === project.id)
    .filter((e) => e.billable && e.invoiceId === null)
    .filter((e) => e.endedAt <= cutoffAt)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  if (pending.length === 0) {
    throw new InvoiceError(
      tr`No hay horas pendientes de facturar en "${project.name}" hasta ${cutoffAt.toISOString().slice(0, 10)}.`);
  }

  const lines: InvoiceLine[] = [];
  let totalSeconds = 0;

  for (const entry of pending) {
    const rate = rateAt(rates, project.id, entry.startedAt);
    if (!rate) {
      throw new InvoiceError(
        tr`Sin tarifa vigente para "${project.name}" el ${entry.startedAt.toISOString().slice(0, 10)}. ` +
        tr`Define una con: estela rate set --project ${project.id} --rate <importe> --currency ${client.currency}`);
    }
    if (rate.currency !== client.currency) {
      throw new InvoiceError(
        tr`La tarifa de "${project.name}" está en ${rate.currency} pero a ${client.name} se le factura en ` +
        tr`${client.currency}. Corrige la tarifa o la moneda del cliente: no se convierte automáticamente.`);
    }

    const seconds = roundSeconds(entry.seconds, project.roundingMinutes);
    if (seconds === 0) continue;

    totalSeconds += seconds;
    lines.push({
      description: localizeDescription(entry),
      seconds,
      hourlyRate: rate,
      amount: billableAmount(seconds, rate),
    });
  }

  if (lines.length === 0) {
    throw new InvoiceError(
      tr`Todas las entradas quedaron en cero tras redondear a ${project.roundingMinutes} min.`);
  }

  const subtotal = sumMoney(lines.map((l) => l.amount), client.currency);
  const aiCost: AiCost = sumAiCost(pending.map((e) => e.aiCost));

  let aiCostBilled: Money | null = null;
  let usdFxRate: number | null = null;

  if (project.aiCostPolicy === "passthrough" && aiCost.microUsd > 0) {
    if (client.currency === "USD") {
      usdFxRate = 1;
    } else if (input.usdFxRate === undefined) {
      throw new InvoiceError(
        tr`"${project.name}" repercute el coste de IA (${formatAiCost(aiCost)} USD) y se factura en ` +
        tr`${client.currency}. Indica el tipo de cambio del día con --fx <USD->${client.currency}>.`);
    } else {
      usdFxRate = input.usdFxRate;
    }
    aiCostBilled = aiCostToMoney(aiCost, client.currency, usdFxRate);
  }

  const total = aiCostBilled ? addMoney(subtotal, aiCostBilled) : subtotal;

  return {
    id: `inv_${input.number}`,
    number: input.number,
    clientId: client.id,
    projectId: project.id,
    issuedAt,
    cutoffAt,
    periodStart: pending[0]!.startedAt,
    currency: client.currency,
    lines,
    subtotal,
    total,
    totalSeconds,
    aiCost,
    usdFxRate,
    aiCostBilled,
    aiAmortized: input.aiAmortized ?? null,
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
  };
}

/** Tarifa vigente en una fecha. Las tarifas se apilan, no se sobrescriben. */
export function rateAt(
  rates: readonly RatePeriod[],
  projectId: string,
  at: Date,
): Money | null {
  const applicable = rates
    .filter((r) => r.projectId === projectId)
    .filter((r) => r.effectiveFrom <= at && (r.effectiveTo === null || at < r.effectiveTo))
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

  return applicable[0]?.hourlyRate ?? null;
}

/** Renderiza la factura como texto plano para revisarla antes de enviarla. */
export function renderInvoice(invoice: Invoice, client: Client, project: Project): string {
  const out: string[] = [];
  const rule = "─".repeat(78);
  const date = (d: Date) => d.toISOString().slice(0, 10);

  out.push(rule);
  out.push(tr`INFORME DE HORAS ${invoice.number}`.padEnd(52) + tr`Emitido: ${date(invoice.issuedAt)}`);
  out.push(rule);
  out.push(tr`Cliente:   ${client.name}` + (client.taxId ? `  (${client.taxId})` : ""));
  out.push(tr`Proyecto:  ${project.name}`);
  out.push(tr`Periodo:   ${date(invoice.periodStart)}  ->  ${date(invoice.cutoffAt)}`);
  out.push("");
  out.push(tr`CONCEPTO`.padEnd(46) + tr`TIEMPO`.padStart(9) + tr`TARIFA`.padStart(11) + tr`IMPORTE`.padStart(12));
  out.push(rule);

  for (const line of invoice.lines) {
    const desc = line.description.length > 45 ? line.description.slice(0, 42) + "..." : line.description;
    out.push(
      desc.padEnd(46) +
      formatDuration(line.seconds).padStart(9) +
      `${formatMoney(line.hourlyRate)}/h`.padStart(11) +
      formatMoney(line.amount).padStart(12));
  }

  out.push(rule);
  out.push(
    tr`${invoice.lines.length} conceptos`.padEnd(46) +
    formatDuration(invoice.totalSeconds).padStart(9) +
    "".padStart(11) +
    formatMoney(invoice.subtotal).padStart(12));

  if (invoice.aiCostBilled) {
    out.push(
      tr`Coste de IA repercutido (1 USD = ${invoice.usdFxRate} ${invoice.currency})`.padEnd(66) +
      formatMoney(invoice.aiCostBilled).padStart(12));
  }

  out.push("");
  out.push(tr`VALOR DEL TRABAJO`.padEnd(66) + formatMoney(invoice.total).padStart(12));
  out.push(rule);

  if (project.aiCostPolicy === "absorbed" && invoice.aiCost.microUsd > 0) {
    out.push(tr`Interno (no facturado): IA del periodo ${formatAiCost(invoice.aiCost)} USD ` +
      tr`en tarifa API equivalente.`);
  }
  if (invoice.notes) out.push(invoice.notes);

  return out.join("\n");
}

/** Margen real del periodo: lo cobrado menos lo que costó la IA. */
export function marginOf(invoice: Invoice, usdFxRate: number): {
  revenue: Money; aiCost: Money; margin: Money; marginPct: number;
} {
  const revenue = invoice.subtotal;
  const cost = aiCostToMoney(invoice.aiCost, invoice.currency, usdFxRate);
  const margin = money(revenue.amount - cost.amount, invoice.currency);
  return {
    revenue,
    aiCost: cost,
    margin,
    marginPct: revenue.amount === 0 ? 0 : (margin.amount / revenue.amount) * 100,
  };
}
