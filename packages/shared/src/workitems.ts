/**
 * A qué ticket pertenece un bloque de trabajo.
 *
 * Es la base de cualquier integración con un gestor de tareas: Jira, Azure
 * Boards o las issues de GitHub y GitLab. Sin saber el ticket, unas horas
 * pueden ir a un CSV, pero no a donde el equipo las busca.
 *
 * Se lee de lo que el desarrollador ya escribe por costumbre — el nombre de la
 * rama y los mensajes de commit — sin pedirle nada nuevo. Y se prefiere perder
 * un ticket a inventarlo: una clave falsa imputa horas a un trabajo que no las
 * tuvo, y eso es peor que no imputarlas.
 */

export type TrackerSystem = "jira" | "azure" | "github" | "gitlab";

export const TRACKER_SYSTEMS: readonly TrackerSystem[] = ["jira", "azure", "github", "gitlab"];

/** El gestor de tareas de un proyecto, si se configuró. */
export interface WorkItemTracker {
  readonly system: TrackerSystem;
  /**
   * Solo para Jira: las claves de proyecto válidas (`PROJ`, `OPS`). Con ellas
   * se reconocen también en minúscula en la rama (`feature/proj-12-login`) y
   * nada que no empiece así se confunde con un ticket.
   */
  readonly prefixes: readonly string[];
}

// Parecen claves de Jira y no lo son: codificaciones, algoritmos, normas.
const NOT_JIRA = new Set([
  "UTF", "SHA", "MD", "ISO", "RFC", "HTTP", "TLS", "SSL", "WIN", "CVE",
  "ES", "EN", "X", "V", "Q", "IPV", "MP", "H", "AES", "RSA", "COVID",
]);

// Carpetas de rama cuyo número no es un ticket: `release/2024`, `v/12`.
const NOT_TICKET_FOLDERS = new Set(["release", "releases", "tags", "tag", "v", "version"]);

/**
 * Claves normalizadas (`jira:PROJ-12`, `azure:1234`, `github:12`), primero las
 * de la rama y después las de los commits, sin repetir.
 *
 * Sin gestor configurado solo se reconoce lo inequívoco: `AB#1234` de Azure en
 * cualquier sitio, y claves de Jira EN MAYÚSCULA en la rama, que es como las
 * deja el botón "crear rama" de Jira. Un número suelto nunca, porque sin saber
 * el gestor no se sabe de quién es.
 */
export function extractWorkItems(
  branch: string | null,
  subjects: readonly string[],
  tracker?: WorkItemTracker | null,
): string[] {
  const found: string[] = [];
  const add = (key: string) => { if (!found.includes(key)) found.push(key); };

  const rama = branch ?? "";
  for (const key of azureTags(rama)) add(key);
  for (const key of jiraKeys(rama, tracker)) add(key);
  if (tracker && tracker.system !== "jira") {
    const n = branchNumber(rama);
    if (n) add(`${tracker.system}:${n}`);
  }

  for (const subject of subjects) {
    for (const key of azureTags(subject)) add(key);
    if (tracker?.system === "jira") for (const key of jiraKeys(subject, tracker)) add(key);
    if (tracker?.system === "github" || tracker?.system === "gitlab") {
      // `#12`, pero no `AB#12` (ese es de Azure) ni `&#12;` ni `abc#12`.
      for (const m of subject.matchAll(/(?<![\w&#])#(\d+)\b/g)) add(`${tracker.system}:${m[1]}`);
    }
  }
  return found;
}

function azureTags(text: string): string[] {
  return [...text.matchAll(/\bAB#(\d+)\b/gi)].map((m) => `azure:${m[1]}`);
}

function jiraKeys(text: string, tracker?: WorkItemTracker | null): string[] {
  if (tracker && tracker.system !== "jira") return [];
  const prefixes = tracker?.prefixes.map((p) => p.toUpperCase()) ?? [];

  if (prefixes.length) {
    // Con prefijos conocidos, también en minúscula: las ramas suelen estarlo.
    const alternativas = prefixes.map((p) => p.replace(/[^A-Z0-9]/g, "")).filter(Boolean).join("|");
    if (!alternativas) return [];
    const re = new RegExp(`(?<![A-Za-z0-9])(${alternativas})-(\\d+)(?![A-Za-z0-9])`, "gi");
    return [...text.matchAll(re)].map((m) => `jira:${m[1]!.toUpperCase()}-${m[2]}`);
  }

  return [...text.matchAll(/(?<![A-Za-z0-9])([A-Z][A-Z0-9]+)-(\d+)(?![A-Za-z0-9])/g)]
    .filter((m) => !NOT_JIRA.has(m[1]!))
    .map((m) => `jira:${m[1]}-${m[2]}`);
}

/**
 * El número de ticket de una rama como `feature/1234-login`, `users/ana/1234`
 * o `1234-login` (lo que crean Azure Boards y GitHub desde la issue).
 *
 * El número tiene que abrir el último tramo de la rama. `release/2024` no
 * cuenta por la carpeta, y `2024-10-01` tampoco porque detrás viene otro
 * número: eso es una fecha.
 */
function branchNumber(branch: string): string | null {
  const tramos = branch.split("/").filter(Boolean);
  const ultimo = tramos[tramos.length - 1];
  if (!ultimo) return null;
  if (tramos.slice(0, -1).some((t) => NOT_TICKET_FOLDERS.has(t.toLowerCase()))) return null;
  const m = /^(\d+)(?:[-_](.*))?$/.exec(ultimo);
  if (!m) return null;
  if (m[2] !== undefined && /^\d/.test(m[2])) return null;
  return m[1]!.replace(/^0+/, "") || null;
}

/** Cómo se enseña una clave: `PROJ-12`, `AB#1234`, `#12`. */
export function formatWorkItem(key: string): string {
  const [system, id] = splitWorkItem(key);
  if (system === "azure") return `AB#${id}`;
  if (system === "github" || system === "gitlab") return `#${id}`;
  return id;
}

export function splitWorkItem(key: string): [TrackerSystem, string] {
  const i = key.indexOf(":");
  return [key.slice(0, i) as TrackerSystem, key.slice(i + 1)];
}

/**
 * Lo que escribe alguien a mano (`PROJ-12`, `AB#1234`, `#12`, `1234`) a clave
 * normalizada, con el gestor del proyecto para lo ambiguo. `null` si no se
 * puede saber de qué gestor es.
 */
export function parseWorkItem(text: string, tracker?: WorkItemTracker | null): string | null {
  const t = text.trim();
  let m = /^AB#(\d+)$/i.exec(t);
  if (m) return `azure:${m[1]}`;
  m = /^([A-Za-z][A-Za-z0-9]+)-(\d+)$/.exec(t);
  if (m) return `jira:${m[1]!.toUpperCase()}-${m[2]}`;
  m = /^#?(\d+)$/.exec(t);
  if (m && tracker && tracker.system !== "jira") return `${tracker.system}:${m[1]}`;
  return null;
}
