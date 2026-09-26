import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { AgentTurn, ParseReport, TokenUsage } from "@estela/shared";
import { tr } from "../i18n/index.js";
import { isSameOrInside, normalizePath } from "../paths.js";

/**
 * Adaptador de Claude Code.
 *
 * El `.jsonl` que escribe Claude Code es un formato interno no documentado, así
 * que se trata como un feed externo no confiable, no como una API:
 *
 *  1. Se leen ocho campos y se ignora todo lo demás. Los `type` desconocidos
 *     (`atis-latch`, `bridge-session`, `ai-title`, `queue-operation`...) son
 *     maquinaria interna: se cuentan para el canario y se descartan.
 *  2. Una clave nueva jamás rompe el parseo.
 *  3. Se deduplica por `message.id`. Medido sobre transcripts reales, el mismo
 *     turno aparece hasta cinco veces con el mismo `usage`: sumar por fila
 *     multiplica el coste por ~2.9x.
 *  4. Lo que no cuadra se cuenta y se reporta. Nunca se degrada en silencio.
 */

const CLAUDE_HOME = join(homedir(), ".claude", "projects");

/** Los únicos campos de los que dependemos. Todo lo demás es ruido. */
interface RawAssistantRecord {
  type?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  gitBranch?: unknown;
  version?: unknown;
  sessionId?: unknown;
  message?: {
    id?: unknown;
    model?: unknown;
    usage?: Record<string, unknown>;
  };
}

export interface ScanOptions {
  /** Solo turnos en o después de esta fecha. */
  readonly since?: Date;
  /** Limita a los proyectos cuyo `cwd` empiece por alguna de estas rutas. */
  readonly repoPaths?: readonly string[];
  /** Raíz del store. Inyectable para los tests de archivo dorado. */
  readonly root?: string;
}

export interface ScanResult {
  readonly turns: readonly AgentTurn[];
  readonly report: ParseReport;
}

export async function scanClaudeCode(options: ScanOptions = {}): Promise<ScanResult> {
  const root = options.root ?? CLAUDE_HOME;
  const files = await listTranscripts(root);

  const turns: AgentTurn[] = [];
  const seenTurnIds = new Set<string>();
  const producerVersions = new Set<string>();
  const warnings: string[] = [];

  let recordsSeen = 0;
  let duplicatesDropped = 0;
  let unknownRecords = 0;
  let malformedRecords = 0;

  for (const file of files) {
    for await (const line of readLines(file)) {
      if (!line.trim()) continue;
      recordsSeen++;

      let raw: RawAssistantRecord;
      try {
        raw = JSON.parse(line) as RawAssistantRecord;
      } catch {
        // Una línea a medio escribir mientras la sesión está viva es normal.
        malformedRecords++;
        continue;
      }

      if (raw.type !== "assistant") {
        unknownRecords++;
        continue;
      }

      const turn = toTurn(raw);
      if (!turn) {
        malformedRecords++;
        continue;
      }

      if (seenTurnIds.has(turn.turnId)) {
        duplicatesDropped++;
        continue;
      }
      seenTurnIds.add(turn.turnId);

      if (options.since && turn.at < options.since) continue;
      if (options.repoPaths?.length && !matchesRepo(turn.repoPath, options.repoPaths)) continue;

      if (turn.producerVersion) producerVersions.add(turn.producerVersion);
      turns.push(turn);
    }
  }

  // El canario. Un salto brusco aquí significa que el formato cambió.
  const classifiable = recordsSeen - unknownRecords;
  if (classifiable > 0 && malformedRecords / classifiable > 0.02) {
    warnings.push(
      tr`${malformedRecords} de ${classifiable} registros de tipo conocido venían malformados ` +
      `(${((malformedRecords / classifiable) * 100).toFixed(1)}%). ` +
      tr`Claude Code puede haber cambiado su formato: revisa los totales antes de facturar.`);
  }

  turns.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    turns,
    report: {
      filesRead: files.length,
      recordsSeen,
      turnsAccepted: turns.length,
      duplicatesDropped,
      unknownRecords,
      malformedRecords,
      producerVersions: [...producerVersions].sort(),
      warnings,
    },
  };
}

function toTurn(raw: RawAssistantRecord): AgentTurn | null {
  const id = raw.message?.id;
  const model = raw.message?.model;
  const timestamp = raw.timestamp;

  if (typeof id !== "string" || typeof model !== "string" || typeof timestamp !== "string") {
    return null;
  }

  const at = new Date(timestamp);
  if (Number.isNaN(at.getTime())) return null;

  return {
    agent: "claude-code",
    turnId: id,
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : id,
    at,
    model,
    repoPath: typeof raw.cwd === "string" ? normalizePath(raw.cwd) : null,
    branch: typeof raw.gitBranch === "string" && raw.gitBranch ? raw.gitBranch : null,
    tokens: readUsage(raw.message?.usage),
    producerVersion: typeof raw.version === "string" ? raw.version : null,
  };
}

/**
 * Lee el objeto `usage`.
 *
 * Los TTL de escritura de caché viven en `cache_creation.ephemeral_{5m,1h}`, y
 * cuestan distinto (1.25x frente a 2x). Cuando ese desglose no está, se cae a
 * `cache_creation_input_tokens` y se imputa al TTL de 5 minutos: es el
 * multiplicador más bajo, así que ante la duda el coste se subestima en vez de
 * inflar una factura.
 */
function readUsage(usage: Record<string, unknown> | undefined): TokenUsage {
  if (!usage) return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

  const creation = usage["cache_creation"] as Record<string, unknown> | undefined;
  const detailed5m = num(creation?.["ephemeral_5m_input_tokens"]);
  const detailed1h = num(creation?.["ephemeral_1h_input_tokens"]);
  const totalWrite = num(usage["cache_creation_input_tokens"]);

  const hasDetail = creation !== undefined && (detailed5m > 0 || detailed1h > 0);

  return {
    input: num(usage["input_tokens"]),
    output: num(usage["output_tokens"]),
    cacheRead: num(usage["cache_read_input_tokens"]),
    cacheWrite5m: hasDetail ? detailed5m : totalWrite,
    cacheWrite1h: hasDetail ? detailed1h : 0,
  };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Devuelve al repositorio de origen los turnos ocurridos en un scratchpad.
 *
 * Claude Code trabaja parte del tiempo en un directorio temporal cuyo `cwd` es
 * algo como:
 *
 *   /private/tmp/claude-502/-Users-ana-Proyectos-mi-repo/<sesión>/scratchpad
 *
 * Ese trabajo es del proyecto, pero su ruta no es la del repositorio, así que
 * se quedaba sin imputar: horas reales que desaparecían del parte. En una
 * jornada medida, casi la mitad de los turnos de un proyecto estaban ahí.
 *
 * El segmento intermedio es la ruta original con las barras convertidas en
 * guiones. La conversión pierde información —una barra, un guion y un guion
 * bajo acaban todos como "-"—, así que no se puede invertir; lo que sí se puede
 * es generar ese mismo identificador para cada repositorio conocido y ver cuál
 * coincide.
 */
export function resolveScratchpads(turns: readonly AgentTurn[]): AgentTurn[] {
  const realPaths = new Set<string>();
  for (const turn of turns) {
    if (turn.repoPath && !isScratchpad(turn.repoPath)) realPaths.add(turn.repoPath);
  }

  const bySlug = new Map<string, string>();
  for (const path of realPaths) bySlug.set(slugOfPath(path), path);

  return turns.map((turn) => {
    if (!turn.repoPath || !isScratchpad(turn.repoPath)) return turn;
    const slug = scratchpadSlug(turn.repoPath);
    const real = slug ? bySlug.get(slug) : undefined;
    return real ? { ...turn, repoPath: real } : turn;
  });
}

function isScratchpad(path: string): boolean {
  return path.includes("/claude-") && path.endsWith("/scratchpad");
}

/** El segmento con forma de identificador dentro de la ruta del scratchpad. */
function scratchpadSlug(path: string): string | null {
  const parts = path.split("/");
  // …/claude-<uid>/<slug>/<sesión>/scratchpad
  const index = parts.findIndex((p) => p.startsWith("claude-"));
  const slug = index >= 0 ? parts[index + 1] : undefined;
  return slug?.startsWith("-") ? slug : null;
}

/** Mismo identificador que usa Claude Code para nombrar la carpeta del proyecto. */
function slugOfPath(path: string): string {
  return path.replace(/[/_.]/g, "-");
}

function matchesRepo(repoPath: string | null, roots: readonly string[]): boolean {
  if (!repoPath) return false;
  return roots.some((root) => isSameOrInside(repoPath, root));
}

async function listTranscripts(root: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const dir = join(root, entry);
    try {
      if (!(await stat(dir)).isDirectory()) continue;
      for (const name of await readdir(dir)) {
        if (name.endsWith(".jsonl")) files.push(join(dir, name));
      }
    } catch {
      // Un proyecto ilegible no debe tumbar el escaneo de los demás.
    }
  }
  return files.sort();
}

async function* readLines(file: string): AsyncGenerator<string> {
  const stream = createReadStream(file, { encoding: "utf8" });
  try {
    yield* createInterface({ input: stream, crlfDelay: Infinity });
  } finally {
    stream.destroy();
  }
}
