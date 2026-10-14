import type { DatabaseSync } from "node:sqlite";

import type { TimeEntry } from "@estela/shared";
import { extractWorkItems, localDate } from "@estela/shared";

import * as store from "../db/store.js";
import { ownerResolver } from "../project-of.js";
import { describeBlock, groupByBranchAndDay, type WorkBlock } from "./sessionize.js";

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
 *  3. Recuperar es opcional (`recover`): la primera vez lo confirma la persona.
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
}

export function entryId(projectId: string, day: string, branch: string | null): string {
  // Determinista (proyecto + día + rama) para que reimportar actualice en vez
  // de duplicar. La fecha, la LOCAL: la misma que usa el servidor.
  const slug = (branch ?? "sin-rama").replace(/[^a-zA-Z0-9]+/g, "-");
  return `te_${projectId}_${day}_${slug}`;
}

export function planEntries(
  db: DatabaseSync, raw: readonly WorkBlock[], options: { readonly recover: boolean },
): AssignmentPlan {
  const ownerOf = ownerResolver(db);
  const direct = (repo: string | null) => (repo ? store.projectForRepo(db, repo) : null);
  const viaRoot = (repo: string | null) => {
    if (!repo) return null;
    const o = ownerOf(repo);
    return o.kind === "project" ? o.projectId : null;
  };

  // Lo de siempre: la carpeta tal cual. Se agrupa por PROYECTO, no por ruta:
  // `repo/` y `repo/src/UI` son el mismo proyecto, y agrupar por ruta daba dos
  // bloques que luego se pisaban al guardarse con el mismo id.
  const keyDirect = (b: { repoPath: string | null }) => direct(b.repoPath) ?? b.repoPath ?? "";
  const groupedBase = groupByBranchAndDay(raw, keyDirect);
  const base = byId(groupedBase, direct);

  if (!options.recover) {
    return {
      entries: [...base.values()].map((g) => ({ entry: toEntry(db, g.projectId, g.block), recoveredSeconds: 0 })),
      grouped: groupedBase.length,
      unassigned: groupedBase.filter((b) => !direct(b.repoPath)).length,
      recovered: new Map(), blocked: [],
    };
  }

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

  const entries: PlannedEntry[] = [];
  const recovered = new Map<string, number>();
  const blocked: RecoveryBlocked[] = [];
  for (const [id, g] of full) {
    const before = base.get(id);
    if (!touched.has(id)) { entries.push({ entry: toEntry(db, g.projectId, g.block), recoveredSeconds: 0 }); continue; }
    const gain = Math.max(0, g.block.seconds - (before?.block.seconds ?? 0));
    const day = localDate(g.block.startedAt);
    if (locked(g.projectId, day)) {
      // Regla 2: el día se queda como estaba; si antes no había nada, nada.
      if (before) entries.push({ entry: toEntry(db, before.projectId, before.block), recoveredSeconds: 0 });
      if (gain > 0) blocked.push({ projectId: g.projectId, day, seconds: gain });
      continue;
    }
    entries.push({ entry: toEntry(db, g.projectId, g.block), recoveredSeconds: gain });
    if (gain > 0) recovered.set(g.projectId, (recovered.get(g.projectId) ?? 0) + gain);
  }
  return {
    entries, grouped: groupedFull.length,
    unassigned: groupedFull.filter((b) => !assigned(b.repoPath)).length,
    recovered, blocked,
  };
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
