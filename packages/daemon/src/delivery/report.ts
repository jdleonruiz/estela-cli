import type { AiCost, Money, Subscription, TimeEntry } from "@estela/shared";
import { localDate } from "@estela/shared";

import { monthOf } from "../billing/amortize.js";
import { realFromMonths } from "../metrics/spend.js";
import type { MergeRecord } from "../watchers/git.js";
import type { PlanFilter, TrackerItem } from "./source.js";

/**
 * Planificado frente a entregado, con el coste de IA de cada parte.
 *
 *  - Planificado y entregado: lo del plan que se cerró como hecho, o cuyo PR
 *    se fusionó, dentro del periodo.
 *  - Planificado sin entregar: el resto del plan, con su estado.
 *  - Entregado sin planificar: PRs fusionados e issues cerradas como hechas en
 *    el periodo que no son del plan ni lo cierran.
 *
 * El coste de una issue o un PR es el de las imputaciones que se le unen:
 * las de la rama del PR, las que llevan su número (rama, commit o a mano) y,
 * para una issue, las de los PRs que la cierran. Es el coste de toda esa
 * entrega, aunque parte se trabajara antes del periodo. Una imputación que se
 * une a dos cosas a la vez cuenta en las dos líneas, pero una sola vez en el
 * total de cada bloque.
 */

export interface DeliveryInput {
  readonly items: readonly TrackerItem[];
  readonly plan: PlanFilter | null;
  readonly from: string;
  readonly to: string;
  readonly entries: readonly TimeEntry[];
  readonly merges: readonly MergeRecord[];
  readonly subscriptions: readonly Subscription[];
  readonly monthTotals: ReadonlyMap<string, AiCost>;
}

export interface Cost {
  readonly seconds: number;
  readonly consumption: AiCost;
  readonly real: Money | null;
  readonly realPartial: boolean;
}

export interface DeliveryLine extends Cost {
  readonly item: TrackerItem;
  /** PRs del periodo que cierran esta issue. */
  readonly deliveredBy: readonly TrackerItem[];
  /** Cómo se unió el coste: "branch" (rama del PR) y/o "item" (número en la rama, un commit o a mano). */
  readonly basis: readonly ("branch" | "item")[];
}

export interface DeliveryBlock extends Cost {
  readonly lines: readonly DeliveryLine[];
}

export interface DeliveryReport {
  /** `null` sin plan configurado: solo hay entregado. */
  readonly planned: { readonly delivered: DeliveryBlock; readonly pending: DeliveryBlock } | null;
  readonly unplanned: DeliveryBlock;
}

export function deliveryReport(input: DeliveryInput): DeliveryReport {
  const inPeriod = (d: Date | null) => {
    if (!d) return false;
    const day = localDate(d);
    return day >= input.from && day <= input.to;
  };
  const isPlanned = (i: TrackerItem) => !!input.plan && (
    (input.plan.label !== undefined && i.labels.includes(input.plan.label)) ||
    (input.plan.milestone !== undefined && i.milestone === input.plan.milestone));

  const prsDelivered = input.items.filter((i) => i.kind === "pr" && i.completed && inPeriod(i.closedAt));
  const closersOf = (issue: TrackerItem) => prsDelivered.filter((pr) => pr.closes.includes(issue.key));
  const deliveredInPeriod = (i: TrackerItem) => i.kind === "pr"
    ? i.completed && inPeriod(i.closedAt)
    : (i.completed && inPeriod(i.closedAt)) || closersOf(i).length > 0;

  // Lo que se cerró antes del periodo ya no es plan de este periodo.
  const planned = input.items.filter((i) => isPlanned(i) && !(i.closedAt && localDate(i.closedAt) < input.from
    && !deliveredInPeriod(i)));
  const plannedKeys = new Set(planned.map((i) => i.key));

  const unplanned = input.items.filter((i) => {
    if (isPlanned(i) || !deliveredInPeriod(i)) return false;
    // Un PR que entrega algo del plan es la entrega de ese plan, no un extra.
    if (i.kind === "pr" && i.closes.some((k) => plannedKeys.has(k))) return false;
    // Una issue cerrada por un PR extra ya va con su PR.
    if (i.kind === "issue" && closersOf(i).length > 0) return false;
    return true;
  });

  const costs = new EntryIndex(input);
  const line = (item: TrackerItem): DeliveryLine => {
    const deliveredBy = item.kind === "issue" ? closersOf(item) : [];
    const { ids, basis } = costs.entriesOf(item, deliveredBy);
    return { item, deliveredBy, basis, ...costs.cost(ids) };
  };
  const block = (items: readonly TrackerItem[]): DeliveryBlock => {
    const lines = items.map(line).sort((a, b) => b.consumption.microUsd - a.consumption.microUsd
      || a.item.number - b.item.number);
    const ids = new Set<string>();
    for (const i of items) for (const id of costs.entriesOf(i, i.kind === "issue" ? closersOf(i) : []).ids) ids.add(id);
    return { lines, ...costs.cost(ids) };
  };

  return {
    planned: input.plan ? {
      delivered: block(planned.filter(deliveredInPeriod)),
      pending: block(planned.filter((i) => !deliveredInPeriod(i))),
    } : null,
    unplanned: block(unplanned),
  };
}

// ---------------------------------------------------------------------------

/** Qué imputaciones se unen a cada issue o PR, y lo que cuestan. */
class EntryIndex {
  private readonly byId = new Map<string, TimeEntry>();
  private readonly byBranch = new Map<string, string[]>();
  private readonly byItem = new Map<string, string[]>();
  private readonly assignedByMonth = new Map<string, number>();

  constructor(private readonly input: DeliveryInput) {
    const push = (map: Map<string, string[]>, k: string, id: string) => {
      const list = map.get(k) ?? [];
      if (!list.includes(id)) list.push(id);
      map.set(k, list);
    };
    // El PR de un merge registrado en git también une su rama con su número.
    const prOfBranch = new Map<string, string>();
    for (const m of input.merges) if (m.sourceBranch && m.ref) prOfBranch.set(m.sourceBranch, m.ref);

    for (const e of input.entries) {
      this.byId.set(e.id, e);
      if (e.branch) push(this.byBranch, e.branch, e.id);
      for (const k of e.workItems ?? []) push(this.byItem, k, e.id);
      const pr = e.branch ? prOfBranch.get(e.branch) : undefined;
      if (pr) push(this.byItem, pr, e.id);
      const month = monthOf(e.startedAt);
      this.assignedByMonth.set(month, (this.assignedByMonth.get(month) ?? 0) + e.aiCost.microUsd);
    }
  }

  entriesOf(item: TrackerItem, deliveredBy: readonly TrackerItem[]): { ids: Set<string>; basis: ("branch" | "item")[] } {
    const ids = new Set<string>();
    const basis = new Set<"branch" | "item">();
    for (const i of [item, ...deliveredBy]) {
      const fromBranch = i.kind === "pr" && i.branch ? this.byBranch.get(i.branch) ?? [] : [];
      const fromItem = this.byItem.get(i.key) ?? [];
      if (fromBranch.length) basis.add("branch");
      if (fromItem.length) basis.add("item");
      for (const id of [...fromBranch, ...fromItem]) ids.add(id);
    }
    // Siempre en el mismo orden: la rama primero.
    return { ids, basis: (["branch", "item"] as const).filter((b) => basis.has(b)) };
  }

  cost(ids: Iterable<string>): Cost {
    let seconds = 0;
    let micro = 0;
    const byMonth = new Map<string, number>();
    for (const id of ids) {
      const e = this.byId.get(id)!;
      seconds += e.seconds;
      micro += e.aiCost.microUsd;
      const month = monthOf(e.startedAt);
      byMonth.set(month, (byMonth.get(month) ?? 0) + e.aiCost.microUsd);
    }
    const { real, partial } = realFromMonths(byMonth, this.input.subscriptions, (month) =>
      Math.max(this.input.monthTotals.get(month)?.microUsd ?? 0, this.assignedByMonth.get(month) ?? 0));
    return { seconds, consumption: { microUsd: micro }, real, realPartial: partial };
  }
}
