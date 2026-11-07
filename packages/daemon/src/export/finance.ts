import type { Currency, Money } from "@estela/shared";
import { formatAiCost, formatDuration, formatMoney, MINOR_UNIT_DIGITS } from "@estela/shared";

import type { Cost } from "../delivery/report.js";
import { getLang, tr } from "../i18n/index.js";

/**
 * El informe para finanzas: el gasto de IA de un periodo contado para alguien
 * que no programa.
 *
 * Los titulares hablan de dinero pagado, clientes y entregas; "tokens",
 * "sesiones" y "precio de API" solo aparecen al final, en cómo se calcula.
 * Junta lo que ya calculan los demás informes (ai-cost --by, --undelivered,
 * delivery) sin calcular nada nuevo: aquí solo se ordena y se escribe.
 */

export interface FinanceProject {
  readonly id: string;
  readonly name: string;
  readonly cost: Cost;
}

export interface FinanceClient {
  readonly id: string;
  readonly name: string;
  readonly cost: Cost;
  readonly projects: readonly FinanceProject[];
}

export interface FinanceDelivery {
  readonly label: string;
  readonly cost: Cost;
}

export interface FinanceDeliveries {
  readonly projectName: string;
  readonly clientName: string;
  /** "github"/"gitlab": lo leído del gestor con `estela delivery`; "git": solo merges y squash. */
  readonly source: "github" | "gitlab" | "git";
  readonly fetchedAt: Date | null;
  readonly delivered: readonly FinanceDelivery[];
  readonly plan: { readonly label: string; readonly delivered: number; readonly total: number;
                   readonly pending: Cost; readonly unplanned: Cost } | null;
  readonly requests: readonly { readonly name: string; readonly mapped: boolean; readonly cost: Cost }[] | null;
  readonly requestsRest: Cost | null;
}

export interface FinanceUndelivered {
  readonly projectName: string;
  readonly total: Cost;
  readonly undelivered: Cost;
  readonly withoutCommit: Cost;
  readonly unmergedBranches: Cost;
  readonly unmergedCount: number;
}

export interface FinanceSummary {
  readonly from: string;
  readonly to: string;
  /** La moneda de la cuota; `null` sin suscripción registrada (todo va a precio de API). */
  readonly currency: Currency | null;
  /** Todo el gasto de la máquina en el periodo, con o sin proyecto. */
  readonly paid: Cost;
  readonly unassigned: Cost;
  readonly clients: readonly FinanceClient[];
  readonly deliveries: readonly FinanceDeliveries[];
  readonly undelivered: readonly FinanceUndelivered[];
  readonly staleDays: number;
  /** Hubo trabajo con Copilot, cuyo coste no se conoce. */
  readonly unpricedAgents: boolean;
}

// ---------------------------------------------------------------------------

/** El importe que encabeza: lo pagado si hay cuota; si no, el valor a precio de API. */
function amount(c: Cost, s: FinanceSummary): string {
  if (!s.currency) return formatAiCost(c.consumption);
  return (c.real ? formatMoney(c.real) : formatMoney({ amount: 0, currency: s.currency })) + (c.realPartial ? "†" : "");
}

function pct(part: Cost, total: Cost, s: FinanceSummary): string {
  const p = s.currency ? part.real?.amount ?? 0 : part.consumption.microUsd;
  const t = s.currency ? total.real?.amount ?? 0 : total.consumption.microUsd;
  return t === 0 ? "—" : `${((p / t) * 100).toFixed(1)} %`;
}

const hours = (c: Cost) => (c.seconds ? formatDuration(c.seconds) : "—");

/** "octubre de 2026" si el periodo es un mes entero; si no, las dos fechas. */
export function periodName(from: string, to: string): string {
  const month = from.slice(0, 7);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  if (from === `${month}-01` && (to === `${month}-${last}` || to === `${month}-31`)) {
    const locale = getLang() === "en" ? "en-GB" : "es-ES";
    return new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  }
  return `${from} → ${to}`;
}

/** Una celda de tabla Markdown: sin barras ni saltos que la rompan. */
const md = (text: string) => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

export function financeToMarkdown(s: FinanceSummary): string {
  const out: string[] = [];
  const projectsCount = s.clients.reduce((n, c) => n + c.projects.length, 0);
  const undelivered = s.undelivered.reduce((acc, u) => sum(acc, u.undelivered), zero());
  const projectsSpend = s.undelivered.reduce((acc, u) => sum(acc, u.total), zero());
  const assigned = s.clients.reduce((acc, c) => sum(acc, c.cost), zero());

  out.push(tr`# Gasto en IA · ${periodName(s.from, s.to)}`, "");
  out.push(tr`## Resumen`, "");
  out.push(s.currency
    ? tr`- **Pagado en IA:** ${amount(s.paid, s)}, la cuota de las herramientas de IA repartida según su uso.`
    : tr`- **Gasto en IA:** ${formatAiCost(s.paid.consumption)} a precio de lista. No hay cuota registrada, así que es una estimación, no lo pagado.`);
  const proyectos = projectsCount === 1 ? tr`1 proyecto` : tr`${projectsCount} proyectos`;
  const clientes = s.clients.length === 1 ? tr`1 cliente` : tr`${s.clients.length} clientes`;
  out.push(tr`- **Horas de trabajo con IA:** ${hours(assigned)} en ${proyectos} de ${clientes}.`);
  if (s.unassigned.consumption.microUsd > 0) {
    out.push(tr`- **Fuera de proyectos:** ${amount(s.unassigned, s)} (${pct(s.unassigned, s.paid, s)}) en trabajo que no es de ningún proyecto registrado.`);
  }
  if (projectsSpend.consumption.microUsd > 0) {
    out.push(tr`- **Sin entregar todavía:** ${pctApi(undelivered, projectsSpend)} del gasto en proyectos. Es una señal para revisar, no un juicio: explorar y descartar también es trabajo.`);
  }
  out.push("");

  out.push(tr`## Por cliente`, "");
  out.push(tr`| Cliente | Proyecto | Horas | Gasto | % del total |`, "|---|---|---:|---:|---:|");
  for (const c of s.clients) {
    for (const p of c.projects) {
      out.push(`| ${md(c.name)} | ${md(p.name)} | ${hours(p.cost)} | ${amount(p.cost, s)} | ${pct(p.cost, s.paid, s)} |`);
    }
    if (c.projects.length > 1) {
      out.push(tr`| **${md(c.name)}** | **total** | **${hours(c.cost)}** | **${amount(c.cost, s)}** | **${pct(c.cost, s.paid, s)}** |`);
    }
  }
  if (s.unassigned.consumption.microUsd > 0) {
    out.push(tr`| Fuera de proyectos | — | — | ${amount(s.unassigned, s)} | ${pct(s.unassigned, s.paid, s)} |`);
  }
  out.push(tr`| **Total** | | **${hours(assigned)}** | **${amount(s.paid, s)}** | **100 %** |`, "");

  const conEntregas = s.deliveries.filter((d) => d.delivered.length || d.plan);
  if (conEntregas.length) {
    out.push(tr`## Qué se entregó`, "");
    for (const d of conEntregas) {
      out.push(`### ${md(d.projectName)} · ${md(d.clientName)}`, "");
      if (d.plan) {
        out.push(tr`Del plan (${d.plan.label}) se entregaron ${d.plan.delivered} de ${d.plan.total}. Lo pendiente lleva ${amount(d.plan.pending, s)} de gasto; lo entregado fuera del plan, ${amount(d.plan.unplanned, s)}.`, "");
      }
      if (d.delivered.length) {
        out.push(tr`| Entrega | Horas | Gasto |`, "|---|---:|---:|");
        for (const l of d.delivered.slice(0, 15)) out.push(`| ${md(l.label)} | ${hours(l.cost)} | ${amount(l.cost, s)} |`);
        if (d.delivered.length > 15) out.push(tr`| … y ${d.delivered.length - 15} más | | |`);
        out.push("");
      }
      out.push(d.source !== "git"
        ? tr`_Fuente: ${d.source === "gitlab" ? "GitLab" : "GitHub"}, leído el ${d.fetchedAt ? d.fetchedAt.toISOString().slice(0, 10) : "—"} con estela delivery._`
        : tr`_Fuente: el historial de git (PR fusionados). Sin GitHub ni GitLab no se sabe qué estaba planificado._`, "");
    }
  }

  const conPeticiones = s.deliveries.filter((d) => d.requests?.length);
  if (conPeticiones.length) {
    out.push(tr`## Trabajo pedido por clientes`, "");
    out.push(tr`Qué parte del gasto fue a peticiones concretas de un cliente. No incluye ingresos ni contratos: Estela no los conoce.`, "");
    out.push(tr`| Proyecto | Quién lo pidió | Horas | Gasto |`, "|---|---|---:|---:|");
    for (const d of conPeticiones) {
      for (const r of d.requests!) {
        out.push(`| ${md(d.projectName)} | ${md(r.mapped ? r.name : tr`${r.name} (sin identificar)`)} | ${hours(r.cost)} | ${amount(r.cost, s)} |`);
      }
      if (d.requestsRest) out.push(tr`| ${md(d.projectName)} | sin petición de cliente | ${hours(d.requestsRest)} | ${amount(d.requestsRest, s)} |`);
    }
    out.push("");
  }

  if (s.undelivered.length) {
    out.push(tr`## Gasto que no ha llegado a entregarse`, "");
    out.push(tr`Trabajo que todavía no está en la versión principal del producto. Es una señal para revisar, no un juicio: explorar, probar y descartar también es trabajo, y parte llegará más adelante.`, "");
    out.push(tr`| Proyecto | Sin entregar | % del proyecto | Trabajo sin consolidar | Líneas de trabajo paradas |`, "|---|---:|---:|---:|---:|");
    for (const u of s.undelivered) {
      out.push(`| ${md(u.projectName)} | ${amount(u.undelivered, s)} | ${pctApi(u.undelivered, u.total)} | ${amount(u.withoutCommit, s)} | ${amount(u.unmergedBranches, s)} (${u.unmergedCount}) |`);
    }
    out.push("");
  }

  out.push(tr`## Cómo se calcula`, "");
  out.push(tr`- Las herramientas de IA (Claude Code, Codex, Copilot) dejan en el ordenador un registro de cada conversación. Estela lo lee junto con git, sin enviar nada fuera.`);
  out.push(s.currency
    ? tr`- **Gasto:** la cuota mensual de las suscripciones registradas, repartida según el uso (tokens a precio de lista) de cada proyecto ese mes. El precio de lista sirve solo para repartir: con cuota fija no es lo que se paga.`
    : tr`- **Gasto:** tokens a precio de lista de cada modelo. Si se paga una cuota fija, el gasto real es la cuota: regístrala con estela subscription add.`);
  out.push(tr`- **Valor de uso a precio de lista:** ${formatAiCost(s.paid.consumption)} en todo el periodo.`);
  out.push(tr`- **Horas:** el tiempo entre mensajes de cada sesión de trabajo, sin contar pausas de más de 30 minutos. Dos tareas a la vez se reparten el mismo rato.`);
  out.push(tr`- **Entregas:** las horas se unen a una issue o un PR (una MR en GitLab) por la rama del PR y por su número en ramas o commits. Lo que no se une a nada no se reparte.`);
  out.push(tr`- **Sin entregar:** sesiones sin ningún commit y ramas sin fusionar tras ${s.staleDays} días. Lo que no se puede saber (una rama borrada que pudo fusionarse con squash) no cuenta.`);
  if (s.unpricedAgents) out.push(tr`- Copilot no registra tokens: sus horas cuentan, pero su coste no se conoce y no está sumado.`);
  if (s.paid.realPartial) out.push(tr`- † Algún mes no tenía cuota registrada: el importe solo cuenta los meses con cuota.`);
  return out.join("\n") + "\n";
}

const pctApi = (part: Cost, total: Cost) => total.consumption.microUsd === 0 ? "—"
  : `${((part.consumption.microUsd / total.consumption.microUsd) * 100).toFixed(1)} %`;

function zero(): Cost { return { seconds: 0, consumption: { microUsd: 0 }, real: null, realPartial: false }; }

/** Suma dos costes. El importe real se suma solo si los dos están en la misma moneda. */
export function sum(a: Cost, b: Cost): Cost {
  let real: Money | null = a.real ?? b.real;
  if (a.real && b.real && a.real.currency === b.real.currency) real = { amount: a.real.amount + b.real.amount, currency: a.real.currency };
  return { seconds: a.seconds + b.seconds, consumption: { microUsd: a.consumption.microUsd + b.consumption.microUsd },
           real, realPartial: a.realPartial || b.realPartial };
}

// ---------------------------------------------------------------------------

const CSV = {
  es: { header: ["seccion", "cliente", "proyecto", "concepto", "horas", "gasto", "moneda", "valor_uso_usd_precio_lista", "pct"],
        summary: "resumen", client: "cliente", delivery: "entrega", request: "peticion", undelivered: "sin_entrega",
        paid: "pagado", unassigned: "fuera_de_proyectos", project: "proyecto", rest: "sin_peticion", total: "sin_entregar" },
  en: { header: ["section", "client", "project", "item", "hours", "spend", "currency", "usage_value_usd_list_price", "pct"],
        summary: "summary", client: "client", delivery: "delivery", request: "request", undelivered: "undelivered",
        paid: "paid", unassigned: "outside_projects", project: "project", rest: "no_request", total: "undelivered" },
} as const;

/** Una fila por cifra, con la sección delante: se filtra en una hoja de cálculo. */
export function financeToCsv(s: FinanceSummary): string {
  const c = CSV[getLang()];
  const cell = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const money = (x: Cost) => {
    if (!s.currency) return ["", ""];
    const m = x.real ?? { amount: 0, currency: s.currency };
    const d = MINOR_UNIT_DIGITS[m.currency];
    return [(m.amount / 10 ** d).toFixed(d), m.currency];
  };
  const pctOf = (part: Cost, total: Cost) => {
    const p = s.currency ? part.real?.amount ?? 0 : part.consumption.microUsd;
    const t = s.currency ? total.real?.amount ?? 0 : total.consumption.microUsd;
    return t === 0 ? "" : ((p / t) * 100).toFixed(2);
  };
  const rows: unknown[][] = [[...c.header]];
  const row = (section: string, client: string, project: string, item: string, x: Cost, p: string) =>
    rows.push([section, client, project, item, (x.seconds / 3600).toFixed(4), ...money(x),
               (x.consumption.microUsd / 1_000_000).toFixed(4), p]);

  row(c.summary, "", "", c.paid, s.paid, "100.00");
  row(c.summary, "", "", c.unassigned, s.unassigned, pctOf(s.unassigned, s.paid));
  for (const cl of s.clients) for (const p of cl.projects) row(c.client, cl.name, p.name, c.project, p.cost, pctOf(p.cost, s.paid));
  for (const d of s.deliveries) {
    for (const l of d.delivered) row(c.delivery, d.clientName, d.projectName, l.label, l.cost, "");
    for (const r of d.requests ?? []) row(c.request, d.clientName, d.projectName, r.name, r.cost, "");
    if (d.requests?.length && d.requestsRest) row(c.request, d.clientName, d.projectName, c.rest, d.requestsRest, "");
  }
  for (const u of s.undelivered) row(c.undelivered, "", u.projectName, c.total, u.undelivered, pctApi(u.undelivered, u.total).replace(" %", ""));
  // BOM para que Excel abra los acentos y el euro sin destrozarlos.
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function financeToJson(s: FinanceSummary): unknown {
  const cost = (x: Cost) => ({ seconds: x.seconds, apiMicroUsd: x.consumption.microUsd,
    real: x.real ? { amountMinor: x.real.amount, currency: x.real.currency } : null, realPartial: x.realPartial });
  return {
    period: { from: s.from, to: s.to }, currency: s.currency, staleDays: s.staleDays, unpricedAgents: s.unpricedAgents,
    paid: cost(s.paid), unassigned: cost(s.unassigned),
    clients: s.clients.map((c) => ({ id: c.id, name: c.name, ...cost(c.cost),
      projects: c.projects.map((p) => ({ id: p.id, name: p.name, ...cost(p.cost) })) })),
    deliveries: s.deliveries.map((d) => ({
      project: d.projectName, client: d.clientName, source: d.source, fetchedAt: d.fetchedAt?.toISOString() ?? null,
      delivered: d.delivered.map((l) => ({ label: l.label, ...cost(l.cost) })),
      plan: d.plan ? { ...d.plan, pending: cost(d.plan.pending), unplanned: cost(d.plan.unplanned) } : null,
      requests: d.requests?.map((r) => ({ name: r.name, mapped: r.mapped, ...cost(r.cost) })) ?? null,
      requestsRest: d.requestsRest ? cost(d.requestsRest) : null,
    })),
    undelivered: s.undelivered.map((u) => ({ project: u.projectName, total: cost(u.total), undelivered: cost(u.undelivered),
      withoutCommit: cost(u.withoutCommit), unmergedBranches: cost(u.unmergedBranches), unmergedCount: u.unmergedCount })),
  };
}
