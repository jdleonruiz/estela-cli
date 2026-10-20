import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Los bloqueos que Claude Code dejó escritos en sus transcripts.
 *
 * Los transcripts no traen los porcentajes de límite, pero cuando Claude Code
 * recibe un 429 guarda la respuesta con un bloque `quotaLimits`: qué ventana
 * fue (`five_hour` o `seven_day`) y cuándo se reinicia. Es un dato oficial y
 * llega a antes de la 0.2.4, así que `estela plan` lo enseña como una línea
 * aparte. No entra en el cálculo de equivalencias, que es solo de porcentajes.
 *
 * Los transcripts de un mes pueden pesar cientos de MB: se leen una vez y
 * después solo lo nuevo de cada fichero, con lo visto guardado al lado de la
 * base (`plan-blocks.json`).
 */

export interface RateLimitBlock {
  readonly type: "five_hour" | "seven_day";
  /** `resetsAt` (epoch en s). */
  readonly reset: number;
  /** El primer 429 de esa ventana (epoch en ms). */
  readonly at: number;
}

interface BlocksCache {
  files: Record<string, number>;
  blocks: RateLimitBlock[];
}

const MAX_AGE_MS = 120 * 86_400_000;

export function blocksCachePath(dbPath: string): string {
  return join(dirname(dbPath), "plan-blocks.json");
}

/** Lee lo nuevo de los transcripts y devuelve todos los bloqueos conocidos. */
export function scanBlocks(root: string, cacheFile: string, now: Date): RateLimitBlock[] {
  let cache: BlocksCache = { files: {}, blocks: [] };
  try { cache = JSON.parse(readFileSync(cacheFile, "utf8")) as BlocksCache; } catch { /* primera vez */ }
  const byKey = new Map(cache.blocks.map((b) => [`${b.type}|${b.reset}`, b]));

  for (const file of jsonlFiles(root, now.getTime() - MAX_AGE_MS)) {
    let size: number;
    try { size = statSync(file).size; } catch { continue; }
    const offset = cache.files[file] ?? 0;
    const start = offset <= size ? offset : 0;
    if (start >= size) continue;
    const { text, end } = readFrom(file, start, size);
    for (const b of blocksIn(text)) {
      const key = `${b.type}|${b.reset}`;
      const prev = byKey.get(key);
      if (!prev || b.at < prev.at) byKey.set(key, b);
    }
    cache.files[file] = end;
  }

  const blocks = [...byKey.values()].filter((b) => b.at >= now.getTime() - MAX_AGE_MS).sort((a, b) => a.at - b.at);
  try { writeFileSync(cacheFile, JSON.stringify({ files: cache.files, blocks })); } catch { /* sin caché se relee */ }
  return blocks;
}

/** Los bloqueos de un texto JSONL. Solo se parsean las líneas que traen `quotaLimits`. */
export function blocksIn(text: string): RateLimitBlock[] {
  const out: RateLimitBlock[] = [];
  let i = text.indexOf('"quotaLimits"');
  while (i >= 0) {
    const startLine = text.lastIndexOf("\n", i) + 1;
    const endLine = text.indexOf("\n", i);
    const line = text.slice(startLine, endLine < 0 ? text.length : endLine);
    try {
      const d = JSON.parse(line) as Record<string, unknown>;
      const q = d["quotaLimits"] as Record<string, unknown> | undefined;
      const type = q?.["rateLimitType"];
      const reset = q?.["resetsAt"];
      const at = Date.parse(String(d["timestamp"]));
      if ((type === "five_hour" || type === "seven_day") && typeof reset === "number" && !Number.isNaN(at) &&
          (d["apiErrorStatus"] === 429 || q?.["status"] === "rejected")) {
        out.push({ type, reset, at });
      }
    } catch { /* línea rota o a medias */ }
    i = endLine < 0 ? -1 : text.indexOf('"quotaLimits"', endLine);
  }
  return out;
}

/** Hasta el último salto de línea: una línea a medias se lee entera la próxima vez. */
function readFrom(file: string, start: number, size: number): { text: string; end: number } {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const nl = buf.lastIndexOf(0x0a);
    if (nl < 0) return { text: "", end: start };
    return { text: buf.subarray(0, nl + 1).toString("utf8"), end: start + nl + 1 };
  } finally { closeSync(fd); }
}

function jsonlFiles(dir: string, modifiedAfter: number): string[] {
  const out: string[] = [];
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...jsonlFiles(p, modifiedAfter));
    else if (e.name.endsWith(".jsonl")) {
      try { if (statSync(p).mtimeMs >= modifiedAfter) out.push(p); } catch { /* se borró mientras tanto */ }
    }
  }
  return out;
}
