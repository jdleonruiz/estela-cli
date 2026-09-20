import type { AiPayer, Client, Project, TimeEntry } from "@estela/shared";
import { formatDuration, formatMoney, localDate, type Money } from "@estela/shared";
import { localizeDescription } from "../billing/localize.js";
import { getLang, moneyLocale, tr } from "../i18n/index.js";
import { longDate } from "./dates.js";

/**
 * Informe compartible: un único fichero HTML, autónomo.
 *
 * Se manda por correo y se abre sin instalar nada, sin cuenta y sin depender de
 * que la máquina de quien lo genera esté encendida. Esa independencia es el
 * punto: un enlace que apunta al portátil de un freelance está caído la mitad
 * del tiempo, y justo cuando quieres causar buena impresión.
 *
 * Lo que contiene y lo que no:
 *
 *  - Siempre: horas, fechas, descripciones y commits. Es el respaldo del
 *    trabajo, que es lo que el cliente necesita para dar el visto bueno.
 *  - Opcional: el valor económico. Algunos lo adjuntan a su factura y otros no.
 *  - Nunca, cuando la IA la pagas tú: consumo y coste de IA. No es una casilla
 *    desactivada por defecto — el dato no llega hasta aquí. Ver `AiPayer`.
 */

export interface ShareOptions {
  readonly project: Project;
  readonly client: Client;
  readonly entries: readonly TimeEntry[];
  readonly from: string;
  readonly to: string;
  /** Autor del informe. Aparece en la cabecera. */
  readonly authorName?: string;
  /** Incluir tarifa e importes. Fuera por defecto. */
  readonly withAmounts?: boolean;
  /** Función de tarifa vigente. Solo se usa si `withAmounts`. */
  readonly rateAt?: (at: Date) => Money | null;
  /**
   * Quién paga la IA de este proyecto. Con "self" el consumo no se incluye,
   * y no hay opción para incluirlo.
   */
  readonly aiPayer?: AiPayer;
  readonly commitsOf?: (hashes: readonly string[]) => readonly { hash: string; subject: string }[];
}

interface DayGroup {
  readonly date: string;
  readonly entries: readonly TimeEntry[];
  readonly seconds: number;
}

export function buildShareReport(options: ShareOptions): string {
  const { project, client, entries, from, to } = options;

  const included = entries
    .filter((e) => e.billable)
    .filter((e) => {
      const day = localDate(e.startedAt);
      return day >= from && day <= to;
    })
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const days = groupByDay(included);
  const totalSeconds = included.reduce((s, e) => s + e.seconds, 0);

  const showAmounts = options.withAmounts === true && options.rateAt !== undefined;
  let totalAmount: Money | null = null;
  if (showAmounts) {
    let minor = 0;
    let currency = client.currency;
    for (const entry of included) {
      const rate = options.rateAt!(entry.startedAt);
      if (rate) { minor += Math.round((rate.amount * entry.seconds) / 3600); currency = rate.currency; }
    }
    totalAmount = { amount: minor, currency };
  }

  const rows = days.map((day) => renderDay(day, options, showAmounts)).join("\n");

  return page({
    title: `${project.name} — ${from} al ${to}`,
    project, client, from, to, totalSeconds, totalAmount,
    dayCount: days.length,
    blockCount: included.length,
    authorName: options.authorName ?? null,
    body: included.length
      ? rows
      : `<p class="empty">${tr`No hay trabajo registrado en este periodo.`}</p>`,
  });
}

function groupByDay(entries: readonly TimeEntry[]): DayGroup[] {
  const map = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const day = localDate(entry.startedAt);
    const bucket = map.get(day);
    if (bucket) bucket.push(entry);
    else map.set(day, [entry]);
  }
  return [...map.entries()]
    .map(([date, list]) => ({
      date, entries: list,
      seconds: list.reduce((s, e) => s + e.seconds, 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function renderDay(day: DayGroup, options: ShareOptions, showAmounts: boolean): string {
  const items = day.entries.map((entry) => {
    const commits = options.commitsOf?.(entry.commitHashes) ?? [];
    const commitHtml = commits.length
      ? `<ul class="commits">${commits.map((c) =>
          `<li><code>${esc(c.hash.slice(0, 7))}</code> ${esc(c.subject)}</li>`).join("")}</ul>`
      : "";

    let amount = "";
    if (showAmounts) {
      const rate = options.rateAt!(entry.startedAt);
      if (rate) {
        amount = `<td class="amount">${esc(formatMoney({
          amount: Math.round((rate.amount * entry.seconds) / 3600), currency: rate.currency,
        }, moneyLocale(getLang())))}</td>`;
      } else amount = `<td class="amount">—</td>`;
    }

    return `<tr>
  <td class="task"><span class="desc">${esc(localizeDescription(entry))}</span>${commitHtml}</td>
  <td class="time">${esc(formatDuration(entry.seconds))}</td>
  ${amount}
</tr>`;
  }).join("\n");

  return `<section class="day">
  <h3>${esc(longDate(day.date, getLang()))} <span class="day-total">${esc(formatDuration(day.seconds))}</span></h3>
  <table>${items}</table>
</section>`;
}

interface PageData {
  title: string; project: Project; client: Client;
  from: string; to: string; totalSeconds: number;
  totalAmount: Money | null; dayCount: number; blockCount: number;
  authorName: string | null; body: string;
}

function page(d: PageData): string {
  const amountBlock = d.totalAmount
    ? `<div class="kpi"><span class="kpi-v">${esc(formatMoney(d.totalAmount, moneyLocale(getLang())))}</span>
         <span class="kpi-l">${tr`valor del trabajo`}</span></div>`
    : "";

  return `<!doctype html>
<html lang="${getLang()}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)}</title>
<style>
:root{--paper:#fff;--ink:#191d1b;--ink-2:#555d58;--ink-3:#8a938d;--line:#e3e5df;
      --jade:#0a5f52;--jade-bg:#e8f2ef;--radius:10px}
@media(prefers-color-scheme:dark){:root{--paper:#101312;--ink:#e9eeeb;--ink-2:#a6b1ab;
      --ink-3:#78837d;--line:#2a322f;--jade:#5fcfb6;--jade-bg:#10322c}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
     font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
     -webkit-font-smoothing:antialiased}
.wrap{max-width:720px;margin:0 auto;padding:48px 24px 64px}
h1{font-size:1.5rem;font-weight:650;letter-spacing:-.02em;margin:0 0 6px}
.meta{color:var(--ink-3);font-size:.92rem}
.kpis{display:flex;gap:10px;margin:28px 0 36px;flex-wrap:wrap}
.kpi{flex:1;min-width:130px;background:var(--jade-bg);border-radius:var(--radius);padding:16px 18px}
.kpi-v{display:block;font-size:1.6rem;font-weight:640;letter-spacing:-.03em;color:var(--jade);
       font-variant-numeric:tabular-nums}
.kpi-l{display:block;font-size:.82rem;color:var(--jade);opacity:.85;margin-top:3px}
.day{margin-bottom:30px}
.day h3{font-size:.82rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
        color:var(--ink-3);margin:0 0 8px;display:flex;justify-content:space-between;
        border-bottom:1px solid var(--line);padding-bottom:7px}
.day-total{font-variant-numeric:tabular-nums;color:var(--ink-2)}
table{width:100%;border-collapse:collapse}
td{padding:11px 0;vertical-align:top;border-bottom:1px solid var(--line)}
tr:last-child td{border-bottom:0}
.desc{font-weight:550}
.time{text-align:right;white-space:nowrap;width:80px;font-variant-numeric:tabular-nums;
      padding-left:16px;font-weight:550}
.amount{text-align:right;white-space:nowrap;width:92px;padding-left:16px;
        font-variant-numeric:tabular-nums;color:var(--jade);font-weight:600}
.commits{list-style:none;margin:7px 0 0;padding:0;display:flex;flex-direction:column;gap:4px}
.commits li{font-size:.85rem;color:var(--ink-2)}
.commits code{font-family:ui-monospace,Menlo,monospace;font-size:.78rem;color:var(--jade);
              background:var(--jade-bg);padding:1px 5px;border-radius:4px;margin-right:6px}
.empty{color:var(--ink-3);text-align:center;padding:48px 0}
footer{margin-top:44px;padding-top:20px;border-top:1px solid var(--line);
       font-size:.82rem;color:var(--ink-3);line-height:1.6}
footer a{color:var(--jade)}
@media print{
  body{background:#fff;color:#000}
  .wrap{padding:0;max-width:none}
  .day{break-inside:avoid}
  footer{break-before:avoid}
}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${esc(d.project.name)}</h1>
    <p class="meta">${d.authorName
      ? tr`Informe de horas de ${esc(d.authorName)} para ${esc(d.client.name)}`
      : tr`Informe de horas para ${esc(d.client.name)}`} · ${tr`${esc(d.from)} al ${esc(d.to)}`}</p>
  </header>

  <div class="kpis">
    <div class="kpi"><span class="kpi-v">${esc(formatDuration(d.totalSeconds))}</span>
      <span class="kpi-l">${tr`horas trabajadas`}</span></div>
    <div class="kpi"><span class="kpi-v">${d.dayCount}</span>
      <span class="kpi-l">${d.dayCount === 1 ? tr`día con actividad` : tr`días con actividad`}</span></div>
    ${amountBlock}
  </div>

  ${d.body}

  <footer>
    ${tr`Generado con Estela a partir de la actividad real de Git y del editor.`}
    ${tr`Cada bloque está respaldado por sus commits.`}<br>
    <a href="https://getestela.dev">getestela.dev</a>
  </footer>
</div>
</body>
</html>`;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
