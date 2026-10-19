import { appendFileSync, closeSync, existsSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { loadCache, saveCache, type StatuslineCache } from "./statusline-cache.js";

/**
 * `~/.estela/rate-limits.jsonl`: el historial de los porcentajes de límite que
 * Claude Code manda a la status line. Es lo que analiza `estela plan`.
 *
 * Solo se guarda lo que manda Claude Code, tal cual: el porcentaje usado y el
 * reinicio de cada ventana, y su versión. Ni sesión, ni rutas, ni proyectos.
 * Estela no estima ningún límite: sin `rate_limits` en la entrada (API key, o
 * la primera respuesta de la sesión aún no llegó), no se guarda nada.
 *
 * Los transcripts no traen estos porcentajes, así que no hay forma de
 * recuperar el pasado: el historial empieza el día que se instala la 0.2.4. Y
 * solo se recoge con Claude Code en la terminal; la extensión de VS Code no
 * ejecuta la status line.
 *
 * Va por el camino rápido de la status line (100 ms): sin `node:sqlite`, una
 * línea por `appendFileSync`, y cualquier error se ignora.
 */

export interface RateSample {
  /** Epoch en ms de la muestra. */
  readonly ts: number;
  readonly src: "claude-code";
  readonly w5?: number;
  /** `resets_at` tal cual (epoch en s). */
  readonly w5_reset?: number;
  readonly w7?: number;
  readonly w7_reset?: number;
  /** Versión de Claude Code, si viene. */
  readonly cc?: string;
}

const MIN_GAP_MS = 5 * 60_000;
const MIN_DELTA = 1;
export const KEEP_DAYS = 120;
const PRUNE_EVERY_MS = 24 * 60 * 60_000;
/** Cada cuánto se reescribe en la caché "se vio una sesión sin rate_limits". */
const NO_LIMITS_EVERY_MS = 60 * 60_000;

export function historyPath(dbPath: string): string {
  return join(dirname(dbPath), "rate-limits.jsonl");
}

/**
 * La muestra que sale del JSON de la status line, o null si no trae ningún
 * porcentaje. Cada ventana que falte se omite: nunca se escribe un 0.
 */
export function sampleOf(raw: unknown, now: Date): RateSample | null {
  const o = obj(raw);
  const limits = obj(o["rate_limits"]);
  const five = obj(limits["five_hour"]);
  const seven = obj(limits["seven_day"]);
  const w5 = num(five["used_percentage"]);
  const w7 = num(seven["used_percentage"]);
  if (w5 === undefined && w7 === undefined) return null;
  const w5Reset = num(five["resets_at"]);
  const w7Reset = num(seven["resets_at"]);
  const cc = typeof o["version"] === "string" && o["version"] ? o["version"] : undefined;
  return {
    ts: now.getTime(), src: "claude-code",
    ...(w5 !== undefined ? { w5 } : {}),
    ...(w5Reset !== undefined ? { w5_reset: w5Reset } : {}),
    ...(w7 !== undefined ? { w7 } : {}),
    ...(w7Reset !== undefined ? { w7_reset: w7Reset } : {}),
    ...(cc ? { cc } : {}),
  };
}

/**
 * Si vale la pena guardar la muestra: han pasado 5 minutos desde la última,
 * algún porcentaje cambió al menos un punto, o empezó una ventana nueva.
 */
export function shouldWrite(last: RateSample | undefined, s: RateSample): boolean {
  if (!last) return true;
  if (s.ts - last.ts >= MIN_GAP_MS) return true;
  if (moved(last.w5, s.w5) || moved(last.w7, s.w7)) return true;
  return last.w5_reset !== s.w5_reset || last.w7_reset !== s.w7_reset;
}

function moved(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a !== b;
  return Math.abs(a - b) >= MIN_DELTA;
}

/**
 * Lo que hace la status line en cada evento. Nunca lanza: es un historial, y
 * la línea tiene que salir igual aunque no se pueda escribir.
 *
 * Solo escribe si ya existe el directorio de Estela: la status line no es
 * quien empieza a guardar datos.
 */
export function recordSample(dbPath: string, raw: unknown, now: Date): void {
  try {
    if (!existsSync(dirname(dbPath))) return;
    const cache = loadCache(dbPath);
    let changed = false;

    const sample = sampleOf(raw, now);
    if (!sample) {
      // Para que `estela plan` distinga "sin datos" de "esto es una API key".
      if (obj(raw)["rate_limits"] === undefined && stale(cache.noLimitsAt, now, NO_LIMITS_EVERY_MS)) {
        cache.noLimitsAt = now.toISOString();
        changed = true;
      }
    } else if (shouldWrite(cache.lastSample, sample)) {
      appendFileSync(historyPath(dbPath), JSON.stringify(sample) + "\n");
      cache.lastSample = sample;
      changed = true;
    }

    if (sample && stale(cache.prunedAt, now, PRUNE_EVERY_MS)) {
      pruneSamples(historyPath(dbPath), now);
      cache.prunedAt = now.toISOString();
      changed = true;
    }
    if (changed) saveCache(dbPath, cache as StatuslineCache);
  } catch { /* sin historial esta vez; la línea sale igual */ }
}

function stale(iso: string | undefined, now: Date, ms: number): boolean {
  if (!iso) return true;
  const t = Date.parse(iso);
  return Number.isNaN(t) || now.getTime() - t >= ms;
}

/** Lee el historial. Las líneas rotas se saltan. */
export function readSamples(file: string): RateSample[] {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return []; }
  const out: RateSample[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    try {
      const s = JSON.parse(line) as RateSample;
      if (s && typeof s.ts === "number") out.push(s);
    } catch { /* línea a medias: se ignora */ }
  }
  return out;
}

/**
 * Quita las muestras de hace más de 120 días. Reescribe en un fichero aparte y
 * lo renombra encima: un corte a mitad no deja el historial a medias.
 * Devuelve cuántas quitó.
 *
 * Corre desde la status line una vez al día, así que lo normal (nada que
 * quitar) tiene que costar casi nada: el fichero se escribe en orden, y si la
 * primera muestra no ha caducado, ninguna lo ha hecho. Solo entonces se lee
 * entero, y el `ts` se saca del principio de cada línea sin parsear el JSON.
 */
export function pruneSamples(file: string, now: Date, keepDays = KEEP_DAYS): number {
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60_000;
  const first = firstLine(file);
  if (first === null) return 0;
  const firstTs = tsOf(first);
  if (firstTs !== null && firstTs >= cutoff) return 0;

  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const kept = lines.filter((line) => {
    const ts = tsOf(line);
    return ts !== null && ts >= cutoff;
  });
  if (kept.length === lines.length) return 0;
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, kept.map((l) => l + "\n").join(""));
  renameSync(tmp, file);
  return lines.length - kept.length;
}

/** El `ts` de una línea: siempre es el primer campo, porque así la escribe `sampleOf`. Null si está rota. */
function tsOf(line: string): number | null {
  const m = /^\{"ts":(\d+),/.exec(line);
  if (!m || !line.endsWith("}")) return null;
  return Number(m[1]);
}

function firstLine(file: string): string | null {
  let fd: number;
  try { fd = openSync(file, "r"); } catch { return null; }
  try {
    const buf = Buffer.alloc(512);
    const n = readSync(fd, buf, 0, buf.length, 0);
    if (n === 0) return null;
    const text = buf.subarray(0, n).toString("utf8");
    const nl = text.indexOf("\n");
    return nl >= 0 ? text.slice(0, nl) : text;
  } finally { closeSync(fd); }
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
