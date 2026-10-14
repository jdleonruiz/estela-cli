import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, openSync, readSync } from "node:fs";

import type { AgentTurn } from "@estela/shared";

import { groupByBranchAndDay, sessionize } from "./billing/sessionize.js";
import { DEFAULT_DB_PATH, openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { breakdown, weekStart, type QuotaBucket } from "./metrics/quota.js";
import { normalizePath } from "./paths.js";
import { folderName, gitRoot, ownerResolver } from "./project-of.js";
import { loadCache, rememberLimits, saveCache } from "./statusline-cache.js";
import { renderStatus, stripAnsi, type StatusData, type StatusInput, parseStatusInput } from "./statusline.js";
import { isScratchpad, parseTranscriptLine, resolveScratchpads } from "./watchers/claude.js";

/**
 * El camino rápido de `estela statusline`.
 *
 * `bin.ts` llega aquí sin cargar `cli.js`: Claude Code ejecuta esto en cada
 * evento de la sesión, y la CLI entera tarda más en cargar que todo el
 * presupuesto (100 ms). Aquí solo entra lo que hace falta para una línea.
 *
 * Nunca rompe la status line: ante cualquier fallo imprime "estela" y sale
 * con 0. Ni trazas ni códigos de error — Claude Code enseñaría el error.
 */

interface Flags {
  readonly db: string;
  readonly color: boolean;
  readonly append: string | null;
}

export async function runStatusline(argv: readonly string[]): Promise<void> {
  try {
    const flags = parseFlags(argv);
    const text = await readStdin();
    const input = text.trim() ? parseStatusInput(text) : manualInput();
    const extra = flags.append ? runAppended(flags.append, text) : null;
    const reserved = extra ? stripAnsi(extra).length + 3 : 0;
    const columns = Number(process.env["COLUMNS"]) || null;

    const now = new Date();
    // Lo nuevo de rate_limits se guarda; lo que no venga (al arrancar una
    // sesión) se toma de lo último visto, si su ventana sigue abierta.
    let limits = { fiveHour: input.fiveHour, sevenDay: input.sevenDay };
    try {
      limits = rememberLimits(flags.db, {
        fiveHour: { usedPercentage: input.fiveHour, resetsAt: input.fiveHourResetsAt ?? null },
        sevenDay: { usedPercentage: input.sevenDay, resetsAt: input.sevenDayResetsAt ?? null },
      }, now);
    } catch { /* es una caché: sin ella, la línea sale con lo que llegó */ }
    const data = computeStatus({ ...input, ...limits }, flags.db, now);
    const ours = renderStatus(data, { columns, color: flags.color, reserved });
    process.stdout.write((extra ? `${ours}${flags.color ? "\x1b[90m | \x1b[0m" : " | "}${extra}` : ours) + "\n");
  } catch {
    process.stdout.write("estela\n");
  }
  process.exitCode = 0;
}

function parseFlags(argv: readonly string[]): Flags {
  const value = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };
  return {
    db: value("db") ?? DEFAULT_DB_PATH,
    color: !argv.includes("--no-color") && !process.env["NO_COLOR"],
    append: value("append"),
  };
}

/** Ejecutado a mano en una terminal, sin nada por stdin: el directorio actual. */
function manualInput(): StatusInput {
  return { dir: process.cwd(), transcriptPath: null, fiveHour: null, sevenDay: null, fiveHourResetsAt: null, sevenDayResetsAt: null };
}

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

/**
 * Otra status line encadenada (la que había antes de instalar la de Estela).
 * Recibe el mismo stdin. Si tarda o falla, se enseña solo la nuestra.
 */
function runAppended(command: string, stdin: string): string | null {
  try {
    const r = spawnSync(command, { shell: true, input: stdin, encoding: "utf8", timeout: 1500 });
    const line = (r.stdout ?? "").split("\n")[0]?.trimEnd();
    return line ? line : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------

/**
 * Los datos de la línea para un directorio. Sin base de Estela no se crea
 * ninguna: la status line no es quien debe empezar a guardar datos.
 */
export function computeStatus(input: StatusInput, dbPath: string, now: Date): StatusData {
  const sinProyecto = (root: string | null): StatusData => ({
    project: null, unassignedRoot: root, todaySeconds: 0, projectShare: null,
    fiveHour: input.fiveHour, sevenDay: input.sevenDay });
  if (!input.dir) return sinProyecto(null);
  if (!existsSync(dbPath)) {
    const root = gitRoot(input.dir);
    return sinProyecto(root ? folderName(root) : null);
  }

  const db = openDatabase(dbPath);
  try {
    // Si `import` o el panel están escribiendo, se espera muy poco y se sigue.
    db.exec("PRAGMA busy_timeout = 50");
    const dir = normalizePath(input.dir);
    // La carpeta, y si no, su raíz git (worktrees, subcarpetas): ver project-of.ts.
    const ownerOf = ownerResolver(db);
    const owner = ownerOf(dir);
    if (owner.kind !== "project") return sinProyecto(owner.kind === "folder" && owner.inGit ? owner.name : null);
    const projectId = owner.projectId;
    const project = store.getProject(db, projectId);
    if (!project) return sinProyecto(null);
    const client = project.kind === "client" ? store.getClient(db, project.clientId) : null;

    const fresh = input.transcriptPath ? readNewTurns(db, dbPath, input.transcriptPath, dir) : [];

    const projectOf = (repo: string | null): string | null => {
      const o = ownerOf(repo);
      return o.kind === "project" ? o.projectId : null;
    };

    // Horas medidas de hoy: lo mismo que hace `import` — sessionize y luego
    // la unión de intervalos por proyecto, día y rama — sobre los turnos de
    // hoy de este proyecto. Solo medidas: nada estimado ni anotado a mano.
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayTurns = merge(store.turnsBetween(db, today, new Date(now.getTime() + 1)), fresh, today, now)
      .filter((t) => projectOf(t.repoPath) === projectId);
    const blocks = groupByBranchAndDay(sessionize(todayTurns), () => projectId);
    const todaySeconds = blocks.reduce((s, b) => s + b.seconds, 0);

    // Parte de la semana: la misma suma de tokens que `estela quota`, solo de
    // Claude Code (Codex gasta otra cuota).
    const monday = weekStart(now);
    const week = merge(store.turnsBetween(db, monday, new Date(now.getTime() + 1)), fresh, monday, now)
      .filter((t) => t.agent === "claude-code");
    const bucketOf = (repo: string | null): QuotaBucket => {
      const p = projectOf(repo);
      return p ? { kind: "project", projectId: p, projectName: p } : { kind: "none" };
    };
    const split = breakdown(week, monday, new Date(now.getTime() + 1), bucketOf);
    const row = split.rows.find((r) => r.bucket.kind === "project" && r.bucket.projectId === projectId);
    const projectShare = split.total.total > 0 ? (row?.share ?? 0) : null;

    return {
      project: { name: project.name, client: client?.name ?? null },
      todaySeconds, projectShare, fiveHour: input.fiveHour, sevenDay: input.sevenDay,
    };
  } finally { db.close(); }
}

/** Los turnos guardados más los recién leídos, sin repetir y dentro del rango. */
function merge(saved: readonly AgentTurn[], fresh: readonly AgentTurn[], from: Date, to: Date): AgentTurn[] {
  const seen = new Set(saved.map((t) => t.turnId));
  return [...saved, ...fresh.filter((t) => !seen.has(t.turnId) && t.at >= from && t.at <= to)]
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ---------------------------------------------------------------------------
// Lectura incremental del transcript de la sesión
// ---------------------------------------------------------------------------

/** Lo más que se lee de un transcript que se ve por primera vez. */
const FIRST_READ_BYTES = 4 * 1024 * 1024;

/**
 * Lee solo lo nuevo del transcript de esta sesión desde la última vez, y lo
 * guarda en la base.
 *
 *  - Se avanza hasta el último salto de línea: Claude Code puede estar
 *    escribiendo la última, y una línea a medias se leerá entera la próxima.
 *  - Si el fichero encoge, se empieza de nuevo.
 *  - La primera vez se leen como mucho los últimos 4 MB: el resto ya lo trajo
 *    `import`, y una sesión larga no puede costar segundos.
 *  - `INSERT OR IGNORE` sobre el `turn_id`: el siguiente `import` no duplica.
 *  - Un turno de scratchpad que no se pudo devolver a su repositorio NO se
 *    guarda: con esa ruta se quedaría así para siempre, porque el `import`
 *    que sí sabría devolverlo ya no podría reescribirlo.
 */
function readNewTurns(db: ReturnType<typeof openDatabase>, dbPath: string, file: string, dir: string): AgentTurn[] {
  const cache = loadCache(dbPath);
  const entry = cache.files[file];
  let fd: number;
  try { fd = openSync(file, "r"); } catch { return []; }
  try {
    const size = fstatSync(fd).size;
    let start = entry && entry.offset <= size ? entry.offset : Math.max(0, size - FIRST_READ_BYTES);
    const midFile = !entry && start > 0;
    if (start >= size) {
      cache.files[file] = { offset: size, seenAt: new Date().toISOString() };
      saveCache(dbPath, cache);
      return [];
    }
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) return [];
    let text = buf.subarray(0, lastNl + 1).toString("utf8");
    // Empezando a mitad de fichero, la primera línea casi seguro está cortada.
    if (midFile) text = text.slice(text.indexOf("\n") + 1);

    const byId = new Map<string, AgentTurn>();
    for (const line of text.split("\n")) {
      const t = parseTranscriptLine(line);
      if (t && typeof t === "object" && !byId.has(t.turnId)) byId.set(t.turnId, t);
    }
    const known = [...store.allProjectRepoPaths(db), dir];
    const turns = resolveScratchpads([...byId.values()], known)
      .filter((t) => !t.repoPath || !isScratchpad(t.repoPath));

    try {
      store.saveTurns(db, turns);
      start += lastNl + 1;
      cache.files[file] = { offset: start, seenAt: new Date().toISOString() };
      saveCache(dbPath, cache);
    } catch {
      // Base ocupada: no se avanza, para volver a intentarlo. Los turnos sirven
      // igual para esta línea, desde la memoria.
    }
    return turns;
  } finally { closeSync(fd); }
}
