import { tr } from "./i18n/index.js";
import type { Alternative, PlanAnalysis } from "./metrics/plan.js";
import {
  MULTIPLIER_SOURCE, PRICES_CHECKED_AT, PRICES_SOURCE, PRICES_STALE_DAYS, CLAUDE_PLANS, type ClaudePlan,
} from "./plan-prices.js";
import { compactDuration } from "./statusline.js";

/**
 * Lo que enseña `estela plan`: el texto (es/en) y el JSON.
 *
 * Aparte de cli.ts para poder comprobar cada frase: ninguna puede decir
 * cuánto te queda ni hablar de tokens. Lo que hay son los porcentajes que
 * mandó Claude Code y las equivalencias por el multiplicador publicado.
 */

export interface BlockCounts {
  readonly fiveHour: number;
  readonly sevenDay: number;
}

export interface ReportOptions {
  readonly color: boolean;
  readonly now: Date;
  /** Bloqueos 429 de los transcripts en el período, si se pudieron leer. */
  readonly blocks: BlockCounts | null;
}

const ESC = "\x1b[";
const JADE = `${ESC}38;2;70;192;167m`;   // #46C0A7, como en la status line
const AMBER = `${ESC}38;2;221;168;90m`;
const DIM = `${ESC}90m`;
const RESET = `${ESC}0m`;

const LABEL = 21;

export function renderPlanReport(a: PlanAnalysis, o: ReportOptions): string {
  const paint = (code: string, text: string) => (o.color ? `${code}${text}${RESET}` : text);
  const row = (label: string, value: string) => `${label.padEnd(LABEL)}${value}`;
  const out: string[] = [];

  out.push(header(a, paint));
  out.push("");

  const f = a.fiveHour;
  out.push(row(tr`Ventanas de 5 h`, f.windows.length === 0
    ? tr`ninguna completa todavía`
    : tr`${f.windows.length} ventanas · pico mediano ${pct(f.medianPeak!)} % · p90 ${pct(f.p90Peak!)} % · máximo ${pct(f.maxPeak!)} %`));
  out.push(row(tr`Topes (≥95 %)`, String(f.caps)));
  if (f.stoppedMs > 0) {
    out.push(row(tr`Parado tras topes`,
      tr`hasta ${compactDuration(f.stoppedMs / 1000)} (estimado: no sabemos si seguías trabajando)`));
  }
  const w = a.week;
  out.push(row(tr`Semana`, w.weeks.length === 0
    ? tr`sin datos de la semana`
    : tr`pico mediano ${pct(w.medianPeak!)} % · máximo ${pct(w.maxPeak!)} % · ${w.weeksAtOrAbove90} semanas ≥ 90 %`));
  if (o.blocks) {
    out.push(row(tr`Bloqueos (429)`,
      tr`${o.blocks.fiveHour} de 5 h · ${o.blocks.sevenDay} semanales, según los transcripts de Claude Code`));
  }

  if (f.windows.length > 0) {
    out.push("");
    out.push(tr`Si estuvieras en…`);
    for (const alt of [...a.alternatives].sort((x, y) => x.plan.monthlyUsd - y.plan.monthlyUsd)) {
      out.push(`  ${`${alt.plan.name} (${usd(alt.plan.monthlyUsd)})`.padEnd(LABEL - 2)}${alternativeText(alt, a)}`);
    }
  }

  out.push("");
  if (a.dataState === "insufficient") {
    out.push(paint(AMBER, tr`Datos de ${a.daysWithData} días. La recomendación necesita al menos 14.`));
  } else if (a.recommendation) {
    const label = a.dataState === "provisional"
      ? tr`Recomendación (provisional, ${a.daysWithData} días)`
      : tr`Recomendación`;
    const text = recommendationText(a);
    out.push(row(label, paint(a.recommendation.kind === "tight" ? AMBER : JADE, text)));
    const diff = priceDiffText(a);
    if (diff) out.push(row("", paint(DIM, diff)));
  }

  out.push("");
  out.push(tr`Límite semanal entre planes: Anthropic no publica la relación. No lo estimamos.`);
  out.push(tr`Basado en el multiplicador por sesión publicado por Anthropic:`);
  out.push(MULTIPLIER_SOURCE);
  out.push(tr`Anthropic puede cambiar los límites; repite el análisis cada mes.`);
  out.push(tr`Precios según la web de Anthropic a ${PRICES_CHECKED_AT}; compruébalo: ${PRICES_SOURCE}`);
  if (pricesStale(o.now)) out.push(paint(AMBER, tr`Esa fecha tiene más de ${PRICES_STALE_DAYS} días: los precios pueden estar desactualizados.`));
  return out.join("\n");
}

function header(a: PlanAnalysis, paint: (code: string, text: string) => string): string {
  return `${paint(JADE, "estela")} plan · ${a.plan.name} ${tr`(desde ${day(a.since)})`} · ${tr`${a.daysWithData} días con datos`}`;
}

function alternativeText(alt: Alternative, a: PlanAnalysis): string {
  const n = a.fiveHour.windows.length;
  if (alt.direction === "higher") {
    if (a.fiveHour.caps === 0) return tr`sin topes, igual que ahora`;
    return tr`p90 equivalente ${pct(alt.p90Equivalent)} % · habrías evitado ${alt.capsAvoided} de ${a.fiveHour.caps} topes (con el uso que llegó a registrarse)`;
  }
  return alt.blockedWindows === 0
    ? tr`p90 equivalente ${pct(alt.p90Equivalent)} % · no te habría bloqueado en ninguna de las ${n} ventanas`
    : tr`p90 equivalente ${pct(alt.p90Equivalent)} % · te habría bloqueado en ${alt.blockedWindows} de ${n} ventanas`;
}

export function recommendationText(a: PlanAnalysis): string {
  const r = a.recommendation;
  if (!r) return "";
  switch (r.kind) {
    case "tight":
      return r.higher && r.capsAvoided !== null
        ? tr`Vas justo con tu plan. Con ${r.higher.name} habrías evitado ${r.capsAvoided} de ${a.fiveHour.caps} topes.`
        : tr`Vas justo con tu plan.`;
    case "enough":
      return tr`Con los datos de estas ${r.weeks} semanas, el plan ${r.plan.name} te habría bastado en todas las ventanas de 5 h.`;
    case "almost":
      return tr`El plan ${r.plan.name} te habría bastado casi siempre: te habría bloqueado ${r.blocked} veces en estas semanas.`;
    case "fits":
      return tr`Tu plan actual encaja con tu uso.`;
  }
}

/** La diferencia de precio de lo que se recomienda, si es cambiar de plan. */
function priceDiffText(a: PlanAnalysis): string | null {
  const r = a.recommendation;
  const other = r?.kind === "enough" || r?.kind === "almost" ? r.plan
    : r?.kind === "tight" ? r.higher : null;
  if (!other) return null;
  const diff = other.monthlyUsd - a.plan.monthlyUsd;
  return diff < 0
    ? tr`${usd(-diff)} menos al mes, según la web de Anthropic a ${PRICES_CHECKED_AT}; compruébalo.`
    : tr`${usd(diff)} más al mes, según la web de Anthropic a ${PRICES_CHECKED_AT}; compruébalo.`;
}

export function pricesStale(now: Date): boolean {
  return now.getTime() - Date.parse(`${PRICES_CHECKED_AT}T00:00:00Z`) > PRICES_STALE_DAYS * 86_400_000;
}

/** Sin plan declarado: cómo declararlo. */
export function renderNoPlan(): string {
  return [
    tr`estela plan compara tu uso real de Claude con los otros planes. Primero dime cuál pagas:`,
    "",
    "  estela plan set pro",
    "  estela plan set max5",
    "  estela plan set max20",
    "",
    tr`Si ya lo tenías antes de hoy, añade desde cuándo: --since AAAA-MM-DD`,
  ].join("\n");
}

export function renderNoData(a: PlanAnalysis, apiKey: boolean, color: boolean): string {
  const paint = (code: string, text: string) => (color ? `${code}${text}${RESET}` : text);
  return [
    header(a, paint), "",
    apiKey
      ? tr`Este análisis solo funciona con planes Pro o Max.`
      : tr`Aún no hay datos. Instala la status line (estela statusline install) y vuelve en unos días.`,
    ...(apiKey ? [] : [tr`Solo se recogen en Claude Code en la terminal: la extensión de VS Code no ejecuta la status line.`]),
  ].join("\n");
}

// ---------------------------------------------------------------------------

/**
 * `estela plan --json`. Estructura estable (documentada en el README):
 * campos nuevos se pueden añadir, ninguno cambia de nombre ni de significado.
 */
export function planToJson(a: PlanAnalysis, o: { readonly blocks: BlockCounts | null; readonly now: Date }) {
  const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
  const rec = a.recommendation;
  return {
    version: 1,
    plan: { id: a.plan.id, name: a.plan.name, since: a.since.toISOString(), sessionMultiplier: a.plan.sessionMultiplier },
    period: { from: a.from.toISOString(), to: a.to.toISOString(), days: a.days, daysWithData: a.daysWithData, samples: a.samples },
    dataState: a.dataState,
    fiveHour: {
      windows: a.fiveHour.windows.length,
      medianPeak: r1(a.fiveHour.medianPeak), p90Peak: r1(a.fiveHour.p90Peak), maxPeak: r1(a.fiveHour.maxPeak),
      caps: a.fiveHour.caps,
      stoppedMinutesUpperBound: Math.round(a.fiveHour.stoppedMs / 60_000),
    },
    week: {
      weeks: a.week.weeks.length,
      medianPeak: r1(a.week.medianPeak), maxPeak: r1(a.week.maxPeak),
      weeksAtOrAbove90: a.week.weeksAtOrAbove90,
    },
    blocks429: o.blocks,
    alternatives: [...a.alternatives].sort((x, y) => x.plan.monthlyUsd - y.plan.monthlyUsd).map((x) => ({
      plan: x.plan.id, name: x.plan.name, direction: x.direction,
      monthlyUsd: x.plan.monthlyUsd, monthlyDiffUsd: x.plan.monthlyUsd - a.plan.monthlyUsd,
      p90Equivalent: r1(x.p90Equivalent), maxEquivalent: r1(x.maxEquivalent),
      blockedWindows: x.blockedWindows, capsAvoided: x.capsAvoided,
    })),
    recommendation: rec === null ? null : {
      kind: rec.kind,
      provisional: a.dataState === "provisional",
      plan: rec.kind === "enough" || rec.kind === "almost" ? rec.plan.id : rec.kind === "tight" ? rec.higher?.id ?? null : null,
      blockedWindows: rec.kind === "almost" ? rec.blocked : null,
      capsAvoided: rec.kind === "tight" ? rec.capsAvoided : null,
      text: recommendationText(a),
    },
    weeklyBetweenPlans: "not_published",
    sources: {
      sessionMultiplier: MULTIPLIER_SOURCE,
      prices: PRICES_SOURCE, pricesCheckedAt: PRICES_CHECKED_AT, pricesStale: pricesStale(o.now),
    },
    plans: CLAUDE_PLANS.map((p: ClaudePlan) => ({ id: p.id, name: p.name, sessionMultiplier: p.sessionMultiplier, monthlyUsd: p.monthlyUsd })),
  };
}

function pct(n: number): number { return Math.round(n); }
function usd(n: number): string { return tr`${n} $`; }
function day(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
