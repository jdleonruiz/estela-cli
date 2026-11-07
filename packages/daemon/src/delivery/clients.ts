import type { AiCost, Subscription, TimeEntry } from "@estela/shared";

import { monthOf } from "../billing/amortize.js";
import { realFromMonths } from "../metrics/spend.js";
import type { MergeRecord } from "../watchers/git.js";
import type { Cost } from "./report.js";
import type { TrackerItem } from "./source.js";

/**
 * Lo pedido por clientes frente al resto: a qué peticiones fue el gasto de IA
 * de un periodo.
 *
 * Una issue o un PR es una petición de un cliente si lleva una etiqueta
 * `cliente:<nombre>`. Las horas se unen a issues y PRs como en el resto del
 * informe de entregas (la rama del PR y su número en ramas, commits o a mano),
 * y un PR hereda las etiquetas de las issues que cierra.
 *
 * Nada se reparte: una hora unida a peticiones de dos clientes va a un grupo
 * propio de los dos, y una hora sin petición va a "el resto". Y aquí no hay
 * ingresos ni contratos, que Estela no conoce: solo qué gasto sirvió a qué
 * petición.
 */

/** Quién pidió algo, ya resuelto contra los clientes de Estela. */
export interface Requester {
  /** Clave estable: el id del cliente, o `?nombre` si no se sabe cuál es. */
  readonly id: string;
  /** El cliente de Estela, o `null` si la etiqueta no se pudo mapear. */
  readonly clientId: string | null;
  readonly name: string;
}

export interface ClientRequestInput {
  readonly items: readonly TrackerItem[];
  /** Las imputaciones del periodo. */
  readonly entries: readonly TimeEntry[];
  readonly merges: readonly MergeRecord[];
  /** `cliente:` — se compara sin mayúsculas. */
  readonly prefix: string;
  /** De lo que va detrás del prefijo, a quién es. */
  readonly requesterOf: (name: string) => Requester;
  readonly subscriptions: readonly Subscription[];
  readonly monthTotals: ReadonlyMap<string, AiCost>;
}

export interface RequestGroup extends Cost {
  /** Uno, o varios si las mismas horas sirvieron a peticiones de varios. */
  readonly requesters: readonly Requester[];
  /** Las peticiones a las que se unieron sus horas. */
  readonly items: readonly TrackerItem[];
}

export interface ClientRequestReport {
  readonly groups: readonly RequestGroup[];
  /** Horas sin ninguna petición de cliente. */
  readonly rest: Cost;
  readonly total: Cost;
}

export function clientRequests(input: ClientRequestInput): ClientRequestReport {
  const prefix = input.prefix.toLowerCase();
  const byKey = new Map<string, TrackerItem[]>();
  const prsByBranch = new Map<string, TrackerItem[]>();
  for (const i of input.items) {
    byKey.set(i.key, [...(byKey.get(i.key) ?? []), i]);
    if (i.kind === "pr" && i.branch) prsByBranch.set(i.branch, [...(prsByBranch.get(i.branch) ?? []), i]);
  }
  const prOfBranch = new Map<string, string>();
  for (const m of input.merges) if (m.sourceBranch && m.ref) prOfBranch.set(m.sourceBranch, m.ref);

  /** Las issues y PRs de una imputación, con las issues que cierran sus PRs. */
  const linked = (e: TimeEntry): TrackerItem[] => {
    const out = new Set<TrackerItem>();
    if (e.branch) for (const pr of prsByBranch.get(e.branch) ?? []) out.add(pr);
    const keys = [...(e.workItems ?? [])];
    const merged = e.branch ? prOfBranch.get(e.branch) : undefined;
    if (merged) keys.push(merged);
    for (const k of keys) for (const i of byKey.get(k) ?? []) out.add(i);
    for (const i of [...out]) {
      if (i.kind !== "pr") continue;
      for (const k of i.closes) for (const issue of byKey.get(k) ?? []) if (issue.kind === "issue") out.add(issue);
    }
    return [...out];
  };
  const requestersOf = (i: TrackerItem): Requester[] => i.labels
    .filter((l) => l.toLowerCase().startsWith(prefix))
    .map((l) => l.slice(prefix.length).trim())
    .filter(Boolean)
    .map(input.requesterOf);

  const assignedByMonth = new Map<string, number>();
  for (const e of input.entries) {
    const m = monthOf(e.startedAt);
    assignedByMonth.set(m, (assignedByMonth.get(m) ?? 0) + e.aiCost.microUsd);
  }
  const cost = (entries: readonly TimeEntry[]): Cost => {
    const byMonth = new Map<string, number>();
    for (const e of entries) byMonth.set(monthOf(e.startedAt), (byMonth.get(monthOf(e.startedAt)) ?? 0) + e.aiCost.microUsd);
    const { real, partial } = realFromMonths(byMonth, input.subscriptions, (m) =>
      Math.max(input.monthTotals.get(m)?.microUsd ?? 0, assignedByMonth.get(m) ?? 0));
    return {
      seconds: entries.reduce((s, e) => s + e.seconds, 0),
      consumption: { microUsd: entries.reduce((s, e) => s + e.aiCost.microUsd, 0) },
      real, realPartial: partial,
    };
  };

  const groups = new Map<string, { requesters: Requester[]; items: Set<TrackerItem>; entries: TimeEntry[] }>();
  const rest: TimeEntry[] = [];
  for (const e of input.entries) {
    const requested = linked(e).map((i) => ({ i, who: requestersOf(i) })).filter((x) => x.who.length > 0);
    const who = new Map<string, Requester>();
    for (const { who: list } of requested) for (const r of list) who.set(r.id, r);
    if (who.size === 0) { rest.push(e); continue; }
    const requesters = [...who.values()].sort((a, b) => a.name.localeCompare(b.name));
    const key = requesters.map((r) => r.id).join("+");
    let g = groups.get(key);
    if (!g) { g = { requesters, items: new Set(), entries: [] }; groups.set(key, g); }
    g.entries.push(e);
    for (const { i } of requested) g.items.add(i);
  }

  return {
    groups: [...groups.values()]
      .map((g) => ({ requesters: g.requesters, items: [...g.items].sort((a, b) => a.number - b.number), ...cost(g.entries) }))
      .sort((a, b) => b.consumption.microUsd - a.consumption.microUsd),
    rest: cost(rest),
    total: cost(input.entries),
  };
}
