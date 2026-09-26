import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AgentTurn, ParseReport } from "@estela/shared";
import { EMPTY_USAGE } from "@estela/shared";
import { tr } from "../i18n/index.js";
import { isSameOrInside, normalizePath } from "../paths.js";
import type { ScanOptions, ScanResult } from "./claude.js";

/**
 * Adaptador de GitHub Copilot en VS Code (chat y modo agente).
 *
 * Mismo criterio que Claude Code y Codex: un formato interno y no documentado
 * se trata como un feed externo no confiable. Se leen los pocos campos que
 * hacen falta, y lo que no cuadra se cuenta y se reporta.
 *
 * Dónde vive: VS Code guarda cada ventana en `workspaceStorage/<hash>/`, con
 * `workspace.json` diciendo qué carpeta es (una URI `file:///…`, en Windows
 * `file:///c%3A/…`) y las conversaciones en `chatSessions/`. Hay dos formatos:
 *
 *   - `.json`  — la sesión entera, de versiones anteriores.
 *   - `.jsonl` — un registro de cambios: `kind 0` es el estado inicial,
 *                `kind 1` pone un valor en una ruta (`k`), `kind 2` añade a
 *                una lista (con `i`, la recorta antes a ese largo) y `kind 3`
 *                borra. Se reproduce entero para llegar al estado final.
 *
 * De cada petición se sacan dos marcas: cuando se lanzó (`timestamp`) y cuando
 * terminó (`modelState.completedAt`). En modo agente una petición puede
 * trabajar varios minutos, y contar solo el arranque dejaría fuera ese tiempo.
 *
 * Lo que NO se ve: el autocompletado en línea no deja rastro en disco. Ese
 * trabajo solo aparece por los commits, como el de quien programa sin agente.
 *
 * El coste se deja vacío a propósito aunque haya tokens: Copilot se paga por
 * suscripción, y ponerle precio de API sería inventarlo. El modelo va con el
 * prefijo `copilot/` que ya trae, para que el catálogo de precios no lo
 * confunda con el mismo modelo usado por API.
 */

/** Las carpetas de VS Code y VS Code Insiders en cada sistema. */
export function defaultCopilotRoots(
  platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir(),
): string[] {
  const base = platform === "win32"
    ? (env["APPDATA"] ?? join(home, "AppData", "Roaming"))
    : platform === "darwin"
      ? join(home, "Library", "Application Support")
      : (env["XDG_CONFIG_HOME"] ?? join(home, ".config"));
  return ["Code", "Code - Insiders"].map((app) => join(base, app, "User", "workspaceStorage"));
}

export interface CopilotScanOptions extends Omit<ScanOptions, "root"> {
  /** Carpetas `workspaceStorage` a leer. Por defecto, las de VS Code de esta máquina. */
  readonly roots?: readonly string[];
}

/** `file:///Users/ana/repo` o `file:///c%3A/Users/ana/repo` → ruta. Lo remoto (SSH, WSL, contenedores) no es de esta máquina. */
export function folderFromUri(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri.startsWith("file://")) return null;
  try {
    const url = new URL(uri);
    let path = decodeURIComponent(url.pathname);
    if (url.host) path = `//${url.host}${path}`;          // ruta de red
    else if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1); // /c:/Users → c:/Users
    return normalizePath(path);
  } catch {
    return null;
  }
}

type Json = Record<string, unknown>;

/** Reproduce el registro de cambios de un `.jsonl` hasta su estado final. */
export function replayChatLog(text: string): { state: Json | null; malformed: number } {
  let state: Json | null = null;
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let op: { kind?: unknown; k?: unknown; v?: unknown; i?: unknown };
    try { op = JSON.parse(line); } catch { malformed++; continue; }

    if (op.kind === 0 && op.v && typeof op.v === "object") { state = op.v as Json; continue; }
    if (!state || !Array.isArray(op.k)) { malformed++; continue; }
    const k = op.k as (string | number)[];
    const parent = walk(state, k.slice(0, -1));
    const key = k[k.length - 1];
    if (!parent || key === undefined) { malformed++; continue; }

    if (op.kind === 1) { (parent as Json)[key as string] = op.v; continue; }
    if (op.kind === 2) {
      let arr = (parent as Json)[key as string];
      if (!Array.isArray(arr)) { arr = []; (parent as Json)[key as string] = arr; }
      if (typeof op.i === "number") (arr as unknown[]).length = op.i;
      if (Array.isArray(op.v)) (arr as unknown[]).push(...op.v);
      continue;
    }
    if (op.kind === 3) { delete (parent as Json)[key as string]; continue; }
    malformed++;
  }
  return { state, malformed };
}

function walk(root: unknown, path: readonly (string | number)[]): unknown {
  let node = root;
  for (const step of path) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Record<string | number, unknown>)[step];
  }
  return node;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** Una petición del chat: el turno de arranque y, si trabajó un rato, el de fin. */
function turnsOf(request: Json, session: Json, repoPath: string, fallbackSession: string): AgentTurn[] | null {
  const requestId = request["requestId"];
  const start = request["timestamp"];
  if (typeof requestId !== "string" || typeof start !== "number") return null;

  const model = typeof request["modelId"] === "string" && request["modelId"]
    ? (String(request["modelId"]).startsWith("copilot/") ? String(request["modelId"]) : `copilot/${request["modelId"]}`)
    : "copilot";
  const sessionId = typeof session["sessionId"] === "string" ? session["sessionId"] : fallbackSession;
  const producerVersion = typeof session["version"] === "number" ? `chat-v${session["version"]}` : null;

  const base = { agent: "copilot" as const, sessionId, model, repoPath, branch: null, producerVersion };
  const turns: AgentTurn[] = [{
    ...base,
    turnId: `copilot:${requestId}`,
    at: new Date(start),
    tokens: { ...EMPTY_USAGE, input: num(request["promptTokens"]), output: num(request["completionTokens"]) },
  }];

  const state = request["modelState"] as Json | undefined;
  const timings = (request["result"] as Json | undefined)?.["timings"] as Json | undefined;
  const end = num(state?.["completedAt"])
    || (num(request["elapsedMs"]) ? start + num(request["elapsedMs"]) : 0)
    || (num(timings?.["totalElapsed"]) ? start + num(timings?.["totalElapsed"]) : 0);
  // Menos de un minuto no cambia ningún bloque; más, es trabajo del agente.
  if (end - start >= 60_000) {
    turns.push({ ...base, turnId: `copilot:${requestId}:end`, at: new Date(end), tokens: EMPTY_USAGE });
  }
  return turns;
}

export async function scanCopilot(options: CopilotScanOptions = {}): Promise<ScanResult> {
  const roots = options.roots ?? defaultCopilotRoots();

  const turns: AgentTurn[] = [];
  const seen = new Set<string>();
  const versions = new Set<string>();
  const warnings: string[] = [];
  let filesRead = 0, recordsSeen = 0, duplicatesDropped = 0, unknownRecords = 0, malformedRecords = 0;

  for (const root of roots) {
    let workspaces: string[];
    try { workspaces = await readdir(root); } catch { continue; }  // VS Code no instalado

    for (const ws of workspaces) {
      const chatDir = join(root, ws, "chatSessions");
      let files: string[];
      try { files = (await readdir(chatDir)).filter((f) => f.endsWith(".json") || f.endsWith(".jsonl")); }
      catch { continue; }
      if (!files.length) continue;

      // Sin carpeta local (un .code-workspace, SSH, WSL…) no hay proyecto al que
      // imputar: se cuenta y se sigue, para que el canario lo vea.
      let repoPath: string | null = null;
      try {
        const info = JSON.parse(await readFile(join(root, ws, "workspace.json"), "utf8")) as Json;
        repoPath = folderFromUri(info["folder"]);
      } catch { /* sin workspace.json */ }
      if (!repoPath) { unknownRecords += files.length; continue; }
      if (options.repoPaths?.length && !options.repoPaths.some((r) => isSameOrInside(repoPath!, r))) continue;

      for (const file of files) {
        filesRead++;
        let session: Json | null;
        try {
          const text = await readFile(join(chatDir, file), "utf8");
          if (file.endsWith(".jsonl")) {
            const replayed = replayChatLog(text);
            session = replayed.state;
            malformedRecords += replayed.malformed;
          } else {
            session = JSON.parse(text) as Json;
          }
        } catch { malformedRecords++; continue; }
        if (!session) { malformedRecords++; continue; }

        const requests = Array.isArray(session["requests"]) ? session["requests"] as Json[] : [];
        for (const request of requests) {
          recordsSeen++;
          const produced = request && typeof request === "object"
            ? turnsOf(request, session, repoPath, file.replace(/\.jsonl?$/, ""))
            : null;
          if (!produced) { malformedRecords++; continue; }
          for (const turn of produced) {
            if (seen.has(turn.turnId)) { duplicatesDropped++; continue; }
            seen.add(turn.turnId);
            if (options.since && turn.at < options.since) continue;
            if (turn.producerVersion) versions.add(turn.producerVersion);
            turns.push(turn);
          }
        }
      }
    }
  }

  const classifiable = recordsSeen;
  if (classifiable > 0 && malformedRecords / classifiable > 0.02) {
    warnings.push(
      tr`${malformedRecords} de ${classifiable} peticiones de Copilot venían malformadas ` +
      `(${((malformedRecords / classifiable) * 100).toFixed(1)}%). ` +
      tr`VS Code puede haber cambiado su formato: revisa los totales antes de facturar.`);
  }

  turns.sort((a, b) => a.at.getTime() - b.at.getTime());
  const report: ParseReport = {
    filesRead, recordsSeen, turnsAccepted: turns.length, duplicatesDropped,
    unknownRecords, malformedRecords, producerVersions: [...versions].sort(), warnings,
  };
  return { turns, report };
}
