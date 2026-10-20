import { CLAUDE_PLANS, planById, type ClaudePlan, type ClaudePlanId } from "../plan-prices.js";
import type { RateSample } from "../rate-history.js";

/**
 * "¿El plan de Claude que pago es el que me conviene?"
 *
 * Funciones puras sobre el historial de la status line (rate-limits.jsonl):
 * entran muestras, salen cifras, y cada cifra tiene su test.
 *
 * La regla de siempre, más estricta aquí que en ningún sitio: Estela no
 * inventa ni estima el límite de ningún plan. Usa solo
 *
 *  - los porcentajes que manda Claude Code, tal cual, y
 *  - el multiplicador por sesión de 5 h que publica Anthropic (plan-prices.ts).
 *
 * Por eso la comparación entre planes es solo de la ventana de 5 h: del
 * límite semanal Anthropic no publica la relación entre planes, y no se
 * calcula. Y nada de "te quedan X" ni de cuándo te vas a quedar sin cuota.
 */

/** Pico desde el que una ventana cuenta como tope. */
export const CAP_AT = 95;
/** Desde aquí se cuenta el tiempo parado tras un tope. */
const STOPPED_FROM = 99;
/** Una semana con este pico o más es "ir justo". */
const TIGHT_WEEK_AT = 90;
const TIGHT_CAPS_PER_WEEK = 2;
/** Un plan inferior "basta" si no habría bloqueado nunca y su p90 equivalente no pasa de aquí. */
const ENOUGH_P90 = 80;
const ALMOST_MAX_BLOCKS = 3;
export const MIN_DAYS = 7;
export const FULL_DAYS = 14;

export interface FiveHourWindow {
  /** `resets_at` de la ventana (epoch en s). */
  readonly reset: number;
  readonly peak: number;
  readonly samples: number;
  readonly capped: boolean;
  /** Desde la primera muestra ≥ 99 % hasta el reinicio (o hasta ahora). Cota superior, estimada. */
  readonly stoppedMs: number;
}

export interface WeekWindow {
  readonly reset: number;
  readonly peak: number;
}

export interface Alternative {
  readonly plan: ClaudePlan;
  readonly direction: "lower" | "higher";
  readonly p90Equivalent: number;
  readonly maxEquivalent: number;
  /** Ventanas cuyo pico equivalente pasa de 100: te habrían bloqueado. */
  readonly blockedWindows: number;
  /** Subiendo de plan: topes de ahora cuyo pico equivalente se queda por debajo del tope. */
  readonly capsAvoided: number;
}

export type Recommendation =
  | { readonly kind: "tight"; readonly higher: ClaudePlan | null; readonly capsAvoided: number | null }
  | { readonly kind: "enough"; readonly plan: ClaudePlan; readonly weeks: number }
  | { readonly kind: "almost"; readonly plan: ClaudePlan; readonly blocked: number }
  | { readonly kind: "fits" };

export type DataState = "none" | "insufficient" | "provisional" | "ok";

export interface PlanAnalysis {
  readonly plan: ClaudePlan;
  readonly since: Date;
  readonly from: Date;
  readonly to: Date;
  readonly days: number;
  readonly daysWithData: number;
  readonly samples: number;
  readonly dataState: DataState;
  readonly fiveHour: {
    readonly windows: readonly FiveHourWindow[];
    readonly medianPeak: number | null;
    readonly p90Peak: number | null;
    readonly maxPeak: number | null;
    readonly caps: number;
    readonly stoppedMs: number;
  };
  readonly week: {
    readonly weeks: readonly WeekWindow[];
    readonly medianPeak: number | null;
    readonly maxPeak: number | null;
    readonly weeksAtOrAbove90: number;
  };
  readonly alternatives: readonly Alternative[];
  /** null con menos de 7 días de datos. */
  readonly recommendation: Recommendation | null;
}

export interface PlanAnalysisInput {
  readonly samples: readonly RateSample[];
  readonly plan: ClaudePlanId;
  readonly since: Date;
  readonly now: Date;
  /** Período, en días hacia atrás desde `now`. */
  readonly days: number;
  /** Para contar los días con datos en tu zona horaria. Por defecto, la de esta máquina. */
  readonly localDay?: (ms: number) => string;
}

export function analyzePlan(input: PlanAnalysisInput): PlanAnalysis {
  const plan = planById(input.plan);
  if (!plan) throw new Error(`plan desconocido: ${input.plan}`);
  const to = input.now;
  const from = new Date(Math.max(input.since.getTime(), to.getTime() - input.days * 86_400_000));
  const localDay = input.localDay ?? defaultLocalDay;

  const samples = dedupe(input.samples)
    .filter((s) => s.ts >= from.getTime() && s.ts <= to.getTime())
    .sort((a, b) => a.ts - b.ts);
  const daysWithData = new Set(samples.map((s) => localDay(s.ts))).size;

  const windows = fiveHourWindows(samples, to);
  const peaks = windows.map((w) => w.peak);
  const weeks = weekWindows(samples);
  const weekPeaks = weeks.map((w) => w.peak);
  const caps = windows.filter((w) => w.capped).length;

  const alternatives = CLAUDE_PLANS.filter((p) => p.id !== plan.id).map((target) => {
    const factor = plan.sessionMultiplier / target.sessionMultiplier;
    const eq = windows.map((w) => w.peak * factor);
    return {
      plan: target,
      direction: target.sessionMultiplier < plan.sessionMultiplier ? "lower" as const : "higher" as const,
      p90Equivalent: p90(eq) ?? 0,
      maxEquivalent: eq.length ? Math.max(...eq) : 0,
      blockedWindows: eq.filter((e) => e > 100).length,
      capsAvoided: factor < 1 ? windows.filter((w) => w.capped && w.peak * factor < CAP_AT).length : 0,
    };
  });

  const dataState: DataState = samples.length === 0 ? "none"
    : daysWithData < MIN_DAYS ? "insufficient"
    : daysWithData < FULL_DAYS ? "provisional" : "ok";

  const analysis = {
    plan, since: input.since, from, to, days: input.days, daysWithData, samples: samples.length, dataState,
    fiveHour: {
      windows, medianPeak: median(peaks), p90Peak: p90(peaks), maxPeak: peaks.length ? Math.max(...peaks) : null,
      caps, stoppedMs: windows.reduce((s, w) => s + w.stoppedMs, 0),
    },
    week: {
      weeks, medianPeak: median(weekPeaks), maxPeak: weekPeaks.length ? Math.max(...weekPeaks) : null,
      weeksAtOrAbove90: weekPeaks.filter((p) => p >= TIGHT_WEEK_AT).length,
    },
    alternatives,
  };
  return {
    ...analysis,
    recommendation: dataState === "provisional" || dataState === "ok" ? recommend(analysis) : null,
  };
}

/** Las cuatro reglas, en orden. Conservadoras: ante la duda, el plan actual. */
function recommend(a: Omit<PlanAnalysis, "recommendation" | "dataState">): Recommendation {
  const weeksOfData = a.daysWithData / 7;
  const capsPerWeek = weeksOfData > 0 ? a.fiveHour.caps / weeksOfData : 0;
  if (capsPerWeek >= TIGHT_CAPS_PER_WEEK || a.week.weeksAtOrAbove90 > 0) {
    const higher = a.alternatives
      .filter((x) => x.direction === "higher")
      .sort((x, y) => x.plan.sessionMultiplier - y.plan.sessionMultiplier)[0];
    return { kind: "tight", higher: higher?.plan ?? null, capsAvoided: higher ? higher.capsAvoided : null };
  }
  const lower = a.alternatives
    .filter((x) => x.direction === "lower")
    .sort((x, y) => x.plan.monthlyUsd - y.plan.monthlyUsd);
  const enough = lower.find((x) => x.blockedWindows === 0 && x.p90Equivalent <= ENOUGH_P90);
  if (enough) return { kind: "enough", plan: enough.plan, weeks: Math.max(1, Math.round(weeksOfData)) };
  const almost = lower.find((x) => x.blockedWindows >= 1 && x.blockedWindows <= ALMOST_MAX_BLOCKS);
  if (almost) return { kind: "almost", plan: almost.plan, blocked: almost.blockedWindows };
  return { kind: "fits" };
}

// ---------------------------------------------------------------------------

/**
 * Una ventana por `resets_at`, redondeado al minuto: dos sesiones pueden
 * mandar el mismo reinicio con segundos distintos. Una muestra sin reinicio
 * no se puede asignar a ninguna ventana y no cuenta.
 */
export function fiveHourWindows(samples: readonly RateSample[], now: Date): FiveHourWindow[] {
  const groups = new Map<number, RateSample[]>();
  for (const s of samples) {
    if (s.w5 === undefined || s.w5_reset === undefined) continue;
    const key = Math.round(s.w5_reset / 60);
    const g = groups.get(key);
    if (g) g.push(s); else groups.set(key, [s]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([key, g]) => {
    const peak = Math.max(...g.map((s) => s.w5!));
    const capped = peak >= CAP_AT;
    const first99 = g.filter((s) => s.w5! >= STOPPED_FROM).map((s) => s.ts).sort((a, b) => a - b)[0];
    const end = Math.min(key * 60_000, now.getTime());
    return {
      reset: key * 60, peak, samples: g.length, capped,
      stoppedMs: capped && first99 !== undefined ? Math.max(0, end - first99) : 0,
    };
  });
}

export function weekWindows(samples: readonly RateSample[]): WeekWindow[] {
  const peaks = new Map<number, number>();
  for (const s of samples) {
    if (s.w7 === undefined || s.w7_reset === undefined) continue;
    const key = Math.round(s.w7_reset / 60);
    peaks.set(key, Math.max(peaks.get(key) ?? -Infinity, s.w7));
  }
  return [...peaks.entries()].sort((a, b) => a[0] - b[0]).map(([key, peak]) => ({ reset: key * 60, peak }));
}

/** Dos sesiones a la vez pueden escribir la misma muestra. */
function dedupe(samples: readonly RateSample[]): RateSample[] {
  const seen = new Set<string>();
  return samples.filter((s) => {
    const k = `${s.ts}|${s.w5}|${s.w5_reset}|${s.w7}|${s.w7_reset}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
}

/** Percentil 90 por rango más cercano: siempre es un valor observado. */
export function p90(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.ceil(0.9 * v.length) - 1]!;
}

function defaultLocalDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
