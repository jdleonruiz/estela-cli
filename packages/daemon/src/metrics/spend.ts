import type { AiCost, Money, Subscription, TimeEntry, WorkItemTracker } from "@estela/shared";
import { extractWorkItems, money } from "@estela/shared";

import { feeForMonth, monthOf } from "../billing/amortize.js";
import { tr } from "../i18n/index.js";
import { isSameOrInside } from "../paths.js";
import type { MergeRecord } from "../watchers/git.js";

/**
 * Coste de IA por entrega: por rama, o por ticket y PR.
 *
 * Función pura sobre las imputaciones ya guardadas, no sobre los turnos: así
 * las cifras cuadran con `estela ai-cost` y con las facturas, y un día
 * aprobado o facturado se lee tal cual quedó, sin recalcular nada.
 *
 * Nada se reparte a ojo. Una imputación ya es de una sola rama (la sesión que
 * cambia de rama queda partida turno a turno al importar). Lo que no tiene
 * rama, o con --by item no tiene ticket ni PR, va a "sin atribuir". Y cada
 * atribución dice en qué se basa, porque no todas valen lo mismo: la rama que
 * anotó el agente es un hecho; la de un commit sin agente la deduce git.
 */

export type SpendBy = "branch" | "item";

/** De dónde sale una atribución. */
export type Basis =
  /** La rama que anotó el agente en el transcript. */
  | "agent-branch"
  /** La rama que git asocia al commit (--source): aproximada. */
  | "commit-branch"
  /** El número de ticket en el nombre de la rama. */
  | "branch-name"
  /** `#12`, `AB#12` o `PROJ-12` en un mensaje de commit. */
  | "commit-message"
  /** Puesto a mano con `estela entry link`. */
  | "manual"
  /** El commit de merge del PR ("Merge pull request #12 from …"). */
  | "merge";

export interface SpendProject {
  readonly id: string;
  readonly name: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly repoPaths: readonly string[];
  readonly tracker?: WorkItemTracker | null;
}

export interface SpendUnit {
  /** Rama o tickets; `null` es "sin atribuir". */
  readonly key: string | null;
  readonly branches: readonly string[];
  /** Tickets (`github:12`, `jira:PROJ-4`) y PRs (`github:30` del merge). */
  readonly items: readonly string[];
  readonly prs: readonly string[];
  readonly basis: readonly Basis[];
  readonly seconds: number;
  /** A precio de API: medida de uso, no dinero pagado. */
  readonly consumption: AiCost;
  /** La cuota repartida por consumo. `null` sin suscripción registrada. */
  readonly real: Money | null;
  /** Algún mes del bloque no tenía suscripción: `real` cuenta solo el resto. */
  readonly realPartial: boolean;
  /** Hay trabajo de un agente sin coste conocido (Copilot): el coste se queda corto. */
  readonly unpricedAgents: boolean;
}

export interface SpendProjectReport {
  readonly project: SpendProject;
  readonly units: readonly SpendUnit[];
  readonly total: Omit<SpendUnit, "key" | "branches" | "items" | "prs" | "basis">;
}

export interface SpendInput {
  readonly entries: readonly TimeEntry[];
  readonly projects: readonly SpendProject[];
  readonly merges: readonly MergeRecord[];
  readonly subscriptions: readonly Subscription[];
  /** Consumo de toda la máquina por mes: el denominador de la cuota (ver amortize). */
  readonly monthTotals: ReadonlyMap<string, AiCost>;
}

/** Agentes cuyo transcript no trae tokens: su trabajo cuenta horas pero no coste. */
const UNPRICED_AGENTS = new Set(["copilot"]);

export function spendByUnit(input: SpendInput, by: SpendBy): SpendProjectReport[] {
  const reports: SpendProjectReport[] = [];
  // Como en `amortize`: el denominador nunca baja de lo imputado ese mes, o un
  // mes sin turnos guardados le daría la cuota entera a cada unidad.
  const assignedByMonth = new Map<string, number>();
  for (const e of input.entries) {
    const month = monthOf(e.startedAt);
    assignedByMonth.set(month, (assignedByMonth.get(month) ?? 0) + e.aiCost.microUsd);
  }

  for (const project of input.projects) {
    const entries = input.entries.filter((e) => e.projectId === project.id);
    if (entries.length === 0) continue;
    const prsByBranch = mergedPrs(input.merges, project.repoPaths);

    const groups = new Map<string, Acc>();
    for (const entry of entries) {
      const a = attribute(entry, project.tracker ?? null, prsByBranch);
      const key = by === "branch" ? entry.branch : a.items.length ? a.items.join(",") : null;
      const id = key ?? "\u0000";
      let acc = groups.get(id);
      if (!acc) { acc = newAcc(key); groups.set(id, acc); }
      add(acc, entry, a, by);
    }

    const units = [...groups.values()].map((acc) => finish(acc, input, assignedByMonth));
    units.sort((x, y) => (x.key === null ? 1 : 0) - (y.key === null ? 1 : 0)
      || y.consumption.microUsd - x.consumption.microUsd || y.seconds - x.seconds);

    reports.push({ project, units, total: sumUnits(units) });
  }
  return reports;
}

// ---------------------------------------------------------------------------

interface Attribution {
  readonly items: string[];
  readonly prs: string[];
  readonly itemBasis: Basis[];
}

/** PRs fusionados por rama, de los merges de los repos del proyecto. */
function mergedPrs(merges: readonly MergeRecord[], repos: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of merges) {
    if (!m.sourceBranch || !m.ref) continue;
    if (!repos.some((r) => isSameOrInside(m.repoPath, r) || isSameOrInside(r, m.repoPath))) continue;
    const list = out.get(m.sourceBranch) ?? [];
    if (!list.includes(m.ref)) list.push(m.ref);
    out.set(m.sourceBranch, list);
  }
  return out;
}

/**
 * Los tickets de una imputación y en qué se basan. Primero los que ya tiene
 * (rama, commits o a mano); si no tiene ninguno, el PR con que se fusionó su
 * rama. Un PR no sustituye a un ticket que ya se conoce: son cosas distintas.
 */
function attribute(
  entry: TimeEntry, tracker: WorkItemTracker | null, prsByBranch: Map<string, string[]>,
): Attribution {
  const prs = entry.branch ? prsByBranch.get(entry.branch) ?? [] : [];
  const known = entry.workItems ?? [];
  if (known.length) {
    const fromBranch = new Set(extractWorkItems(entry.branch, [], tracker));
    const itemBasis: Basis[] = entry.workItemsManual
      ? ["manual"]
      : known.map((k) => (fromBranch.has(k) ? "branch-name" : "commit-message"));
    return { items: [...known], prs, itemBasis };
  }
  if (prs.length) return { items: [...prs], prs, itemBasis: ["merge"] };
  return { items: [], prs, itemBasis: [] };
}

interface Acc {
  key: string | null;
  branches: Set<string>;
  items: Set<string>;
  prs: Set<string>;
  basis: Set<Basis>;
  seconds: number;
  microUsd: number;
  byMonth: Map<string, number>;
  unpricedAgents: boolean;
}

function newAcc(key: string | null): Acc {
  return { key, branches: new Set(), items: new Set(), prs: new Set(), basis: new Set(),
           seconds: 0, microUsd: 0, byMonth: new Map(), unpricedAgents: false };
}

function add(acc: Acc, entry: TimeEntry, a: Attribution, by: SpendBy): void {
  acc.seconds += entry.seconds;
  acc.microUsd += entry.aiCost.microUsd;
  // El mes de started_at, el mismo que usa `estela ai-cost` para repartir.
  const month = monthOf(entry.startedAt);
  acc.byMonth.set(month, (acc.byMonth.get(month) ?? 0) + entry.aiCost.microUsd);
  if (entry.agents.some((x) => UNPRICED_AGENTS.has(x))) acc.unpricedAgents = true;
  if (entry.branch) acc.branches.add(entry.branch);
  // Por rama, los PRs van en su sitio: el del merge no se repite como ticket.
  const fromMerge = a.itemBasis.length === 1 && a.itemBasis[0] === "merge";
  if (by === "item" || !fromMerge) for (const i of a.items) acc.items.add(i);
  for (const p of a.prs) acc.prs.add(p);

  if (by === "branch") {
    if (entry.branch) acc.basis.add(entry.agents.length ? "agent-branch" : "commit-branch");
  } else if (a.items.length) {
    for (const b of a.itemBasis) acc.basis.add(b);
  }
}

/**
 * Dinero real: la cuota del mes por la fracción de todo el consumo de ese mes
 * que es de esta parte. La fórmula de `amortize`, solo que con una parte
 * cualquiera (una rama, unas sesiones) en vez del proyecto; redondea por parte,
 * así que la suma puede diferir en un céntimo de la de `ai-cost`.
 *
 * `partial`: algún mes con consumo no tenía cuota, y `real` cuenta solo el resto.
 */
export function realFromMonths(
  byMonth: ReadonlyMap<string, number>,
  subscriptions: readonly Subscription[],
  monthTotal: (month: string) => number,
): { real: Money | null; partial: boolean } {
  let real: Money | null = null;
  let partial = false;
  if (!subscriptions.length) return { real, partial };
  for (const [month, micro] of byMonth) {
    const fee = feeForMonth(subscriptions, month);
    if (!fee) { if (micro > 0) partial = true; continue; }
    const total = Math.max(monthTotal(month), micro);
    const part = total === 0 ? 0 : Math.round(fee.amount * (micro / total));
    if (real && real.currency !== fee.currency) {
      throw new TypeError(tr`Suscripciones en monedas distintas en el periodo (${real.currency} y ${fee.currency}). ` +
        tr`Unifica la moneda de las suscripciones: no se convierten automáticamente.`);
    }
    real = money((real?.amount ?? 0) + part, fee.currency);
  }
  return { real, partial };
}

function finish(acc: Acc, input: SpendInput, assignedByMonth: ReadonlyMap<string, number>): SpendUnit {
  const { real, partial } = realFromMonths(acc.byMonth, input.subscriptions,
    (month) => Math.max(input.monthTotals.get(month)?.microUsd ?? 0, assignedByMonth.get(month) ?? 0));
  return {
    key: acc.key,
    branches: [...acc.branches].sort(),
    items: [...acc.items],
    prs: [...acc.prs],
    basis: [...acc.basis],
    seconds: acc.seconds,
    consumption: { microUsd: acc.microUsd },
    real,
    realPartial: partial,
    unpricedAgents: acc.unpricedAgents,
  };
}

function sumUnits(units: readonly SpendUnit[]): SpendProjectReport["total"] {
  let real: Money | null = null;
  for (const u of units) {
    if (u.real) real = money((real?.amount ?? 0) + u.real.amount, u.real.currency);
  }
  return {
    seconds: units.reduce((s, u) => s + u.seconds, 0),
    consumption: { microUsd: units.reduce((s, u) => s + u.consumption.microUsd, 0) },
    real,
    realPartial: units.some((u) => u.realPartial),
    unpricedAgents: units.some((u) => u.unpricedAgents),
  };
}
