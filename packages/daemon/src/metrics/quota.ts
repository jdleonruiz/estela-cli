import type { AgentKind, TokenUsage } from "@estela/shared";

import { costOfTurn } from "../pricing/cost.js";

/**
 * "¿Qué proyecto se come mi cuota?"
 *
 * Quien paga Claude Max/Pro o Codex con suscripción agota la cuota antes de
 * tiempo y no sabe en qué. Estela ya tiene cada turno con su carpeta, así que
 * puede repartir el consumo por proyecto. Funciones puras, como el resto de
 * `metrics/`: entran turnos, salen cifras, y cada cifra tiene un test.
 *
 * Lo que esto NO hace, a propósito: decir cuánto te queda. Ni Anthropic ni
 * OpenAI publican los límites exactos de cada plan, y la cuota se comparte con
 * lo que uses fuera de esta máquina (claude.ai, el móvil, otro portátil), que
 * Estela no ve. Un "te quedan X tokens" sería inventado. Lo único que se puede
 * defender es el consumo real y la comparación con tu propio historial.
 *
 * Los turnos llegan ya deduplicados: los lectores de `watchers/` descartan las
 * filas repetidas (Claude Code por `message.id`, Codex por su ordinal sobre
 * `last_token_usage`) y `agent_turns` los guarda con `turn_id` como clave
 * primaria. Aquí no se repite esa lógica.
 */

/**
 * Los agentes que cuentan para la cuota.
 *
 * Copilot no: guarda `promptTokens`/`completionTokens` sin caché ni nada que
 * permita fiarse de ellos (ver `watchers/copilot.ts`), y además se paga por
 * peticiones, no por tokens. Cursor y Gemini CLI no tienen lector todavía.
 *
 * Cada agente va por separado y no se suman nunca: Claude Code gasta la cuota
 * de Anthropic y Codex la de OpenAI. Un "% del total" mezclando los dos no
 * describiría ninguna cuota que exista.
 */
export const QUOTA_AGENTS = ["claude-code", "codex"] as const;
export type QuotaAgent = (typeof QUOTA_AGENTS)[number];

export function isQuotaAgent(agent: AgentKind): agent is QuotaAgent {
  return (QUOTA_AGENTS as readonly string[]).includes(agent);
}

/** Lo justo de un turno para la cuota. */
export interface QuotaTurn {
  readonly agent: AgentKind;
  readonly at: Date;
  readonly repoPath: string | null;
  readonly tokens: TokenUsage;
  /** Solo para ponderar por precio (`--weighted`). Sin él, el turno no tiene precio. */
  readonly model?: string;
}

/**
 * Consumo en tokens. La escritura de caché va junta (5 min + 1 h): para la
 * cuota da igual el TTL, y separarla solo añadiría una columna que nadie lee.
 */
export interface QuotaUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
}

const ZERO: QuotaUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function add(u: QuotaUsage, t: TokenUsage): QuotaUsage {
  const cacheWrite = t.cacheWrite5m + t.cacheWrite1h;
  return {
    input: u.input + t.input,
    output: u.output + t.output,
    cacheRead: u.cacheRead + t.cacheRead,
    cacheWrite: u.cacheWrite + cacheWrite,
    total: u.total + t.input + t.output + t.cacheRead + cacheWrite,
  };
}

/**
 * A qué fila va un turno. Un turno fuera de cualquier proyecto no se tira: su
 * consumo es tan real como el resto, y quitarlo haría que los porcentajes
 * mintieran. Va a nombre de su carpeta, o a "sin carpeta" si no tiene.
 */
export type QuotaBucket =
  | { readonly kind: "project"; readonly projectId: string; readonly projectName: string }
  /** `folder` es el nombre que se enseña; `path`, la raíz git que agrupa. */
  | { readonly kind: "folder"; readonly folder: string; readonly path: string }
  | { readonly kind: "none" };

export interface QuotaRow {
  readonly bucket: QuotaBucket;
  readonly usage: QuotaUsage;
  /** Lo que valdrían sus tokens a precio de lista, en micro-USD. */
  readonly listCost: number;
  /**
   * Parte del total del periodo, entre 0 y 1: por tokens, o por precio de
   * lista si se pidió ponderar.
   */
  readonly share: number;
}

export interface QuotaBreakdown {
  readonly rows: readonly QuotaRow[];
  readonly total: QuotaUsage;
  readonly listCost: number;
  /** Turnos de un modelo sin precio en el catálogo: al ponderar cuentan como 0. */
  readonly unpriced: number;
  readonly weighted: boolean;
}

function bucketKey(b: QuotaBucket): string {
  return b.kind === "project" ? `p:${b.projectId}` : b.kind === "folder" ? `f:${b.path}` : "-";
}

/** Precio de lista de un turno, en micro-USD, o null si su modelo no tiene precio. */
function listCostOf(t: QuotaTurn): number | null {
  if (!t.model) return null;
  return costOfTurn(t.tokens, t.model, t.at)?.microUsd ?? null;
}

/**
 * Reparto por proyecto de los turnos con `from <= at < to`, de mayor a menor.
 * Un proyecto sin actividad en el periodo no sale: una fila a cero en una
 * tabla de "quién se come la cuota" es ruido.
 */
export function breakdown(
  turns: readonly QuotaTurn[], from: Date, to: Date,
  bucketOf: (repoPath: string | null) => QuotaBucket,
  options: { readonly weighted?: boolean } = {},
): QuotaBreakdown {
  const acc = new Map<string, { bucket: QuotaBucket; usage: QuotaUsage; listCost: number }>();
  let total = ZERO;
  let listCost = 0;
  let unpriced = 0;
  for (const t of turns) {
    if (t.at < from || t.at >= to) continue;
    const bucket = bucketOf(t.repoPath);
    const key = bucketKey(bucket);
    const cost = listCostOf(t);
    if (cost === null) unpriced++;
    const prev = acc.get(key) ?? { bucket, usage: ZERO, listCost: 0 };
    acc.set(key, { bucket, usage: add(prev.usage, t.tokens), listCost: prev.listCost + (cost ?? 0) });
    total = add(total, t.tokens);
    listCost += cost ?? 0;
  }
  const weighted = options.weighted === true;
  const base = (r: { usage: QuotaUsage; listCost: number }) => (weighted ? r.listCost : r.usage.total);
  const whole = weighted ? listCost : total.total;
  const rows = [...acc.values()]
    .map((r) => ({ ...r, share: whole > 0 ? base(r) / whole : 0 }))
    .sort((a, b) => base(b) - base(a));
  return { rows, total, listCost, unpriced, weighted };
}

// ---------------------------------------------------------------------------
// La ventana de 5 horas
// ---------------------------------------------------------------------------

export const WINDOW_HOURS = 5;
const WINDOW_MS = WINDOW_HOURS * 3600_000;

export interface QuotaWindow {
  readonly start: Date;
  readonly end: Date;
}

/**
 * Las ventanas de 5 h que se deducen de unos turnos ordenados en el tiempo.
 *
 * Es una ESTIMACIÓN, y por eso se dice en la ayuda y en la salida:
 *
 *  - Una ventana empieza con el primer mensaje después de que acabe la
 *    anterior, y dura 5 horas. Es lo que describen Anthropic y OpenAI, pero
 *    ninguno publica cómo redondea el inicio (ccusage, por ejemplo, lo lleva a
 *    la hora en punto). Aquí se usa la hora exacta del primer turno: no
 *    inventar un redondeo es preferible a acertar por casualidad.
 *  - La cuota se comparte con lo que uses fuera de esta máquina. Un mensaje en
 *    claude.ai puede haber abierto la ventana antes, y Estela no lo ve: la
 *    ventana real puede empezar antes, nunca después, de la que sale aquí.
 */
export function fiveHourWindows(times: readonly Date[]): QuotaWindow[] {
  const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
  const out: QuotaWindow[] = [];
  for (const at of sorted) {
    const last = out[out.length - 1];
    if (last && at < last.end) continue;
    out.push({ start: at, end: new Date(at.getTime() + WINDOW_MS) });
  }
  return out;
}

/** La ventana abierta ahora, o null. Y si no hay, cuándo acabó la última. */
export function windowAt(
  times: readonly Date[], now: Date,
): { readonly current: QuotaWindow | null; readonly lastEnded: Date | null } {
  const windows = fiveHourWindows(times.filter((t) => t <= now));
  const last = windows[windows.length - 1];
  if (!last) return { current: null, lastEnded: null };
  return last.end > now ? { current: last, lastEnded: null } : { current: null, lastEnded: last.end };
}

// ---------------------------------------------------------------------------
// La semana y el historial
// ---------------------------------------------------------------------------

/**
 * El lunes de esta semana a las 00:00, en la hora de quien pregunta.
 *
 * Con el calendario local (`new Date(año, mes, día)`) y no restando
 * milisegundos: la semana del cambio de hora tiene 167 o 169 horas, y restar
 * 7 × 24 h dejaría el "lunes" a las 23:00 del domingo.
 */
export function weekStart(now: Date): Date {
  const back = (now.getDay() + 6) % 7; // lunes = 0, domingo = 6
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
}

/**
 * El mismo tramo de la semana, `weeksBack` semanas atrás: si hoy es miércoles a
 * las 15:00, de lunes 00:00 a miércoles 15:00 de aquella semana. Así se compara
 * lo comparable: un miércoles no puede llevar lo que lleva una semana entera.
 */
export function sameStretch(now: Date, weeksBack: number): QuotaWindow {
  const monday = weekStart(now);
  const day = (now.getDay() + 6) % 7;
  const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * weeksBack);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + day,
    now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return { start, end };
}

/** Las semanas completas con las que se compara. */
export const HISTORY_WEEKS = 4;

export type QuotaComparison =
  | {
      readonly status: "ok";
      readonly current: number;
      /** Media del mismo tramo en las semanas anteriores. */
      readonly average: number;
      /** current / average. null si la media es 0 (no hay con qué dividir). */
      readonly ratio: number | null;
      readonly weeks: number;
    }
  | {
      readonly status: "insufficient";
      /** Semanas completas de historial que sí hay, de las que harían falta. */
      readonly completeWeeks: number;
      readonly weeks: number;
    };

/**
 * Esta semana frente a la media de las cuatro anteriores, en el mismo tramo.
 *
 * Una semana pasada solo cuenta como historial si empezó el día del primer
 * turno de ese agente o después: antes de eso no había nada que medir, y
 * meter un cero inventado bajaría la media y haría parecer excesiva una semana
 * normal. Una semana posterior sin uso sí cuenta como cero: es real.
 */
export function compareWithHistory(
  times: readonly { readonly at: Date; readonly total: number }[],
  firstTurnAt: Date | null, now: Date,
): QuotaComparison {
  const sum = (w: QuotaWindow) => times.reduce((s, t) => (t.at >= w.start && t.at < w.end ? s + t.total : s), 0);

  const firstDay = firstTurnAt
    ? new Date(firstTurnAt.getFullYear(), firstTurnAt.getMonth(), firstTurnAt.getDate())
    : null;
  const past = Array.from({ length: HISTORY_WEEKS }, (_, i) => sameStretch(now, i + 1));
  const covered = past.filter((w) => firstDay !== null && w.start >= firstDay);

  if (covered.length < HISTORY_WEEKS) {
    return { status: "insufficient", completeWeeks: covered.length, weeks: HISTORY_WEEKS };
  }
  const current = sum({ start: weekStart(now), end: new Date(now.getTime() + 1) });
  const average = past.reduce((s, w) => s + sum(w), 0) / HISTORY_WEEKS;
  return { status: "ok", current, average, ratio: average > 0 ? current / average : null, weeks: HISTORY_WEEKS };
}

// ---------------------------------------------------------------------------
// El informe entero
// ---------------------------------------------------------------------------

export interface AgentQuota {
  readonly agent: QuotaAgent;
  /**
   * `estimated: false` cuando la ventana la dio Claude Code (`resets_at`, que
   * guarda la status line); si no, es la estimación de `fiveHourWindows`.
   */
  readonly window: (QuotaWindow & QuotaBreakdown & { readonly estimated: boolean }) | null;
  /** Si no hay ventana abierta, cuándo acabó la última de los datos. */
  readonly lastWindowEnded: Date | null;
  readonly week: QuotaBreakdown;
  readonly comparison: QuotaComparison;
}

export interface QuotaReport {
  readonly generatedAt: Date;
  readonly weekStart: Date;
  /** Solo los agentes con algo que contar: quien no usa Codex no lee ceros. */
  readonly agents: readonly AgentQuota[];
  /** Hubo actividad de Copilot esta semana, y quedó fuera. */
  readonly copilotExcluded: boolean;
}

/**
 * Monta el informe. `turns` debe cubrir al menos las cuatro semanas anteriores
 * a esta (ver `quotaRange`); `firstTurnAt`, el primer turno que hay guardado de
 * cada agente, sea de cuando sea.
 */
export function buildQuota(input: {
  readonly turns: readonly QuotaTurn[];
  readonly firstTurnAt: ReadonlyMap<AgentKind, Date>;
  readonly now: Date;
  readonly bucketOf: (repoPath: string | null) => QuotaBucket;
  /**
   * La ventana de 5 h de Claude Code tal como la dio Claude Code (ver
   * `officialWindow`). Solo vale para Claude Code: Codex tiene la suya.
   */
  readonly claudeWindow?: QuotaWindow | null;
  readonly weighted?: boolean;
}): QuotaReport {
  const { now, bucketOf } = input;
  const opts = { weighted: input.weighted === true };
  const monday = weekStart(now);
  const until = new Date(now.getTime() + 1);
  const turns = input.turns.filter((t) => t.at <= now);

  const agents: AgentQuota[] = [];
  for (const agent of QUOTA_AGENTS) {
    const own = turns.filter((t) => t.agent === agent);
    const official = agent === "claude-code" && input.claudeWindow &&
      input.claudeWindow.start <= now && now < input.claudeWindow.end ? input.claudeWindow : null;
    const estimate = windowAt(own.map((t) => t.at), now);
    const current = official ?? estimate.current;
    const week = breakdown(own, monday, until, bucketOf, opts);
    if (!current && week.rows.length === 0) continue;

    agents.push({
      agent,
      window: current
        ? { ...current, ...breakdown(own, current.start, until, bucketOf, opts), estimated: !official }
        : null,
      lastWindowEnded: current ? null : estimate.lastEnded,
      week,
      comparison: compareWithHistory(
        own.map((t) => ({ at: t.at, total: add(ZERO, t.tokens).total })),
        input.firstTurnAt.get(agent) ?? null, now),
    });
  }

  return {
    generatedAt: now,
    weekStart: monday,
    agents,
    copilotExcluded: turns.some((t) => t.agent === "copilot" && t.at >= monday),
  };
}

/**
 * La ventana de 5 h que dio Claude Code, a partir del último `resets_at` que
 * vio la status line: empieza 5 h antes de su reinicio.
 *
 * Solo vale si el dato tiene menos de 5 h (uno más viejo puede ser de otra
 * ventana) y si el reinicio aún no ha llegado (pasado ese momento, la ventana
 * en curso es otra que nadie ha visto). Si no, null: se estima como siempre.
 */
export function officialWindow(
  seen: { readonly resetsAt: Date; readonly seenAt: Date } | null, now: Date,
): QuotaWindow | null {
  if (!seen) return null;
  const age = now.getTime() - seen.seenAt.getTime();
  if (age < 0 || age >= WINDOW_MS) return null;
  if (seen.resetsAt <= now) return null;
  const start = new Date(seen.resetsAt.getTime() - WINDOW_MS);
  return start <= now ? { start, end: seen.resetsAt } : null;
}

/** Desde cuándo hay que leer turnos para montar el informe de `now`. */
export function quotaRange(now: Date): QuotaWindow {
  return { start: sameStretch(now, HISTORY_WEEKS).start, end: new Date(now.getTime() + 1) };
}

// ---------------------------------------------------------------------------
// Salida para máquinas
// ---------------------------------------------------------------------------

/**
 * El informe como JSON estable, para `--json` y para el panel web. Fechas en
 * ISO, y las filas con `projectId`/`projectName`/`folder` a null cuando no
 * aplican, para que un script no tenga que mirar de qué tipo es cada una.
 */
export function quotaToJson(report: QuotaReport): Record<string, unknown> {
  const rows = (b: QuotaBreakdown) => b.rows.map((r) => ({
    projectId: r.bucket.kind === "project" ? r.bucket.projectId : null,
    projectName: r.bucket.kind === "project" ? r.bucket.projectName : null,
    folder: r.bucket.kind === "folder" ? r.bucket.folder : null,
    ...r.usage,
    listCostMicroUsd: r.listCost,
    share: Math.round(r.share * 10_000) / 10_000,
  }));
  const weighted = report.agents.some((a) => a.week.weighted);
  return {
    generatedAt: report.generatedAt.toISOString(),
    weekStart: report.weekStart.toISOString(),
    // Para que ningún script lo trate como un dato exacto sin haberlo leído:
    // false solo si todas las ventanas que salen las dio Claude Code.
    windowIsEstimate: report.agents.some((a) => !a.window || a.window.estimated),
    windowHours: WINDOW_HOURS,
    shareBasis: weighted ? "list-price" : "tokens",
    agents: report.agents.map((a) => ({
      agent: a.agent,
      window: a.window
        ? { start: a.window.start.toISOString(), end: a.window.end.toISOString(),
            estimated: a.window.estimated, projects: rows(a.window), total: a.window.total }
        : null,
      lastWindowEnded: a.lastWindowEnded?.toISOString() ?? null,
      week: { projects: rows(a.week), total: a.week.total },
      comparison: a.comparison.status === "ok"
        ? { ...a.comparison, ratio: a.comparison.ratio === null ? null : Math.round(a.comparison.ratio * 1000) / 1000 }
        : a.comparison,
    })),
    excluded: report.copilotExcluded ? [{ agent: "copilot", reason: "no-reliable-tokens" }] : [],
  };
}
