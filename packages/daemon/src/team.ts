import type { DatabaseSync } from "node:sqlite";

import type { CloudAccount } from "@estela/shared";

import { cloudGet, cloudPost, CloudError } from "./cloud/client.js";
import * as store from "./db/store.js";
import { NoAccountError } from "./publish.js";
import { tr } from "./i18n/index.js";

/**
 * Teams: invitar a un compañero a un proyecto, y que sus horas pasen de
 * estimadas (por commits) a medidas (por su propio Estela).
 *
 * Mismo patrón que `publish.ts`: requiere cuenta vinculada, y un 402 del
 * servidor (aquí, "esto es Teams") se relanza tal cual — el mensaje vive en
 * `packages/api/src/team.ts`, no se duplica aquí.
 */

export { NoAccountError };

function requireAccount(db: DatabaseSync): CloudAccount {
  const account = store.getCloudAccount(db);
  if (!account) {
    throw new NoAccountError(
      tr`Necesitas una cuenta para esto. Vincúlala con:\n\n` +
      tr`  estela login --email tu@correo.com\n`);
  }
  return account;
}

async function unwrap<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof CloudError && error.status === 402) throw new Error(error.message);
    if (error instanceof CloudError && error.status === 401) {
      throw new NoAccountError(
        tr`Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n` +
        tr`  estela login --email tu@correo.com\n`);
    }
    throw error;
  }
}

export interface InviteOptions {
  readonly projectId: string;
  readonly emails: readonly string[];
  readonly inviteeKind: "employee" | "freelancer";
}

export async function inviteTeamMember(db: DatabaseSync, options: InviteOptions): Promise<{ token: string }> {
  const account = requireAccount(db);
  const project = store.getProject(db, options.projectId);
  if (!project) throw new Error(tr`No existe el proyecto "${options.projectId}".`);

  return unwrap(cloudPost(account.apiBaseUrl, "/team/invite", {
    projectId: options.projectId, projectName: project.name,
    emails: options.emails, inviteeKind: options.inviteeKind,
  }, { deviceToken: account.deviceToken }));
}

export interface AcceptOptions {
  readonly token: string;
  /**
   * Cómo se llamará el proyecto en TU máquina. Opcional: si no lo dices, se
   * usa el id con el que lo creó quien te invitó, que es el que ya conoces
   * porque sale en el correo.
   */
  readonly localProjectId?: string;
}

export interface AcceptOutcome {
  readonly projectName: string;
  readonly emails: readonly string[];
  readonly inviteeKind: string;
  /** Con qué id quedó en esta máquina. */
  readonly localProjectId: string;
}

/**
 * Acepta una invitación y monta lo mínimo local para que el proyecto exista:
 * un cliente placeholder ("team"), el proyecto en sí, y el `project_sync`
 * de alcance 'team' que `estela sync` ya sabe recorrer.
 *
 * El id local puede elegirlo quien acepta, pero no tiene por qué: pedírselo
 * sin más era pedirle que se inventara un dato que el servidor ya conoce, y
 * el correo de invitación acababa con un "--as-id tu-id" que nadie sabía
 * rellenar. Por defecto se usa el id del dueño.
 *
 * Lo que no se puede hacer es reusarlo a ciegas: si ya tienes un proyecto
 * propio con ese mismo id, `upsertProject` lo pisaría en silencio
 * (`ON CONFLICT DO UPDATE`). Por eso, cuando choca, se busca un id libre
 * añadiendo un sufijo en vez de romper o machacar.
 */
export async function acceptTeamInvite(db: DatabaseSync, options: AcceptOptions): Promise<AcceptOutcome> {
  const account = requireAccount(db);

  // Si lo eligió quien acepta, se comprueba antes de la llamada: fallar
  // rápido evita aceptar en el servidor algo que aquí no se va a poder
  // montar.
  if (options.localProjectId) {
    const existing = store.getProject(db, options.localProjectId);
    const existingSync = existing ? store.getProjectSync(db, options.localProjectId) : null;
    if (existing && existingSync?.inviteToken !== options.token) {
      throw new Error(
        tr`Ya existe un proyecto local con el id "${options.localProjectId}". ` +
        tr`Elige otro con --as-id.`);
    }
  }

  const result = await unwrap(cloudPost<{
    projectId: string; projectName: string; ownerAccountId: string;
    emails: string[]; inviteeKind: string;
  }>(account.apiBaseUrl, "/team/accept", { token: options.token },
     { deviceToken: account.deviceToken }));

  // Sin --as-id: el id del dueño, y si ya lo tienes ocupado por otra cosa,
  // el mismo con un sufijo. Reaceptar la MISMA invitación reusa su proyecto,
  // no crea uno nuevo cada vez.
  let localProjectId = options.localProjectId ?? result.projectId;
  if (!options.localProjectId) {
    const yaEsMio = (id: string) =>
      store.getProject(db, id) && store.getProjectSync(db, id)?.inviteToken !== options.token;
    for (let i = 2; yaEsMio(localProjectId); i++) localProjectId = result.projectId + "-" + i;
  }

  if (!store.getClient(db, "team")) {
    store.upsertClient(db, { id: "team", name: tr`Proyectos de equipo`, currency: "USD" });
  }
  store.upsertProject(db, {
    id: localProjectId, clientId: "team", name: result.projectName,
    repoPaths: [], billable: false, roundingMinutes: 0, aiCostPolicy: "absorbed",
    kind: "employment",
  });
  store.setProjectSync(db, {
    projectId: localProjectId, scope: "team",
    remoteProjectId: result.projectId, remoteOrgId: result.ownerAccountId,
    inviteToken: options.token,
  });

  return {
    projectName: result.projectName, emails: result.emails,
    inviteeKind: result.inviteeKind, localProjectId,
  };
}

export interface TeamMemberSummary {
  readonly emails: readonly string[];
  readonly inviteeKind: string;
  readonly seconds: number;
  readonly syncedAt: string | null;
  readonly acceptedAt: string | null;
}

/** Solo la usa el dueño: `estela team list`, y `buildTeam()` al publicar. */
export async function listTeamMembers(db: DatabaseSync, projectId: string): Promise<TeamMemberSummary[]> {
  const account = requireAccount(db);
  const result = await unwrap(cloudGet<{ members: TeamMemberSummary[] }>(
    account.apiBaseUrl, `/team/members?projectId=${encodeURIComponent(projectId)}`,
    { deviceToken: account.deviceToken }));
  return result.members;
}

/** `estela team revoke --token <token>`. Baja también la cantidad de la suscripción de Teams. */
export async function revokeTeamMember(db: DatabaseSync, token: string): Promise<void> {
  const account = requireAccount(db);
  await unwrap(cloudPost(account.apiBaseUrl, "/team/revoke", { token },
    { deviceToken: account.deviceToken }));
}
