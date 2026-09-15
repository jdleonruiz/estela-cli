import type { DatabaseSync } from "node:sqlite";

import { formatDuration } from "@estela/shared";

import * as store from "./db/store.js";
import { gitUserEmail, repoAuthors, repoRoot } from "./watchers/git.js";
import { tr } from "./i18n/index.js";

/**
 * Primera ejecución.
 *
 * Es la pantalla que decide si alguien se queda o cierra la terminal. Quien
 * prueba esto no quiere configurar nada: quiere ver si le dice algo cierto
 * sobre su propio trabajo, y tiene dos minutos de paciencia.
 *
 * Por eso `setup` no pregunta. Deduce los proyectos de los repositorios que
 * aparecen en los transcripts, adivina con qué correo commitea cada uno, e
 * importa. Lo que no puede deducir —tarifas, quién es cliente y quién no— lo
 * deja sin poner, porque inventarlo daría cifras falsas el primer minuto, y una
 * cifra falsa el primer minuto es una desinstalación.
 */

export interface SetupPlan {
  readonly repoPath: string;
  readonly projectId: string;
  readonly name: string;
  /** Correos con los que parece que commiteas aquí. */
  readonly emails: readonly string[];
  /** Ya estaba configurado: no se toca. */
  readonly existing: boolean;
}

/** Cliente al que cuelgan los proyectos deducidos. Se renombra luego. */
export const DEFAULT_CLIENT = "sin-clasificar";

/**
 * Nombre e id a partir de la ruta del repositorio.
 *
 * `~/dev/acme/api` da "api". Es lo que la persona llama a ese proyecto, no la
 * ruta entera: un desplegable con rutas absolutas no lo lee nadie.
 */
export function projectFromRepo(repoPath: string): { id: string; name: string } {
  const base = repoPath.split("/").filter(Boolean).pop() ?? "proyecto";
  const id = base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    || "proyecto";
  return { id, name: base };
}

/**
 * Qué se va a configurar, sin tocar nada todavía.
 *
 * Separado de la escritura para poder enseñarlo antes y para poder probarlo.
 * Un repositorio ya asignado a un proyecto se marca `existing` y se respeta:
 * volver a ejecutar `setup` no puede deshacer lo que alguien configuró a mano.
 */
export async function planSetup(
  db: DatabaseSync, repoPaths: readonly string[], myEmailGuess?: string | null,
): Promise<SetupPlan[]> {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const path of repoPaths) {
    const root = await repoRoot(path);
    if (root && !seen.has(root)) { seen.add(root); roots.push(root); }
  }

  // Primero se reúnen TODOS los correos que esta máquina tiene configurados,
  // repositorio por repositorio. Es la diferencia entre acertar en cinco
  // repositorios y acertar en diecisiete: quien trabaja para varias empresas
  // tiene un correo por cliente, y el global no vale en ninguno de ellos.
  //
  // Solo se recogen correos que ya están en la configuración de git de esta
  // persona. No se adivina desde el historial, porque ahí están sus compañeros
  // y elegir mal significa capturar el trabajo de otro como propio.
  const configPorRepo = new Map<string, string>();
  const mine = new Set<string>();
  if (myEmailGuess) mine.add(myEmailGuess.toLowerCase());
  for (const root of roots) {
    const configured = await gitUserEmail(root);
    if (configured) {
      configPorRepo.set(root, configured);
      mine.add(configured.toLowerCase());
    }
  }

  const plans: SetupPlan[] = [];
  for (const root of roots) {
    const already = store.projectForRepo(db, root);
    const { id, name } = projectFromRepo(root);

    if (already) {
      plans.push({ repoPath: root, projectId: already, name, emails: [], existing: true });
      continue;
    }

    plans.push({
      repoPath: root, projectId: uniqueId(db, id), name,
      emails: await guessMyEmails(root, configPorRepo.get(root) ?? null, mine),
      existing: false,
    });
  }

  return plans;
}

/**
 * Con qué correo commiteas en este repositorio.
 *
 * Por orden de fiabilidad, y el orden importa:
 *
 * **1. La configuración de ESTE repositorio.** Es la más fuerte porque es
 * literalmente lo que git va a poner en tu próximo commit aquí. Si además ese
 * correo ya ha commiteado, no hay nada que decidir.
 *
 * **2. Cualquier correo tuyo configurado en otro repositorio de esta máquina.**
 * Quien trabaja para varias empresas tiene un correo por cliente y el global no
 * vale en ninguna; sin este paso se falla en casi todos.
 *
 * El orden no es cosmético. Un repositorio de esta máquina tenía por error el
 * correo de un compañero en su configuración, y juntar todos los correos sin
 * prioridad lo propagaba a los demás repositorios donde esa persona había
 * commiteado: habría capturado su trabajo como tuyo. Mirando primero lo que
 * dice cada repositorio de sí mismo, ese error se queda donde está.
 *
 * Si nada encaja, mejor no adivinar: `estela author` existe para eso y `doctor`
 * avisa. Aquí, equivocarse es facturar el trabajo de otra persona.
 */
async function guessMyEmails(
  root: string, ownConfig: string | null, pool: ReadonlySet<string>,
): Promise<string[]> {
  const authors = await repoAuthors(root, 200);
  if (authors.length === 0) return [];
  const here = new Set(authors.map((a) => a.email.toLowerCase()));

  if (ownConfig && here.has(ownConfig.toLowerCase())) return [ownConfig];

  const found = authors.filter((a) => pool.has(a.email.toLowerCase()))
    .map((a) => a.email);
  if (found.length) return found;

  // Un repositorio con un solo autor no tiene ambigüedad posible.
  if (authors.length === 1) return [authors[0]!.email];

  return [];
}

/** Evita pisar un id existente añadiendo un sufijo. */
function uniqueId(db: DatabaseSync, base: string): string {
  if (!store.getProject(db, base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!store.getProject(db, candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Aplica el plan.
 *
 * Los proyectos nacen como `internal` y sin tarifa a propósito. Marcarlos como
 * cliente facturable haría que `doctor` reclamara una tarifa que nadie ha
 * pactado, y pondría importes inventados en la primera pantalla. Quien tenga un
 * cliente de verdad lo dirá él.
 */
export function applySetup(db: DatabaseSync, plans: readonly SetupPlan[]): number {
  const nuevos = plans.filter((p) => !p.existing);
  if (nuevos.length === 0) return 0;

  if (!store.getClient(db, DEFAULT_CLIENT)) {
    store.upsertClient(db, {
      id: DEFAULT_CLIENT, name: tr`Sin clasificar`, currency: "EUR",
    });
  }

  for (const plan of nuevos) {
    store.upsertProject(db, {
      id: plan.projectId,
      clientId: DEFAULT_CLIENT,
      name: plan.name,
      repoPaths: [plan.repoPath],
      billable: false,
      roundingMinutes: 0,
      aiCostPolicy: "absorbed",
      kind: "internal",
    });
    if (plan.emails.length) store.setProjectAuthors(db, plan.projectId, plan.emails);
  }
  return nuevos.length;
}

/**
 * El resumen que se enseña al terminar.
 *
 * Es lo único que esa persona va a leer, y tiene que responder a "¿esto sabe
 * algo de verdad sobre mi trabajo?". Por eso van las horas y el periodo
 * reconstruido, no cuántas filas se insertaron.
 */
export function summarize(db: DatabaseSync): {
  seconds: number; days: number; projects: number; people: number; from: string; to: string;
} {
  const row = db.prepare(`
    SELECT COALESCE(SUM(seconds), 0) AS seconds,
           COUNT(DISTINCT local_date) AS days,
           COUNT(DISTINCT project_id) AS projects,
           MIN(local_date) AS from_day, MAX(local_date) AS to_day
    FROM time_entries
  `).get() as {
    seconds: number; days: number; projects: number;
    from_day: string | null; to_day: string | null;
  };

  const people = (db.prepare(
    "SELECT COUNT(DISTINCT author_email) AS n FROM commits"
  ).get() as { n: number }).n;

  return {
    seconds: row.seconds, days: row.days, projects: row.projects, people,
    from: row.from_day ?? "", to: row.to_day ?? "",
  };
}

/** Una línea para el resumen final. Se prueba aparte de la impresión. */
export function summaryLine(s: ReturnType<typeof summarize>): string {
  if (s.seconds === 0) {
    return tr`No se ha podido reconstruir ninguna hora todavía.`;
  }
  // Frases enteras por plural, no una "s" pegada: en inglés "day/days" y
  // "project/projects" no siempre concuerdan igual que en español.
  const days = s.days === 1 ? tr`1 día` : tr`${s.days} días`;
  const projects = s.projects === 1 ? tr`1 proyecto` : tr`${s.projects} proyectos`;
  return tr`${formatDuration(s.seconds)} reconstruidas · ${days} · ${projects}`;
}
