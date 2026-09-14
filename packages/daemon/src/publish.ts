import type { DatabaseSync } from "node:sqlite";

import type { CommitRecord, Project } from "@estela/shared";
import { localDate } from "@estela/shared";

import { rateAt } from "./billing/invoice.js";
import { cloudPost, CloudError } from "./cloud/client.js";
import * as store from "./db/store.js";
import { buildPanel, newPanelToken } from "./export/panel.js";
import { emailsOverlap, teamView } from "./metrics/team.js";
import { listTeamMembers, type TeamMemberSummary } from "./team.js";
import { mergedBranches } from "./watchers/git.js";
import { myEmailsByRepo } from "./watchers/identity.js";

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
  const project = store.getProject(db, options.projectId);
  if (!project) throw new Error(`No existe el proyecto "${options.projectId}".`);
  const client = store.getClient(db, project.clientId)!;
  const rates = store.getRates(db, options.projectId);

  // Reutilizar el token si se republica: el cliente ya tiene ese enlace
  // guardado y cambiárselo sin avisar le rompe el marcador.
  const token = options.token || newPanelToken();

  const projectCommits = commitsOfProject(db, project.repoPaths);
  const merged = project.repoPaths[0] ? await mergedBranches(project.repoPaths[0]) : null;

  const team = await buildTeam(db, project, projectCommits);

  const html = buildPanel({
    project, client,
    entries: store.getTimeEntries(db, options.projectId),
    ...(options.includeTeam !== false ? { team } : {}),
    ...(options.authorName ? { authorName: options.authorName } : {}),
    withAmounts: options.withAmounts === true,
    rateAt: (at) => rateAt(rates, options.projectId, at),
    aiPayer: "self",
    commits: projectCommits,
    ...(merged ? { merged } : {}),
    commitsOf: (hashes) => hashes.length
      ? db.prepare(
          `SELECT hash, subject FROM commits WHERE hash IN (${hashes.map(() => "?").join(",")})`
        ).all(...hashes) as { hash: string; subject: string }[]
      : [],
  });

  // Alojarlo exige sesión: es la cuenta la que decide cuántos paneles caben
  // en tu plan, y sin ella no hay a quién cargarle esa cuota.
  const account = store.getCloudAccount(db);
  if (!account) {
    throw new NoAccountError(
      `Necesitas una cuenta para publicar. Vincúlala con:\n\n` +
      `  estela login --email tu@correo.com\n`);
  }

  let result: { url: string; adopted: boolean };
  try {
    result = await cloudPost(account.apiBaseUrl, "/panels",
      { token, projectName: project.name, projectId: project.id, html,
        ...(options.clients ? { clients: options.clients } : {}) },
      { deviceToken: account.deviceToken });
  } catch (error) {
    // Igual que en sync.ts: el 402 se deja pasar. El mensaje ya viene
    // redactado del servidor (panels.ts), que es la única fuente de la verdad
    // sobre cuántos paneles permite cada plan, y el CLI imprime CloudError
    // limpio. Envolverlo lo convertía en un volcado de pila.
    if (error instanceof CloudError && error.status === 401) {
      throw new NoAccountError(
        `Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n` +
        `  estela login --email tu@correo.com\n`);
    }
    throw error;
  }

  store.recordPublication(db, options.projectId, token, "https://getestela.dev");
  return { token, url: result.url, adopted: result.adopted };
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
