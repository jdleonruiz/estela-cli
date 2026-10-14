import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * `statusline.json`, junto a la base: lo que la status line recuerda entre
 * llamadas.
 *
 *  - `files`: hasta qué byte se leyó cada transcript, para leer solo lo nuevo.
 *  - `fiveHour` y `sevenDay`: lo último que mandó Claude Code en rate_limits
 *    (porcentaje y reinicio) y cuándo se vio. La status line lo enseña al
 *    arrancar una sesión, antes de que lleguen datos nuevos, y `estela quota`
 *    usa el reinicio de la 5 h para saber dónde empieza de verdad la ventana.
 *
 * Es una caché: si se pierde o se corrompe, todo sigue funcionando, solo que
 * relee más o vuelve a estimar.
 */

/** Una ventana de límite tal como la mandó Claude Code, y cuándo se vio. */
export interface SeenLimit {
  resetsAt: string;
  seenAt: string;
  /** El porcentaje usado. Falta si Claude Code mandó el reinicio sin él. */
  usedPercentage?: number;
}

export interface StatuslineCache {
  files: Record<string, { offset: number; seenAt: string }>;
  fiveHour?: SeenLimit;
  sevenDay?: SeenLimit;
}

const MAX_FILES = 30;
/** Con el mismo reinicio y el mismo porcentaje, no se reescribe más a menudo que esto. */
const REFRESH_MS = 10 * 60_000;

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

/** Lo que llega de rate_limits para una ventana (cualquiera de los dos puede faltar). */
export interface LimitInput {
  readonly usedPercentage: number | null;
  readonly resetsAt: Date | null;
}

/**
 * Guarda lo nuevo de rate_limits y, para la ventana que no venga, devuelve el
 * último porcentaje guardado si su reinicio aún no ha llegado.
 *
 * Es para el arranque de una sesión: Claude Code no manda rate_limits hasta la
 * primera respuesta, y mientras tanto la línea perdía la semana y la 5 h que se
 * sabían hace un momento. Un valor guardado cuyo reinicio ya pasó es de una
 * ventana que terminó: no se enseña. En cuanto llega un dato nuevo, lo
 * reemplaza.
 *
 * Usar lo guardado no cuenta como verlo otra vez: `seenAt` solo cambia con un
 * dato nuevo, que es lo que `estela quota` mira para fiarse de la ventana.
 *
 * Solo escribe si existe ya el directorio de Estela: la status line no es
 * quien empieza a guardar datos.
 */
export function rememberLimits(
  dbPath: string, input: { readonly fiveHour: LimitInput; readonly sevenDay: LimitInput }, now: Date,
): { fiveHour: number | null; sevenDay: number | null } {
  const cache = loadCache(dbPath);
  let changed = false;

  const pick = (key: "fiveHour" | "sevenDay", fresh: LimitInput): number | null => {
    const prev = cache[key];
    if (fresh.resetsAt) {
      const sameReset = !!prev && new Date(prev.resetsAt).getTime() === fresh.resetsAt.getTime();
      // Un reinicio sin porcentaje de la misma ventana no borra el que había.
      const pct = fresh.usedPercentage ?? (sameReset ? prev!.usedPercentage ?? null : null);
      const samePct = (prev?.usedPercentage ?? null) === pct;
      const recent = !!prev && now.getTime() - new Date(prev.seenAt).getTime() < REFRESH_MS;
      if (!(sameReset && samePct && recent)) {
        cache[key] = {
          resetsAt: fresh.resetsAt.toISOString(), seenAt: now.toISOString(),
          ...(pct !== null ? { usedPercentage: pct } : {}),
        };
        changed = true;
      }
    }
    if (fresh.usedPercentage !== null) return fresh.usedPercentage;
    // Sin dato nuevo: lo último que se vio, si su ventana sigue abierta.
    const last = cache[key];
    if (!last || last.usedPercentage === undefined) return null;
    return new Date(last.resetsAt) > now ? last.usedPercentage : null;
  };

  const out = { fiveHour: pick("fiveHour", input.fiveHour), sevenDay: pick("sevenDay", input.sevenDay) };
  if (changed && existsSync(dirname(dbPath))) saveCache(dbPath, cache);
  return out;
}

export function readFiveHourReset(dbPath: string): { resetsAt: Date; seenAt: Date } | null {
  const f = loadCache(dbPath).fiveHour;
  if (!f) return null;
  const resetsAt = new Date(f.resetsAt), seenAt = new Date(f.seenAt);
  return Number.isNaN(resetsAt.getTime()) || Number.isNaN(seenAt.getTime()) ? null : { resetsAt, seenAt };
}
