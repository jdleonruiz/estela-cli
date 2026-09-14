import type { CommitRecord, TimeEntry } from "@estela/shared";
import { localDate, WORK_KIND_LABELS } from "@estela/shared";

/**
 * Métricas del panel compartido.
 *
 * Funciones puras: entran commits e imputaciones, salen cifras. Sin base de
 * datos y sin interfaz, para que cada número tenga un test y se pueda defender
 * cuando el líder técnico pregunte de dónde sale. Lo que arruina una demo no es
 * una gráfica fea, es una cifra que no cuadra.
 *
 * Lo que deliberadamente NO se calcula: líneas de código como titular, número
 * de commits, y cualquier índice compuesto de "productividad". Son métricas de
 * vanidad; enseñarlas a quien dirige equipos descalifica la herramienta en el
 * primer vistazo porque todo el oficio sabe que se inflan solas.
 */

// ---------------------------------------------------------------------------
// Esfuerzo por funcionalidad
// ---------------------------------------------------------------------------

export interface FeatureEffort {
  /** Nombre legible: la rama sin su prefijo de convención. */
  readonly name: string;
  readonly branch: string;
  readonly seconds: number;
  readonly days: number;
  readonly firstDay: string;
  readonly lastDay: string;
  /** Lo entregado, en palabras de quien lo hizo. */
  readonly delivered: readonly { hash: string; subject: string }[];
  readonly linesAdded: number;
  readonly linesDeleted: number;
  /** `null` cuando no se sabe si está integrada. */
  readonly merged: boolean | null;
}

/**
 * Agrupa el trabajo por rama.
 *
 * Un gestor piensa en funcionalidades, no en martes: "18h en el informe de
 * servicios" es una frase que puede contrastar con lo que pidió; "3h el día 14"
 * no le dice nada.
 */
export function effortByFeature(
  entries: readonly TimeEntry[],
  commits: readonly CommitRecord[],
  mergedBranches: ReadonlySet<string> | null = null,
): FeatureEffort[] {
  const byBranch = new Map<string, {
    seconds: number; days: Set<string>;
    commits: CommitRecord[];
  }>();

  const get = (branch: string) => {
    let entry = byBranch.get(branch);
    if (!entry) { entry = { seconds: 0, days: new Set(), commits: [] }; byBranch.set(branch, entry); }
    return entry;
  };

  for (const entry of entries) {
    if (!entry.billable) continue;
    const bucket = get(bucketFor(entry));
    bucket.seconds += entry.seconds;
    bucket.days.add(localDate(entry.startedAt));
  }

  for (const commit of commits) {
    if (!commit.branch) continue;
    // Solo se cuentan commits de ramas donde además hubo trabajo imputado: si
    // no, aparecerían funcionalidades con commits y cero horas, que confunden.
    const bucket = byBranch.get(commit.branch);
    if (bucket) bucket.commits.push(commit);
  }

  return [...byBranch.entries()]
    .map(([branch, b]) => {
      const days = [...b.days].sort();
      const sorted = [...b.commits].sort((x, y) => y.at.getTime() - x.at.getTime());
      return {
        name: featureName(branch),
        branch,
        seconds: b.seconds,
        days: days.length,
        firstDay: days[0] ?? "",
        lastDay: days[days.length - 1] ?? "",
        delivered: sorted.map((c) => ({ hash: c.hash.slice(0, 7), subject: c.subject })),
        linesAdded: sorted.reduce((s, c) => s + c.linesAdded, 0),
        linesDeleted: sorted.reduce((s, c) => s + c.linesDeleted, 0),
        // Un grupo por tipo de trabajo no es una rama: preguntarle si está
        // integrado no significa nada, y decir "en curso" sería confuso.
        merged: branch.startsWith("kind:") ? null
          : mergedBranches ? mergedBranches.has(branch) : null,
      };
    })
    .sort((a, b) => b.seconds - a.seconds);
}

/**
 * A qué grupo pertenece una imputación.
 *
 * El trabajo sin rama no es un hueco sin explicar: una reunión o un viaje no
 * ocurren en ninguna rama. Agruparlo por su tipo da una línea que un gestor
 * entiende —"1h 30m en reuniones"— en vez de un "sin rama" que solo genera la
 * pregunta de qué falló.
 */
function bucketFor(entry: TimeEntry): string {
  if (entry.branch) return entry.branch;
  if (entry.kind !== "development") return `kind:${entry.kind}`;
  return "kind:other";
}

/** Quita el prefijo de convención: `feature/informe-x` → `informe-x`. */
export function featureName(branch: string): string {
  if (branch.startsWith("kind:")) {
    const kind = branch.slice(5) as keyof typeof WORK_KIND_LABELS;
    return WORK_KIND_LABELS[kind] ?? "Trabajo general";
  }
  return branch.replace(/^(feature|feat|fix|hotfix|chore|bugfix|release)\//i, "")
    .replace(/[-_]+/g, " ")
    .trim() || branch;
}

// ---------------------------------------------------------------------------
// Ritmo de entrega
// ---------------------------------------------------------------------------

export interface Cadence {
  readonly byDay: readonly { date: string; seconds: number }[];
  readonly activeDays: number;
  /** Días naturales entre el primero y el último con trabajo. */
  readonly spanDays: number;
  /** Hueco más largo sin actividad, en días. */
  readonly longestGapDays: number;
  readonly medianSecondsPerActiveDay: number;
}

/**
 * Cómo se repartió el trabajo en el tiempo.
 *
 * Un líder técnico lo lee de un vistazo: trabajo repartido significa un
 * proyecto que respira; todo amontonado la víspera significa otra cosa.
 */
export function cadence(entries: readonly TimeEntry[]): Cadence {
  const perDay = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.billable) continue;
    const day = localDate(entry.startedAt);
    perDay.set(day, (perDay.get(day) ?? 0) + entry.seconds);
  }

  const byDay = [...perDay.entries()]
    .map(([date, seconds]) => ({ date, seconds }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (byDay.length === 0) {
    return { byDay, activeDays: 0, spanDays: 0, longestGapDays: 0, medianSecondsPerActiveDay: 0 };
  }

  const first = byDay[0]!.date;
  const last = byDay[byDay.length - 1]!.date;
  const spanDays = daysBetween(first, last) + 1;

  let longestGap = 0;
  for (let i = 1; i < byDay.length; i++) {
    longestGap = Math.max(longestGap, daysBetween(byDay[i - 1]!.date, byDay[i]!.date) - 1);
  }

  const sorted = byDay.map((d) => d.seconds).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : sorted[mid] ?? 0;

  return {
    byDay,
    activeDays: byDay.length,
    spanDays,
    longestGapDays: longestGap,
    medianSecondsPerActiveDay: median,
  };
}

// ---------------------------------------------------------------------------
// Reescritura
// ---------------------------------------------------------------------------

export interface ChurnFile {
  readonly file: string;
  readonly touches: number;
  readonly spanDays: number;
  readonly lastDay: string;
}

/**
 * Ficheros que se vuelven a tocar.
 *
 * Es la métrica que más respeto gana ante un líder técnico porque es
 * diagnóstica y no autocomplaciente: mucha reescritura significa requisitos
 * cambiando o diseño que se resistió. Enseñarla sin que la pida dice que no se
 * oculta nada.
 *
 * Solo cuenta si los retoques están próximos en el tiempo: un fichero tocado en
 * enero y en agosto no es reescritura, es mantenimiento normal.
 */
export function churn(
  commits: readonly CommitRecord[],
  options: { withinDays?: number; minTouches?: number } = {},
): ChurnFile[] {
  const within = options.withinDays ?? 14;
  const minTouches = options.minTouches ?? 3;

  const byFile = new Map<string, Date[]>();
  for (const commit of commits) {
    for (const file of commit.files) {
      const list = byFile.get(file);
      if (list) list.push(commit.at);
      else byFile.set(file, [commit.at]);
    }
  }

  const result: ChurnFile[] = [];

  for (const [file, dates] of byFile) {
    if (dates.length < minTouches) continue;
    dates.sort((a, b) => a.getTime() - b.getTime());

    // Retoques encadenados: cada uno a menos de `within` días del anterior.
    let runStart = 0;
    let best = { count: 1, from: 0, to: 0 };
    for (let i = 1; i < dates.length; i++) {
      const gap = (dates[i]!.getTime() - dates[i - 1]!.getTime()) / 86_400_000;
      if (gap > within) runStart = i;
      const count = i - runStart + 1;
      if (count > best.count) best = { count, from: runStart, to: i };
    }

    if (best.count < minTouches) continue;
    const from = dates[best.from]!;
    const to = dates[best.to]!;
    result.push({
      file,
      touches: best.count,
      spanDays: Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000)),
      lastDay: localDate(to),
    });
  }

  return result.sort((a, b) => b.touches - a.touches || a.spanDays - b.spanDays);
}

// ---------------------------------------------------------------------------
// Trabajo abierto
// ---------------------------------------------------------------------------

export interface OpenWork {
  readonly branch: string;
  readonly name: string;
  readonly lastDay: string;
  readonly ageDays: number;
  readonly commits: number;
}

/**
 * Ramas con trabajo sin integrar.
 *
 * Es lo que un jefe de proyecto más quiere y menos tiene: riesgo acumulado que
 * no se ve hasta que estalla en la integración.
 *
 * Ojo al presentarlo: una rama lleva ocho días abierta tanto si el desarrollador
 * va lento como si el cliente no la revisa. El número no distingue, así que la
 * interfaz no debe insinuar culpa.
 */
export function openWork(
  commits: readonly CommitRecord[],
  mergedBranches: ReadonlySet<string>,
  today = new Date(),
): OpenWork[] {
  const byBranch = new Map<string, { last: Date; count: number }>();

  for (const commit of commits) {
    if (!commit.branch || mergedBranches.has(commit.branch)) continue;
    const entry = byBranch.get(commit.branch);
    if (entry) {
      entry.count++;
      if (commit.at > entry.last) entry.last = commit.at;
    } else {
      byBranch.set(commit.branch, { last: commit.at, count: 1 });
    }
  }

  return [...byBranch.entries()]
    .map(([branch, b]) => ({
      branch,
      name: featureName(branch),
      lastDay: localDate(b.last),
      ageDays: Math.max(0, Math.round((today.getTime() - b.last.getTime()) / 86_400_000)),
      commits: b.count,
    }))
    .sort((a, b) => b.ageDays - a.ageDays);
}

// ---------------------------------------------------------------------------

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}
