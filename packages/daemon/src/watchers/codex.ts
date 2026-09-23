import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { AgentTurn, ParseReport, TokenUsage } from "@estela/shared";
import { tr } from "../i18n/index.js";
import type { ScanOptions, ScanResult } from "./claude.js";

/**
 * Adaptador de Codex (OpenAI).
 *
 * Mismo criterio que el de Claude Code: un `.jsonl` interno no documentado se
 * trata como un feed externo no confiable. Se leen los pocos campos que hacen
 * falta, lo desconocido se cuenta y se descarta, y lo que no cuadra se reporta
 * en vez de degradarse en silencio.
 *
 * Codex da de hecho más que Claude Code: la rama de git viene escrita en
 * `session_meta.git.branch`, y no hay que inferirla por marca de tiempo.
 *
 * La trampa está en los tokens. Cada `token_count` trae dos cifras:
 *
 *   - `last_token_usage`  — lo que costó esa llamada al modelo.
 *   - `total_token_usage` — el acumulado de la sesión hasta ese momento.
 *
 * Medido sobre un rollout real de 68 eventos, la suma de los `last` cuadra
 * exactamente con el último `total` (4.365.947 tokens de entrada). Sumar los
 * `total` en vez de los `last` habría multiplicado el coste por seis. Es el
 * mismo error que en Claude Code costaba un 2.9x, con otra cara.
 */

const CODEX_HOME = join(homedir(), ".codex", "sessions");

/** Los únicos campos de los que dependemos. Todo lo demás es ruido. */
interface RawLine {
  type?: unknown;
  ordinal?: unknown;
  timestamp?: unknown;
  payload?: Record<string, unknown>;
}

/** Lo que se arrastra de las líneas anteriores del mismo rollout. */
interface SessionState {
  sessionId: string | null;
  cwd: string | null;
  branch: string | null;
  cliVersion: string | null;
  model: string | null;
}

export async function scanCodex(options: ScanOptions = {}): Promise<ScanResult> {
  const root = options.root ?? CODEX_HOME;
  const files = await listRollouts(root);

  const turns: AgentTurn[] = [];
  const seenTurnIds = new Set<string>();
  const producerVersions = new Set<string>();
  const warnings: string[] = [];

  let recordsSeen = 0;
  let duplicatesDropped = 0;
  let unknownRecords = 0;
  let malformedRecords = 0;

  for (const file of files) {
    // El estado se reinicia en cada fichero: un rollout es una sesión.
    const state: SessionState = {
      sessionId: null, cwd: null, branch: null, cliVersion: null, model: null,
    };

    for await (const line of readLines(file)) {
      if (!line.trim()) continue;
      recordsSeen++;

      let raw: RawLine;
      try {
        raw = JSON.parse(line) as RawLine;
      } catch {
        // Una línea a medio escribir mientras la sesión está viva es normal.
        malformedRecords++;
        continue;
      }

      const payload = raw.payload;
      if (!payload) { unknownRecords++; continue; }

      if (raw.type === "session_meta") { applySessionMeta(state, payload); continue; }
      if (raw.type === "turn_context") { applyTurnContext(state, payload); continue; }

      if (raw.type !== "event_msg" || payload["type"] !== "token_count") {
        // `task_started`, `task_complete`, `response_item`, `world_state`… son
        // maquinaria interna de Codex. Se cuentan para el canario y se tiran.
        unknownRecords++;
        continue;
      }

      const turn = toTurn(raw, payload, state);
      if (!turn) { malformedRecords++; continue; }

      if (seenTurnIds.has(turn.turnId)) { duplicatesDropped++; continue; }
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
      tr`Codex puede haber cambiado su formato: revisa los totales antes de facturar.`);
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

function applySessionMeta(state: SessionState, payload: Record<string, unknown>): void {
  const id = payload["session_id"] ?? payload["id"];
  if (typeof id === "string") state.sessionId = id;
  if (typeof payload["cwd"] === "string") state.cwd = payload["cwd"];
  if (typeof payload["cli_version"] === "string") state.cliVersion = payload["cli_version"];

  const git = payload["git"] as Record<string, unknown> | undefined;
  const branch = git?.["branch"];
  if (typeof branch === "string" && branch) state.branch = branch;
}

/**
 * El contexto del turno pisa al de la sesión.
 *
 * Una sesión larga puede cambiar de carpeta y de modelo por el camino, y lo que
 * vale para imputar un turno es lo que estaba vigente cuando ocurrió.
 */
function applyTurnContext(state: SessionState, payload: Record<string, unknown>): void {
  if (typeof payload["model"] === "string") state.model = payload["model"];
  if (typeof payload["cwd"] === "string") state.cwd = payload["cwd"];
}

function toTurn(
  raw: RawLine, payload: Record<string, unknown>, state: SessionState,
): AgentTurn | null {
  const info = payload["info"] as Record<string, unknown> | undefined;
  const last = info?.["last_token_usage"];
  if (!last || typeof last !== "object") return null;

  if (typeof raw.timestamp !== "string" || !state.model) return null;
  const at = new Date(raw.timestamp);
  if (Number.isNaN(at.getTime())) return null;

  // `ordinal` es el número de línea dentro del rollout, así que sesión más
  // ordinal identifica el evento sin ambigüedad y vuelve a salir igual si se
  // reescanea el mismo fichero. Los `token_count` no traen `turn_id` propio.
  const ordinal = typeof raw.ordinal === "number" ? raw.ordinal : null;
  if (ordinal === null) return null;

  const sessionId = state.sessionId ?? "codex";

  return {
    agent: "codex",
    turnId: `${sessionId}:${ordinal}`,
    sessionId,
    at,
    model: state.model,
    repoPath: state.cwd,
    branch: state.branch,
    tokens: readUsage(last as Record<string, unknown>),
    producerVersion: state.cliVersion,
  };
}

/**
 * Lee `last_token_usage`.
 *
 * **La caché va DENTRO de `input_tokens`, no aparte.** Es al revés que en
 * Anthropic, donde `cache_read_input_tokens` se suma al input. Comprobado en
 * los 68 eventos de un rollout real: `total_tokens` es siempre
 * `input_tokens + output_tokens`, sin la caché en medio.
 *
 * Por eso hay que restarla. Sin restar, la parte cacheada se cobra a precio
 * completo como input y otra vez al 10% como caché: sobre datos reales eso
 * daba 10,03 $ donde lo correcto son 2,17 $, un 4.6x de más en una factura.
 *
 * `cache_write_input_tokens` se resta también. En los rollouts medidos siempre
 * venía a cero, así que no se ha podido confirmar de qué lado cae; restarlo es
 * el lado que subestima, que es la regla de la casa cuando hay duda.
 *
 * Codex no desglosa el TTL de la escritura de caché, así que todo se imputa al
 * de 5 minutos: es el multiplicador más bajo (1.25x frente a 2x), y OpenAI no
 * tiene un tramo de una hora.
 *
 * `reasoning_output_tokens` no se suma aparte: ya va dentro de `output_tokens`
 * —sumarlos daría más que el `total_tokens` que el propio Codex escribe.
 */
function readUsage(last: Record<string, unknown>): TokenUsage {
  const total = num(last["input_tokens"]);
  const cacheRead = num(last["cached_input_tokens"]);
  const cacheWrite = num(last["cache_write_input_tokens"]);

  return {
    // Nunca negativo: si un origen raro dijera más caché que entrada, un input
    // negativo restaría dinero de la factura en silencio.
    input: Math.max(0, total - cacheRead - cacheWrite),
    output: num(last["output_tokens"]),
    cacheRead,
    cacheWrite5m: cacheWrite,
    cacheWrite1h: 0,
  };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function matchesRepo(repoPath: string | null, roots: readonly string[]): boolean {
  if (!repoPath) return false;
  return roots.some((root) => repoPath === root || repoPath.startsWith(root + "/"));
}

/**
 * Los rollouts viven en `sessions/AAAA/MM/DD/`, así que hay que bajar por el
 * árbol en vez de listar un nivel como en Claude Code.
 */
async function listRollouts(root: string): Promise<string[]> {
  const files: string[] = [];

  async function baja(dir: string, profundidad: number): Promise<void> {
    // Año, mes, día y fichero: más hondo no hay nada que buscar, y así una
    // carpeta rara no convierte el escaneo en un recorrido del disco entero.
    if (profundidad > 3) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const ruta = join(dir, entry);
      try {
        if ((await stat(ruta)).isDirectory()) await baja(ruta, profundidad + 1);
        else if (entry.startsWith("rollout-") && entry.endsWith(".jsonl")) files.push(ruta);
      } catch {
        // Un rollout ilegible no debe tumbar el escaneo de los demás.
      }
    }
  }

  await baja(root, 0);
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
