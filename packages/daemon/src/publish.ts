import type { DatabaseSync } from "node:sqlite";

import type { CommitRecord, Project } from "@estela/shared";
import { localDate } from "@estela/shared";

import { rateAt } from "./billing/invoice.js";
import { cloudDelete, cloudGet, cloudPost, CloudError } from "./cloud/client.js";
import * as store from "./db/store.js";
import { buildPanel, newPanelToken, panelData, summarizePanel, type PanelOptions } from "./export/panel.js";
import { emailsOverlap, teamView } from "./metrics/team.js";
import { listTeamMembers, type TeamMemberSummary } from "./team.js";
import { mergedBranches } from "./watchers/git.js";
import { myEmailsByRepo } from "./watchers/identity.js";
import { documentLang, tr, withLang, type Lang } from "./i18n/index.js";

/**
 * Publica un panel, alojado en la cuenta vinculada.
 *
 * Único punto que sabe construir un panel y subirlo. Antes había dos: uno en
 * `cli.ts` para `estela publish`, y otro en `server.ts` para el botón
 * "Compartir" del panel local. El de `server.ts` se quedó parado en el diseño
 * de antes de tener cuentas —generaba el HTML en local y pedía tu dominio
 * para subirlo tú, con la IP de mi propio droplet escrita a fuego en el
 * comando— porque nadie volvió a tocarlo cuando `cli.ts` cambió. Que exista
 * una sola función es lo que impide que las dos vuelvan a separarse.
 */

export class NoAccountError extends Error {}

export interface PublishOptions {
  readonly projectId: string;
  readonly token?: string;
  readonly authorName?: string;
  readonly withAmounts?: boolean;
  readonly includeTeam?: boolean;
  /**
   * Correos del cliente. Con esto el panel deja de ser solo un enlace suelto:
   * cuando esa persona entra en su cuenta se lo encuentra ahí, y si tiene
   * Teams puede invitar a su propia gente a este mismo proyecto.
   *
   * Sin la opción no se manda nada, y el servidor deja la lista como estaba —
   * republicar el avance de la semana no puede desvincular al cliente.
   */
  readonly clients?: readonly string[];
  /**
   * Idioma del panel, si se pide expresamente. Sin él manda el que se fijó para
   * el cliente, y sin ese, el de la terminal de quien publica.
   */
  readonly language?: Lang;
  /** Sin la línea "Horas rellenadas por Estela" del pie. Solo Pro y Teams: el servidor lo comprueba. */
  readonly hideCredit?: boolean;
}

/** Lo que va a quedar público al subir el panel, para enseñarlo antes. */
export type PanelSummary = ReturnType<typeof summarizePanel> & {
  /** Correos del cliente que recibirán acceso y un aviso por correo. */
  readonly clients: readonly string[];
};

/** Un panel ya construido, a falta de subirlo. */
export interface PreparedPanel {
  readonly projectId: string;
  readonly projectName: string;
  readonly token: string;
  readonly html: string;
  readonly summary: PanelSummary;
  readonly clients?: readonly string[];
  readonly hideCredit: boolean;
}

export interface PublishResult {
  readonly token: string;
  readonly url: string;
  readonly adopted: boolean;
}

/**
 * Commits de los repositorios de un proyecto.
 *
 * `LIKE` con sufijo, no `repo_path IN (...)` exacto: un submódulo o un
 * repositorio anidado puede guardar sus commits bajo una ruta que empieza por
 * la del proyecto pero no es idéntica, y una igualdad exacta los dejaría
 * fuera en silencio.
 */
function commitsOfProject(db: DatabaseSync, repoPaths: readonly string[]): CommitRecord[] {
  if (repoPaths.length === 0) return [];
  const like = repoPaths.map(() => "repo_path LIKE ?").join(" OR ");
  return (db.prepare(`SELECT * FROM commits WHERE ${like}`)
    .all(...repoPaths.map((p) => `${p}%`)) as Record<string, unknown>[]).map((r) => ({
    repoPath: r["repo_path"] as string, hash: r["hash"] as string,
    at: new Date(r["at"] as string), authorEmail: r["author_email"] as string,
    authorName: (r["author_name"] as string) ?? "",
    branch: (r["branch"] as string | null) ?? null, subject: r["subject"] as string,
    linesAdded: r["lines_added"] as number, linesDeleted: r["lines_deleted"] as number,
    files: String(r["files"] ?? "").split("\n").filter(Boolean),
  }));
}

export async function publishPanel(db: DatabaseSync, options: PublishOptions): Promise<PublishResult> {
  return uploadPanel(db, await preparePanel(db, options));
}

/**
 * Construye el panel sin subirlo: el HTML y el resumen de lo que va a quedar
 * público. `estela publish` enseña el resumen y pide confirmación antes de
 * `uploadPanel`.
 */
export async function preparePanel(db: DatabaseSync, options: PublishOptions): Promise<PreparedPanel> {
  const project = store.getProject(db, options.projectId);
  if (!project) throw new Error(tr`No existe el proyecto "${options.projectId}".`);
  // Alojarlo exige sesión: es la cuenta la que decide cuántos paneles caben
  // en tu plan, y sin ella no hay a quién cargarle esa cuota. Se mira antes de
  // construir nada, para no enseñar un resumen de algo que no se va a subir.
  requireAccount(db);
  const client = store.getClient(db, project.clientId)!;
  const rates = store.getRates(db, options.projectId);

  // Reutilizar el token si se republica: el cliente ya tiene ese enlace
  // guardado y cambiárselo sin avisar le rompe el marcador.
  const token = options.token || newPanelToken();

  const projectCommits = commitsOfProject(db, project.repoPaths);
  const merged = project.repoPaths[0] ? await mergedBranches(project.repoPaths[0]) : null;

  const team = await buildTeam(db, project, projectCommits);

  const panelOptions: PanelOptions = {
    project, client,
    entries: store.getTimeEntries(db, options.projectId),
    ...(options.includeTeam !== false ? { team } : {}),
    ...(options.authorName ? { authorName: options.authorName } : {}),
    withAmounts: options.withAmounts === true,
    hideCredit: options.hideCredit === true,
    rateAt: (at) => rateAt(rates, options.projectId, at),
    aiPayer: "self",
    commits: projectCommits,
    ...(merged ? { merged } : {}),
    commitsOf: (hashes) => hashes.length
      ? db.prepare(
          `SELECT hash, subject FROM commits WHERE hash IN (${hashes.map(() => "?").join(",")})`
        ).all(...hashes) as { hash: string; subject: string }[]
      : [],
  };

  // El panel es un fichero estático: el idioma queda fijado en el momento de
  // publicar, y republicar es lo que lo cambia.
  const lang = documentLang({ explicit: options.language, clientLanguage: client.language });
  const { html, summary } = withLang(lang, () => ({
    html: buildPanel(panelOptions),
    summary: summarizePanel(panelData(panelOptions)),
  }));

  return {
    projectId: project.id, projectName: project.name, token, html,
    summary: { ...summary, clients: options.clients ?? [] },
    ...(options.clients ? { clients: options.clients } : {}),
    hideCredit: options.hideCredit === true,
  };
}

export async function uploadPanel(db: DatabaseSync, panel: PreparedPanel): Promise<PublishResult> {
  const account = requireAccount(db);
  let result: { url: string; adopted: boolean };
  try {
    result = await cloudPost(account.apiBaseUrl, "/panels",
      { token: panel.token, projectName: panel.projectName, projectId: panel.projectId, html: panel.html,
        ...(panel.clients ? { clients: panel.clients } : {}),
        ...(panel.hideCredit ? { hideCredit: true } : {}) },
      { deviceToken: account.deviceToken });
  } catch (error) {
    // Igual que en sync.ts: el 402 se deja pasar. El mensaje ya viene
    // redactado del servidor (panels.ts), que es la única fuente de la verdad
    // sobre cuántos paneles permite cada plan, y el CLI imprime CloudError
    // limpio. Envolverlo lo convertía en un volcado de pila.
    throw sessionError(error);
  }

  store.recordPublication(db, panel.projectId, panel.token, "https://getestela.dev");
  return { token: panel.token, url: result.url, adopted: result.adopted };
}

/** Un panel publicado en tu cuenta, tal como lo lista el servidor. */
export interface PublishedPanel {
  readonly token: string;
  readonly projectName: string;
  readonly projectId: string | null;
}

/**
 * Despublica un panel: el servidor borra el fichero y el enlace deja de
 * funcionar. `target` es el id de un proyecto (el panel que se publicó desde
 * esta máquina) o el token del enlace.
 */
export async function unpublishPanel(db: DatabaseSync, target: string): Promise<PublishedPanel> {
  const account = requireAccount(db);
  const panels = await listPublishedPanels(db);
  const token = /^[0-9a-f]{32}$/.test(target) ? target : store.getPublicationToken(db, target);
  const panel = panels.find((p) => p.token === token)
    ?? panels.find((p) => p.projectId === target);
  if (!panel) throw new Error(tr`No hay ningún panel publicado de "${target}". Míralos con: estela unpublish`);
  try {
    await cloudDelete(account.apiBaseUrl, `/panels/${panel.token}`, { deviceToken: account.deviceToken });
  } catch (error) { throw sessionError(error); }
  store.forgetPublication(db, panel.token);
  return panel;
}

/** Despublica todos los paneles de la cuenta. Devuelve los que quitó. */
export async function unpublishAll(db: DatabaseSync): Promise<PublishedPanel[]> {
  const account = requireAccount(db);
  const panels = await listPublishedPanels(db);
  for (const panel of panels) {
    try {
      await cloudDelete(account.apiBaseUrl, `/panels/${panel.token}`, { deviceToken: account.deviceToken });
    } catch (error) { throw sessionError(error); }
    store.forgetPublication(db, panel.token);
  }
  return panels;
}

export async function listPublishedPanels(db: DatabaseSync): Promise<PublishedPanel[]> {
  const account = requireAccount(db);
  try {
    const res = await cloudGet<{ panels: { token: string; projectName: string; projectId?: string | null }[] }>(
      account.apiBaseUrl, "/panels", { deviceToken: account.deviceToken });
    return res.panels.map((p) => ({ token: p.token, projectName: p.projectName, projectId: p.projectId ?? null }));
  } catch (error) { throw sessionError(error); }
}

function requireAccount(db: DatabaseSync) {
  const account = store.getCloudAccount(db);
  if (!account) {
    throw new NoAccountError(
      tr`Necesitas una cuenta para publicar. Vincúlala con:\n\n` +
      tr`  estela login --email tu@correo.com\n`);
  }
  return account;
}

function sessionError(error: unknown): unknown {
  if (error instanceof CloudError && error.status === 401) {
    return new NoAccountError(
      tr`Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n` +
      tr`  estela login --email tu@correo.com\n`);
  }
  return error;
}

/**
 * El equipo del proyecto, acotado al periodo que cubre el panel. Sin acotar
 * se compara el historial entero del repositorio con las semanas que llevas
 * tú: salían 523 commits de un compañero frente a 11 tuyos, y el panel que
 * venía a respaldar tu trabajo te dejaba a la altura del betún.
 */
async function buildTeam(db: DatabaseSync, project: Project, projectCommits: readonly CommitRecord[]) {
  const myEntries = store.getTimeEntries(db, project.id);
  const mineByRepo = await myEmailsByRepo(db, project.repoPaths);
  const myEmails = new Set<string>();
  for (const set of mineByRepo.values()) for (const email of set) myEmails.add(email);

  const worked = myEntries.map((e) => localDate(e.startedAt)).sort((a, b) => a.localeCompare(b));
  const from = worked[0] ?? "0000-01-01";
  const to = worked[worked.length - 1] ?? "9999-12-31";
  const inPeriod = projectCommits.filter((c) => {
    const day = localDate(c.at);
    return day >= from && day <= to;
  });

  const base = teamView(inPeriod, { myEmails, myEntries });

  // Compañeros medidos de verdad, si los hay: se buscan por el email que
  // quien invitó declaró, cruzado con los emails de commit de cada persona
  // ya fusionada por teamView(). Si no hay cuenta, o la llamada falla, se
  // publica igual con la estimación por commits — un panel a medias es
  // mejor que uno que no sale.
  let members: readonly TeamMemberSummary[] = [];
  if (store.getCloudAccount(db)) {
    try { members = await listTeamMembers(db, project.id); }
    catch { /* mejor sin datos de equipo que publicar a medias por error */ }
  }

  return base.map((p) => {
    if (!p.isMe) {
      const match = members.find((m) => emailsOverlap(p.emails, m.emails));
      return match
        ? { name: p.name, isMe: false, seconds: match.seconds, measured: true,
            commits: p.commits, branches: p.branches.length, lastDay: p.lastDay }
        : { name: p.name, isMe: false, measured: false,
            commits: p.commits, branches: p.branches.length, lastDay: p.lastDay };
    }
    return {
      name: p.name, isMe: true, ...(p.measured ? { seconds: p.seconds } : {}), measured: p.measured,
      commits: p.commits, branches: p.branches.length, lastDay: p.lastDay,
    };
  });
}
