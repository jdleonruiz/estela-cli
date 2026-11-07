import type { AiCost, AgentKind, Money, Subscription } from "@estela/shared";
import { localDate } from "@estela/shared";

import { monthOf } from "../billing/amortize.js";
import { realFromMonths } from "./spend.js";

/**
 * Gasto de IA sin entrega: lo que no ha llegado (todavía) a la rama principal.
 *
 * Es una señal para revisar, no un juicio. Explorar, probar y descartar es
 * trabajo, y una sesión en la que Claude cambia algo cinco veces antes de que
 * lo des por bueno vale lo mismo aunque aún no tenga commit. Por eso nada de
 * esto resta horas ni toca imputaciones: solo pone una cifra al lado.
 *
 * Se mide sobre los turnos, no sobre las imputaciones: una sesión es un rato
 * de un chat, y una imputación es un día de una rama que puede juntar varias.
 * Dos bloques que no se pisan:
 *
 *  1. Sesiones sin commit: un rato de trabajo de un chat (sin pausas de más de
 *     30 min) en el que no hiciste ningún commit en ese repo, ni en los 30 min
 *     siguientes. Se separan las que luego sí tuvieron commit en su rama. Las
 *     anteriores a tu primer commit conocido en el repo no se juzgan: quizá
 *     commiteabas con otro correo.
 *  2. Ramas sin fusionar: el resto del coste de una rama que sigue existiendo,
 *     no está integrada y lleva N días sin actividad. Una rama borrada sin
 *     merge registrado puede ser un squash: su estado es "desconocido" y no
 *     cuenta, porque contarla inflaría la cifra.
 */

export interface UndeliveredTurn {
  readonly projectId: string;
  readonly sessionId: string;
  readonly at: Date;
  /** Raíz git (el repo principal, también para un worktree). */
  readonly root: string;
  readonly branch: string | null;
  readonly microUsd: number;
  readonly agent: AgentKind;
}

/** Un commit tuyo, con su raíz git ya resuelta igual que la de los turnos. */
export interface CommitFact {
  readonly root: string;
  readonly at: Date;
  readonly branch: string | null;
}

export interface BranchFacts {
  /** Integrada: la rama base, `git branch --merged` o un commit de merge. */
  readonly merged: boolean;
  /** `null` si el repo ya no se puede leer: no se sabe. */
  readonly exists: boolean | null;
}

export interface UndeliveredInput {
  readonly turns: readonly UndeliveredTurn[];
  readonly commits: readonly CommitFact[];
  readonly branchFacts: (root: string, branch: string) => BranchFacts;
  readonly staleDays: number;
  readonly now: Date;
  /** Fechas locales; sin ellas, todo. Se mira la fecha de inicio de la sesión. */
  readonly from?: string;
  readonly to?: string;
  readonly subscriptions: readonly Subscription[];
  readonly monthTotals: ReadonlyMap<string, AiCost>;
}

export interface Spend {
  readonly consumption: AiCost;
  readonly real: Money | null;
  readonly realPartial: boolean;
}

export type BranchState = "unmerged" | "open" | "unknown";

export interface BranchLine extends Spend {
  readonly branch: string;
  readonly state: BranchState;
  /** Días desde la última actividad (turno o commit) en la rama. */
  readonly idleDays: number;
}

export interface UndeliveredReport {
  readonly projectId: string;
  /** Todo el gasto del periodo en el proyecto: la base del porcentaje. */
  readonly total: Spend;
  /**
   * Sesiones sin commit que no se pueden juzgar: no se conoce ningún commit tuyo
   * en ese repo, o la sesión es anterior al primero. Puede ser que commitearas
   * con otro correo (ver `estela author`), así que no cuentan.
   */
  readonly unverifiable: Spend & { readonly count: number };
  readonly sessionsWithoutCommit: Spend & {
    readonly count: number;
    /** De ellas, las que luego tuvieron commit en su rama (dentro de N días). */
    readonly laterCommitted: Spend & { readonly count: number };
  };
  /** Ramas que cuentan: sin fusionar tras N días. */
  readonly unmerged: Spend & { readonly branches: readonly BranchLine[] };
  /** No cuentan: abiertas hace menos de N días, o de estado desconocido. */
  readonly notCounted: readonly BranchLine[];
  /** Suma de los dos bloques que cuentan. */
  readonly undelivered: Spend;
  readonly unpricedAgents: boolean;
}

/** El mismo hueco que separa bloques de trabajo (ver sessionize). */
const GAP_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
const UNPRICED_AGENTS = new Set<AgentKind>(["copilot"]);

/** Ramas donde se integra: trabajar directamente en ellas ya es entregar. */
export const BASE_BRANCHES = new Set(["main", "master", "develop", "trunk"]);

export function undeliveredSpend(input: UndeliveredInput): UndeliveredReport[] {
  const byProject = new Map<string, UndeliveredTurn[]>();
  for (const t of input.turns) {
    const list = byProject.get(t.projectId) ?? [];
    list.push(t);
    byProject.set(t.projectId, list);
  }

  const reports: UndeliveredReport[] = [];
  for (const [projectId, turns] of byProject) {
    const report = projectReport(projectId, turns, input);
    if (report.total.consumption.microUsd > 0 || report.unpricedAgents) reports.push(report);
  }
  return reports.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

interface Sitting {
  readonly turns: UndeliveredTurn[];
  readonly root: string;
}

function projectReport(projectId: string, all: UndeliveredTurn[], input: UndeliveredInput): UndeliveredReport {
  const inPeriod = (d: Date) => {
    const day = localDate(d);
    return (!input.from || day >= input.from) && (!input.to || day <= input.to);
  };
  const spend = new SpendAcc(input);

  // Ratos de cada chat: mismo session_id y repo, cortados por pausas largas.
  const sittings: Sitting[] = [];
  const bySession = new Map<string, UndeliveredTurn[]>();
  for (const t of all) {
    const key = `${t.sessionId}\0${t.root}`;
    const list = bySession.get(key) ?? [];
    list.push(t);
    bySession.set(key, list);
  }
  for (const list of bySession.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let current: UndeliveredTurn[] = [];
    for (const t of list) {
      const last = current[current.length - 1];
      if (last && t.at.getTime() - last.at.getTime() > GAP_MS) {
        sittings.push({ turns: current, root: last.root });
        current = [];
      }
      current.push(t);
    }
    if (current.length) sittings.push({ turns: current, root: current[0]!.root });
  }

  // El primer commit tuyo de cada repo: antes de él, no hay con qué comparar.
  const firstCommit = new Map<string, number>();
  for (const c of input.commits) {
    firstCommit.set(c.root, Math.min(firstCommit.get(c.root) ?? Infinity, c.at.getTime()));
  }

  const total = spend.empty();
  const unverifiable = spend.empty();
  let unverifiableCount = 0;
  const noCommit = spend.empty();
  const later = spend.empty();
  let noCommitCount = 0;
  let laterCount = 0;
  const counted = new Set<UndeliveredTurn>();

  for (const s of sittings) {
    const first = s.turns[0]!;
    if (!inPeriod(first.at)) continue;
    for (const t of s.turns) spend.add(total, t);

    const start = first.at.getTime();
    const end = s.turns[s.turns.length - 1]!.at.getTime();
    const committed = input.commits.some((c) =>
      c.root === s.root && c.at.getTime() >= start && c.at.getTime() <= end + GAP_MS);
    if (committed) continue;
    if (start < (firstCommit.get(s.root) ?? Infinity)) {
      unverifiableCount++;
      for (const t of s.turns) { spend.add(unverifiable, t); counted.add(t); }
      continue;
    }

    noCommitCount++;
    for (const t of s.turns) { spend.add(noCommit, t); counted.add(t); }
    const branches = new Set(s.turns.map((t) => t.branch).filter((b): b is string => !!b));
    const afterwards = input.commits.some((c) => c.root === s.root && c.branch !== null
      && branches.has(c.branch) && c.at.getTime() > end && c.at.getTime() <= end + input.staleDays * DAY_MS);
    if (afterwards) {
      laterCount++;
      for (const t of s.turns) spend.add(later, t);
    }
  }

  // Ramas: el coste que no está ya en una sesión sin commit.
  const lastActivity = new Map<string, number>();
  const touch = (root: string, branch: string, at: Date) => {
    const k = `${root}\0${branch}`;
    lastActivity.set(k, Math.max(lastActivity.get(k) ?? 0, at.getTime()));
  };
  for (const t of all) if (t.branch) touch(t.root, t.branch, t.at);
  const roots = new Set(all.map((t) => t.root));
  for (const c of input.commits) if (c.branch && roots.has(c.root)) touch(c.root, c.branch, c.at);

  const lines = new Map<string, { branch: string; root: string; acc: Acc }>();
  for (const s of sittings) {
    if (!inPeriod(s.turns[0]!.at)) continue;
    for (const t of s.turns) {
      if (counted.has(t) || !t.branch || t.branch === "HEAD" || BASE_BRANCHES.has(t.branch)) continue;
      const k = `${t.root}\0${t.branch}`;
      let line = lines.get(k);
      if (!line) { line = { branch: t.branch, root: t.root, acc: spend.empty() }; lines.set(k, line); }
      spend.add(line.acc, t);
    }
  }

  const unmergedAcc = spend.empty();
  const unmergedLines: BranchLine[] = [];
  const notCounted: BranchLine[] = [];
  for (const [k, { branch, root, acc }] of lines) {
    const facts = input.branchFacts(root, branch);
    if (facts.merged) continue;
    const idleDays = Math.floor((input.now.getTime() - (lastActivity.get(k) ?? 0)) / DAY_MS);
    const state: BranchState = facts.exists !== true ? "unknown" : idleDays >= input.staleDays ? "unmerged" : "open";
    const line = { branch, state, idleDays, ...spend.finish(acc) };
    if (state === "unmerged") {
      unmergedLines.push(line);
      spend.merge(unmergedAcc, acc);
    } else {
      notCounted.push(line);
    }
  }
  const byCost = (a: BranchLine, b: BranchLine) => b.consumption.microUsd - a.consumption.microUsd;

  const undelivered = spend.empty();
  spend.merge(undelivered, noCommit);
  spend.merge(undelivered, unmergedAcc);

  return {
    projectId,
    total: spend.finish(total),
    unverifiable: { ...spend.finish(unverifiable), count: unverifiableCount },
    sessionsWithoutCommit: {
      ...spend.finish(noCommit), count: noCommitCount,
      laterCommitted: { ...spend.finish(later), count: laterCount },
    },
    unmerged: { ...spend.finish(unmergedAcc), branches: unmergedLines.sort(byCost) },
    notCounted: notCounted.sort(byCost),
    undelivered: spend.finish(undelivered),
    unpricedAgents: total.unpriced,
  };
}

// ---------------------------------------------------------------------------

interface Acc { microUsd: number; byMonth: Map<string, number>; unpriced: boolean }

/** Suma coste por mes, para repartir la cuota igual que `ai-cost`. */
class SpendAcc {
  constructor(private readonly input: UndeliveredInput) {}

  empty(): Acc { return { microUsd: 0, byMonth: new Map(), unpriced: false }; }

  add(acc: Acc, t: UndeliveredTurn): void {
    acc.microUsd += t.microUsd;
    const month = monthOf(t.at);
    acc.byMonth.set(month, (acc.byMonth.get(month) ?? 0) + t.microUsd);
    if (UNPRICED_AGENTS.has(t.agent)) acc.unpriced = true;
  }

  merge(into: Acc, from: Acc): void {
    into.microUsd += from.microUsd;
    for (const [m, v] of from.byMonth) into.byMonth.set(m, (into.byMonth.get(m) ?? 0) + v);
    into.unpriced ||= from.unpriced;
  }

  finish(acc: Acc): Spend {
    const { real, partial } = realFromMonths(acc.byMonth, this.input.subscriptions,
      (month) => this.input.monthTotals.get(month)?.microUsd ?? 0);
    return { consumption: { microUsd: acc.microUsd }, real, realPartial: partial };
  }
}

/** El porcentaje de una parte sobre el total, en tanto por ciento. `null` sin total. */
export function shareOf(part: Spend, total: Spend): number | null {
  return total.consumption.microUsd === 0 ? null : (part.consumption.microUsd / total.consumption.microUsd) * 100;
}

