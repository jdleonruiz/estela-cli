import type { DatabaseSync } from "node:sqlite";

import type { AgentTurn, CommitRecord, TimeEntry } from "@estela/shared";
import { extractWorkItems, localDate } from "@estela/shared";

import * as store from "../db/store.js";
import { gitRoot, ownerResolver } from "../project-of.js";
import { describeBlock, groupByBranchAndDay, sessionize, sessionizeCommits, withoutOverlap,
         type WorkBlock } from "./sessionize.js";

/**
 * De bloques de trabajo a imputaciones: a qué proyecto va cada uno y con qué
 * id se guarda. Lo usan `estela import` y el import automático del panel, que
 * antes lo tenían copiado cada uno por su lado.
 *
 * La raíz git (worktrees, subcarpetas de un repo sin la carpeta exacta
 * registrada) recupera horas que antes se perdían, con tres reglas:
 *
 *  1. Solo se reasigna lo que hoy NO tiene proyecto. La carpeta tal cual se
 *     mira primero, así que nada de lo ya asignado cambia de proyecto.
 *  2. Un día aprobado o facturado de ese proyecto no se toca: las horas que se
 *     recuperarían ahí se informan (`blocked`), no se aplican.
 *
 * Y dos ramas a la vez en el mismo proyecto no suman dos horas por cada hora de
 * reloj: lo que registra Estela es tiempo real, y ese rato se reparte entre
 * ellas (ver `sharedSeconds`). Cobrar un precio pactado por encima de lo medido
 * es un ajuste a mano con su motivo, que conserva lo medido al lado.
 */

export interface PlannedEntry {
  readonly entry: Omit<TimeEntry, "id"> & { id: string };
  /** Segundos que esta imputación gana por la raíz git (0 si no cambia). */
  readonly recoveredSeconds: number;
}

export interface RecoveryBlocked {
  readonly projectId: string;
  readonly day: string;
  readonly seconds: number;
}

export interface AssignmentPlan {
  readonly entries: readonly PlannedEntry[];
  /** Bloques tras agrupar por rama y día, con y sin proyecto. */
  readonly grouped: number;
  /** De esos, los que siguen sin proyecto. */
  readonly unassigned: number;
  /** Segundos recuperados que SÍ se aplican, por proyecto. */
  readonly recovered: ReadonlyMap<string, number>;
  /** Lo que se recuperaría en días aprobados o facturados: no se aplica. */
  readonly blocked: readonly RecoveryBlocked[];
  /** Imputaciones sin horas propias y sin revisar: se retiran. */
  readonly stale: readonly string[];
  /** Las mismas, pero aprobadas, ajustadas o facturadas: no se tocan, se avisa. */
  readonly protectedDuplicates: readonly string[];
}

export function entryId(projectId: string, day: string, branch: string | null): string {
  // Determinista (proyecto + día + rama) para que reimportar actualice en vez
  // de duplicar. La fecha, la LOCAL: la misma que usa el servidor.
  return `te_${projectId}_${day}_${branchSlug(branch)}`;
}

function branchSlug(branch: string | null): string {
  return (branch ?? "sin-rama").replace(/[^a-zA-Z0-9]+/g, "-");
}

/**
 * Los bloques deducidos solo de commits: los que no se solapan con ninguna
 * sesión de agente, tampoco con las que ya no están en el disco.
 *
 * Claude Code limpia sus transcripts antiguos, así que lo escaneado no es todo
 * lo que hubo. Comparar solo con eso convertía los commits de esas sesiones en
 * trabajo sin agente, y sumaba horas estimadas a un trabajo ya medido. La base
 * guarda todos los turnos: `saveTurns` no borra nada.
 *
 * `git log --all` desde un worktree trae la historia entera del repo, así que
 * cada commit queda guardado también bajo la ruta del worktree. Por eso se
 * compara por raíz git: sin ella, esa copia no la tapa ninguna sesión del repo
 * y, al recuperar, sumaba horas estimadas a días ya medidos.
 */
export function commitOnlyBlocks(
  db: DatabaseSync, commits: readonly CommitRecord[], agentBlocks: readonly WorkBlock[],
): WorkBlock[] {
  const saved = sessionize(store.turnsBetween(db, new Date(0), new Date("9999-12-31")));
  const roots = new Map<string, string>();
  const rootOf = (path: string) => {
    let root = roots.get(path);
    if (root === undefined) {
      root = gitRoot(path) ?? path;
      roots.set(path, root);
    }
    return root;
  };
  return withoutOverlap(sessionizeCommits(commits), [...agentBlocks, ...saved], rootOf);
}

/**
 * Todos los turnos conocidos: los de la base más los recién leídos.
 *
 * Una imputación se reescribe entera, así que hay que calcularla con todo lo
 * que hubo ese día. Con solo lo leído del disco, un transcript que Claude Code
 * ya limpió (o un `--since`) dejaba 4 h medidas convertidas en los 25 min del
 * único commit que quedaba. Lo recién leído manda porque el lector sabe cosas
 * que la base no: `saveTurns` no reescribe un turno ya guardado, y una versión
 * nueva puede devolverlo a su carpeta real.
 */
export function knownTurns(db: DatabaseSync, scanned: readonly AgentTurn[]): AgentTurn[] {
  const byId = new Map(store.turnsBetween(db, new Date(0), new Date("9999-12-31")).map((t) => [t.turnId, t]));
  for (const turn of scanned) byId.set(turn.turnId, turn);
  return [...byId.values()];
}

/**
 * Imputaciones guardadas que ya no salen en el plan y cuyas horas están dentro
 * de otras del mismo proyecto.
 *
 * El id lleva la rama, y la rama de un bloque es la de su último turno: si la
 * sesión sigue en otra rama, la siguiente importación crea otra imputación con
 * el bloque entero y la anterior se quedaba, cobrando dos veces el mismo rato.
 *
 * Retirar horas es peor que no hacerlo si se acierta mal, así que se exige todo:
 *
 *  - Ningún bloque de ese día lleva esa rama, tenga proyecto o no. Si lo lleva,
 *    esas horas siguen existiendo, como las de un worktree ya borrado.
 *  - Los bloques del proyecto cubren lo que dice la imputación, en su horario.
 *    Si no, son horas de las que no queda otro rastro.
 *
 * Lo aprobado, ajustado o facturado no se retira nunca: solo se avisa.
 */
function findDuplicates(
  db: DatabaseSync, raw: readonly WorkBlock[], planned: ReadonlySet<string>,
  projectOf: (repo: string | null) => string | null,
): { stale: string[]; protectedDuplicates: string[] } {
  const rows = db.prepare(
    `SELECT id, project_id, local_date, branch, started_at, ended_at, seconds, approved, invoice_id, adjust_reason
       FROM time_entries WHERE source IN ('agent', 'commit')`).all() as Record<string, unknown>[];
  const stale: string[] = [];
  const protectedDuplicates: string[] = [];
  const blocksByDay = new Map<string, WorkBlock[]>();
  for (const block of raw) {
    const day = localDate(block.startedAt);
    const bucket = blocksByDay.get(day);
    if (bucket) bucket.push(block);
    else blocksByDay.set(day, [block]);
  }

  for (const row of rows) {
    if (planned.has(row["id"] as string)) continue;
    const day = blocksByDay.get(row["local_date"] as string) ?? [];
    const slug = branchSlug((row["branch"] as string | null) ?? null);
    if (day.some((b) => branchSlug(b.branch) === slug)) continue;

    const from = new Date(row["started_at"] as string).getTime();
    const to = new Date(row["ended_at"] as string).getTime();
    const covered = coveredMs(day.filter((b) => projectOf(b.repoPath) === row["project_id"]), from, to) / 1000;
    if (covered < (row["seconds"] as number) - 60) continue;

    const locked = row["approved"] === 1 || row["invoice_id"] !== null || row["adjust_reason"] !== null;
    (locked ? protectedDuplicates : stale).push(row["id"] as string);
  }
  return { stale, protectedDuplicates };
}

/** Cuánto de [from, to] cae dentro de los bloques, sin contar dos veces un solape. */
function coveredMs(blocks: readonly WorkBlock[], from: number, to: number): number {
  const intervals = blocks
    .map((b) => [Math.max(b.startedAt.getTime(), from), Math.min(b.endedAt.getTime(), to)] as const)
    .sort((a, b) => a[0] - b[0]);
  let ms = 0;
  let until = from;
  for (const [start, end] of intervals) {
    const desde = Math.max(start, until);
    if (end > desde) ms += end - desde;
    until = Math.max(until, end);
  }
  return ms;
}

export function planEntries(db: DatabaseSync, raw: readonly WorkBlock[]): AssignmentPlan {
  const ownerOf = ownerResolver(db);
  const direct = (repo: string | null) => (repo ? store.projectForRepo(db, repo) : null);
  const viaRoot = (repo: string | null) => {
    if (!repo) return null;
    const o = ownerOf(repo);
    return o.kind === "project" ? o.projectId : null;
  };

  // La carpeta tal cual. Se agrupa por PROYECTO, no por ruta: `repo/` y
  // `repo/src/UI` son el mismo proyecto, y agrupar por ruta daba dos bloques que
  // luego se pisaban al guardarse con el mismo id.
  const keyDirect = (b: { repoPath: string | null }) => direct(b.repoPath) ?? b.repoPath ?? "";
  const base = byId(groupByBranchAndDay(raw, keyDirect), direct);

  // Con la raíz git, pero solo para lo que no tenía proyecto (regla 1).
  const assigned = (repo: string | null) => direct(repo) ?? viaRoot(repo);
  const keyFull = (b: { repoPath: string | null }) => assigned(b.repoPath) ?? b.repoPath ?? "";
  const groupedFull = groupByBranchAndDay(raw, keyFull);
  const full = byId(groupedFull, assigned);

  // Qué imputaciones cambian: las que reciben algún bloque recuperado.
  const touched = new Set<string>();
  for (const b of raw) {
    if (direct(b.repoPath)) continue;
    const p = viaRoot(b.repoPath);
    if (p) touched.add(entryId(p, localDate(b.startedAt), b.branch));
  }

  const lockedDays = new Map<string, boolean>();
  const locked = (projectId: string, day: string) => {
    const k = `${projectId}\0${day}`;
    if (!lockedDays.has(k)) {
      lockedDays.set(k, !!db.prepare(
        `SELECT 1 FROM time_entries WHERE project_id = ? AND local_date = ?
           AND (approved = 1 OR invoice_id IS NOT NULL) LIMIT 1`).get(projectId, day));
    }
    return lockedDays.get(k)!;
  };

  // Primero qué filas quedan y con qué bloques, y después el reparto: una sesión
  // que la regla 2 deja fuera no puede restarle tiempo a la que sí cuenta.
  const rows: PlannedRow[] = [];
  const blocked: RecoveryBlocked[] = [];
  const rawByProject = (projectOf: (repo: string | null) => string | null) => {
    const out = new Map<string, WorkBlock[]>();
    for (const b of raw) {
      const p = projectOf(b.repoPath);
      if (!p) continue;
      const id = entryId(p, localDate(b.startedAt), b.branch);
      const bucket = out.get(id);
      if (bucket) bucket.push(b);
      else out.set(id, [b]);
    }
    return out;
  };
  const fullBlocks = rawByProject(assigned);
  const directBlocks = rawByProject(direct);

  for (const [id, g] of full) {
    const before = base.get(id);
    const day = localDate(g.block.startedAt);
    if (touched.has(id) && locked(g.projectId, day)) {
      // Regla 2: el día se queda como estaba; si antes no había nada, nada.
      if (before) rows.push({ id, projectId: before.projectId, block: before.block, blocks: directBlocks.get(id) ?? [], before: null });
      const gain = Math.max(0, g.block.seconds - (before?.block.seconds ?? 0));
      if (gain > 0) blocked.push({ projectId: g.projectId, day, seconds: gain });
      continue;
    }
    rows.push({ id, projectId: g.projectId, block: g.block, blocks: fullBlocks.get(id) ?? [],
      before: touched.has(id) ? (before?.block.seconds ?? 0) : null });
  }

  const shares = sharedSeconds(rows, lockedEntryIds(db));
  const entries: PlannedEntry[] = [];
  const recovered = new Map<string, number>();
  const empty: string[] = [];
  for (const row of rows) {
    const seconds = shares.get(row.id) ?? row.block.seconds;
    if (seconds <= 0) { empty.push(row.id); continue; }
    const gain = row.before === null ? 0 : Math.max(0, seconds - row.before);
    entries.push({ entry: toEntry(db, row.projectId, { ...row.block, seconds }), recoveredSeconds: gain });
    if (gain > 0) recovered.set(row.projectId, (recovered.get(row.projectId) ?? 0) + gain);
  }

  const duplicates = findDuplicates(db, raw, new Set(entries.map((e) => e.entry.id)), assigned);
  return {
    entries, grouped: groupedFull.length,
    unassigned: groupedFull.filter((b) => !assigned(b.repoPath)).length,
    recovered, blocked,
    stale: [...duplicates.stale, ...empty],
    protectedDuplicates: duplicates.protectedDuplicates,
  };
}

interface PlannedRow {
  readonly id: string;
  readonly projectId: string;
  /** El bloque ya agrupado por rama y día. */
  readonly block: WorkBlock;
  /** Los bloques sueltos que lo forman: sus horarios son los que se reparten. */
  readonly blocks: readonly WorkBlock[];
  /** Segundos antes de recuperar, o null si esta fila no recupera nada. */
  readonly before: number | null;
}

/** Las imputaciones cuya cifra ya no puede cambiar. */
function lockedEntryIds(db: DatabaseSync): Set<string> {
  const rows = db.prepare(
    "SELECT id FROM time_entries WHERE approved = 1 OR invoice_id IS NOT NULL").all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/**
 * Los segundos de cada imputación cuando varias ramas del mismo proyecto
 * coinciden en el reloj: el rato compartido se reparte a partes iguales, y el
 * total del proyecto es el tiempo real.
 *
 * Dos chats en dos worktrees durante una hora son una hora de quien trabaja, no
 * dos. Proyectos distintos no se reparten entre sí: esa decisión es por cliente.
 *
 * Lo aprobado o facturado ya tiene su cifra y no cambia, así que el rato que
 * cubre ya está cobrado o dado por bueno: las demás no reciben nada de él.
 */
function sharedSeconds(rows: readonly PlannedRow[], lockedIds: ReadonlySet<string>): Map<string, number> {
  const byProject = new Map<string, PlannedRow[]>();
  for (const row of rows) {
    const bucket = byProject.get(row.projectId);
    if (bucket) bucket.push(row);
    else byProject.set(row.projectId, [row]);
  }

  const ms = new Map<string, number>();
  for (const projectRows of byProject.values()) {
    const events: { at: number; id: string; delta: 1 | -1 }[] = [];
    for (const row of projectRows) {
      for (const b of row.blocks) {
        events.push({ at: b.startedAt.getTime(), id: row.id, delta: 1 });
        events.push({ at: b.endedAt.getTime(), id: row.id, delta: -1 });
      }
    }
    events.sort((a, b) => a.at - b.at);

    const active = new Map<string, number>();
    let previous = events[0]?.at ?? 0;
    for (const event of events) {
      if (event.at > previous && active.size > 0) {
        const span = event.at - previous;
        const ids = [...active.keys()];
        const lockedHere = ids.filter((id) => lockedIds.has(id));
        const payees = lockedHere.length ? lockedHere : ids;
        const share = lockedHere.length ? span : span / ids.length;
        for (const id of payees) ms.set(id, (ms.get(id) ?? 0) + share);
      }
      previous = event.at;
      const count = (active.get(event.id) ?? 0) + event.delta;
      if (count > 0) active.set(event.id, count);
      else active.delete(event.id);
    }
  }

  const seconds = new Map<string, number>();
  for (const row of rows) seconds.set(row.id, Math.round((ms.get(row.id) ?? 0) / 1000));
  return seconds;
}

/** Los bloques agrupados con proyecto, por el id con el que se guardarían. */
function byId(
  blocks: readonly WorkBlock[], projectOf: (repo: string | null) => string | null,
): Map<string, { projectId: string; block: WorkBlock }> {
  const out = new Map<string, { projectId: string; block: WorkBlock }>();
  for (const block of blocks) {
    const projectId = projectOf(block.repoPath);
    if (!projectId) continue;
    out.set(entryId(projectId, localDate(block.startedAt), block.branch), { projectId, block });
  }
  return out;
}

function toEntry(db: DatabaseSync, projectId: string, block: WorkBlock): Omit<TimeEntry, "id"> & { id: string } {
  const project = store.getProject(db, projectId)!;
  return {
    id: entryId(projectId, localDate(block.startedAt), block.branch),
    projectId,
    startedAt: block.startedAt,
    endedAt: block.endedAt,
    seconds: block.seconds,
    description: describeBlock(block),
    billable: project.billable,
    invoiceId: null,
    aiCost: block.aiCost,
    // Un bloque deducido solo de commits no tuvo agente: ni segundos de
    // agente ni agente al que atribuirlos.
    agentSeconds: block.turnCount > 0 ? block.seconds : 0,
    commitHashes: block.commits.map((c) => c.hash),
    agents: block.turnCount > 0 ? [...(block.agents ?? ["claude-code"])] : [],
    source: block.turnCount > 0 ? "agent" : "commit",
    kind: "development",
    branch: block.branch,
    // El ticket se saca aquí: en la base solo quedan los hashes de los
    // commits, y es en sus mensajes donde va el `AB#1234`.
    workItems: extractWorkItems(block.branch, block.commits.map((c) => c.subject), project.tracker),
  };
}
