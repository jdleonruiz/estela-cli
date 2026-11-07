import type { TrackerSystem } from "@estela/shared";

/**
 * De dónde sale lo planificado y lo entregado de un periodo.
 *
 * Una interfaz y no GitHub a pelo: el plan de un equipo vive en GitHub, en
 * Linear o en Jira, y lo que Estela hace con él (compararlo con lo entregado y
 * ponerle el coste de IA) es lo mismo en los tres. Hoy solo existe GitHub.
 *
 * Una fuente es la única parte de Estela que habla con un servicio externo, y
 * solo cuando quien la usa ejecuta el comando en un proyecto que la tiene
 * configurada. Lo que lee se guarda en la base (tracker_items) para poder
 * repetir el informe sin conexión.
 */

/** Una issue o un PR, ya normalizado. */
export interface TrackerItem {
  /** Clave como las de los tickets de las imputaciones: `github:12`. */
  readonly key: string;
  readonly kind: "issue" | "pr";
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "closed" | "merged";
  /** Cerrada como hecha (issue) o fusionado (PR). Cerrar como "no se hará" no es entregar. */
  readonly completed: boolean;
  /** Cuándo se cerró o se fusionó. */
  readonly closedAt: Date | null;
  /** Rama del PR. Es lo que une un squash con el trabajo de su rama. */
  readonly branch: string | null;
  /** Issues que cierra este PR (`github:12`). */
  readonly closes: readonly string[];
  readonly labels: readonly string[];
  readonly milestone: string | null;
  readonly url: string;
}

/** Qué cuenta como planificado: una etiqueta o un milestone. */
export interface PlanFilter {
  readonly label?: string;
  readonly milestone?: string;
}

export interface FetchQuery {
  /** Fechas locales, inclusive. */
  readonly from: string;
  readonly to: string;
  readonly plan: PlanFilter | null;
  /**
   * Prefijo de las etiquetas de cliente (`cliente:`). Con él se traen también
   * las issues y PRs que las llevan, en cualquier estado: lo pedido por un
   * cliente cuesta mientras se trabaja, no solo al entregarse.
   */
  readonly clientLabelPrefix?: string;
}

export type Availability =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "missing" | "auth" | "repo"; readonly detail: string };

export interface PlanSource {
  readonly system: TrackerSystem;
  /** Si se puede leer ahora: instalado, con sesión y con un repo que la fuente entienda. */
  availability(): Promise<Availability>;
  /**
   * Lo planificado (según el filtro, en cualquier estado) más lo entregado en
   * el periodo (PRs fusionados e issues cerradas).
   */
  fetch(query: FetchQuery): Promise<TrackerItem[]>;
}
