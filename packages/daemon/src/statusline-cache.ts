import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * `statusline.json`, junto a la base: lo que la status line recuerda entre
 * llamadas.
 *
 *  - `files`: hasta qué byte se leyó cada transcript, para leer solo lo nuevo.
 *  - `fiveHour`: el último `rate_limits.five_hour.resets_at` que mandó Claude
 *    Code, y cuándo se vio. `estela quota` lo usa para saber dónde empieza de
 *    verdad la ventana de 5 h en vez de estimarla.
 *
 * Es una caché: si se pierde o se corrompe, todo sigue funcionando, solo que
 * relee más o vuelve a estimar.
 */

export interface StatuslineCache {
  files: Record<string, { offset: number; seenAt: string }>;
  fiveHour?: { resetsAt: string; seenAt: string };
}

const MAX_FILES = 30;
/** Con el mismo reinicio, no se reescribe más a menudo que esto. */
const FIVE_HOUR_REFRESH_MS = 10 * 60_000;

export function cachePath(dbPath: string): string {
  return join(dirname(dbPath), "statusline.json");
}

export function loadCache(dbPath: string): StatuslineCache {
  try {
    const c = JSON.parse(readFileSync(cachePath(dbPath), "utf8")) as StatuslineCache;
    return c && typeof c.files === "object" && c.files ? c : { files: {} };
  } catch { return { files: {} }; }
}

export function saveCache(dbPath: string, cache: StatuslineCache): void {
  // Solo los transcripts vistos más recientemente: uno por sesión, y las
  // sesiones viejas ya no escriben.
  const files = Object.fromEntries(Object.entries(cache.files)
    .sort((a, b) => b[1].seenAt.localeCompare(a[1].seenAt)).slice(0, MAX_FILES));
  try {
    writeFileSync(cachePath(dbPath), JSON.stringify({ ...cache, files }));
  } catch { /* sin caché, la próxima vez se relee: más lento, no incorrecto */ }
}

/**
 * Apunta el `resets_at` de la ventana de 5 h. Solo si existe ya el directorio
 * de Estela: la status line no es quien empieza a guardar datos.
 */
export function recordFiveHourReset(dbPath: string, resetsAt: Date, now: Date): void {
  if (!existsSync(dirname(dbPath))) return;
  const cache = loadCache(dbPath);
  const prev = cache.fiveHour;
  const same = prev && new Date(prev.resetsAt).getTime() === resetsAt.getTime();
  if (same && now.getTime() - new Date(prev.seenAt).getTime() < FIVE_HOUR_REFRESH_MS) return;
  cache.fiveHour = { resetsAt: resetsAt.toISOString(), seenAt: now.toISOString() };
  saveCache(dbPath, cache);
}

export function readFiveHourReset(dbPath: string): { resetsAt: Date; seenAt: Date } | null {
  const f = loadCache(dbPath).fiveHour;
  if (!f) return null;
  const resetsAt = new Date(f.resetsAt), seenAt = new Date(f.seenAt);
  return Number.isNaN(resetsAt.getTime()) || Number.isNaN(seenAt.getTime()) ? null : { resetsAt, seenAt };
}
