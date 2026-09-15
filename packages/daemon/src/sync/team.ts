import type { DatabaseSync } from "node:sqlite";

import { cloudPost, CloudError } from "../cloud/client.js";
import * as store from "../db/store.js";
import { NoAccountError } from "../publish.js";
import { NotSyncedError } from "../sync.js";
import { rootCommitFingerprint } from "../watchers/git.js";
import { tr } from "../i18n/index.js";

/**
 * `estela sync` para un proyecto de alcance 'team'.
 *
 * Deliberadamente un módulo aparte de `../sync.ts` (sync personal), que ya
 * está en producción con tráfico real: el protocolo es distinto de verdad
 * (aquí se manda el total actual, ahí se empuja/tira con cursor), así que
 * mezclarlos habría sido un `if` interno en una función que ya no debería
 * cambiar de forma. `store.listTeamSyncedProjects()` ya documentaba, desde
 * antes de que este fichero existiera, que era "lo único que sube
 * sync/team.ts".
 */

export { NoAccountError, NotSyncedError };

export interface TeamSyncOutcome {
  readonly projectId: string;
  readonly seconds: number;
}

/**
 * Huella del proyecto que se manda a la nube: la de cada repo local que
 * tiene enlazado, combinada.
 *
 * Es lo que hace que un proyecto con más de un repositorio (monorepo,
 * front+back en la misma máquina) no dispare el rechazo: sus huellas llegan
 * juntas en un solo sync, así que la nube las registra todas a la vez la
 * primera vez, no una a una.
 */
async function projectFingerprint(repoPaths: readonly string[]): Promise<string | undefined> {
  const huellas = (await Promise.all(repoPaths.map((p) => rootCommitFingerprint(p))))
    .filter((h): h is string => h !== null);
  if (!huellas.length) return undefined;
  return [...new Set(huellas)].sort().join(",");
}

export async function syncTeamProject(db: DatabaseSync, projectId: string): Promise<TeamSyncOutcome> {
  const account = store.getCloudAccount(db);
  if (!account) {
    throw new NoAccountError(
      tr`Necesitas una cuenta para sincronizar. Vincúlala con:\n\n` +
      tr`  estela login --email tu@correo.com\n`);
  }

  const sync = store.getProjectSync(db, projectId);
  if (!sync || sync.scope !== "team" || !sync.inviteToken) {
    throw new NotSyncedError(
      tr`Este proyecto no es de equipo, o le falta la invitación. Actívalo con:\n\n` +
      tr`  estela team accept --token <token> --as-id ${projectId}\n`);
  }

  const seconds = store.sumEntrySeconds(db, projectId);
  // El total va con su desglose por día: sin él, quien te invitó ve una cifra
  // suelta y no puede saber si el trabajo sigue vivo o se paró hace tres
  // semanas.
  const days = store.entrySecondsByDay(db, projectId);

  // El coste de IA solo viaja si TÚ dijiste que sí. Sin ese 'granted'
  // guardado aquí, en tu propia máquina, no se manda ni un céntimo.
  const consent = store.getAiConsent(db, projectId);
  const conCoste = consent?.decision === "granted"
    ? store.entryAiByDay(db, projectId)
    : null;

  const project = store.getProject(db, projectId);
  const repoFingerprint = await projectFingerprint(project?.repoPaths ?? []);

  let respuesta: { aiCost?: { requested?: boolean; decision?: string } } = {};
  try {
    // El detalle va siempre: es lo que compra quien paga Teams, y es
    // información que ya está en su repositorio. El coste de IA sigue
    // dependiendo del consentimiento, y viaja aparte dentro de `days`.
    respuesta = await cloudPost(account.apiBaseUrl, "/team/hours",
      { token: sync.inviteToken, seconds,
        days: conCoste ?? days,
        entries: store.entryDetailForTeam(db, projectId),
        ...(repoFingerprint ? { repoFingerprint } : {}) },
      { deviceToken: account.deviceToken });
  } catch (error) {
    if (error instanceof CloudError && error.status === 401) {
      throw new NoAccountError(
        tr`Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n` +
        tr`  estela login --email tu@correo.com\n`);
    }
    throw error;
  }

  // Si quien te invitó ha pedido el coste de IA, te enteras aquí: es lo que
  // esta máquina hace a diario. Se guarda para que el aviso siga saliendo
  // hasta que decidas, y no se pierda por no haber mirado esta vez.
  if (respuesta.aiCost?.requested && consent?.decision !== "granted") {
    store.setAiConsent(db, projectId, true, "pending");
  }

  return { projectId, seconds };
}
