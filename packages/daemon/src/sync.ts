import type { DatabaseSync } from "node:sqlite";

import { cloudPost, CloudError } from "./cloud/client.js";
import * as store from "./db/store.js";
import type { SyncableEntry } from "./db/store.js";
import { NoAccountError } from "./publish.js";
import { tr } from "./i18n/index.js";

/**
 * Sync personal (Pro): las máquinas de una misma cuenta sincronizan las
 * imputaciones de un proyecto entre sí.
 *
 * No inventa ningún concepto de "proyecto remoto": `project_id` es la misma
 * cadena que elegiste al crear el proyecto (`estela project add --id ...`) —
 * si usas el mismo id en la segunda máquina, es el mismo proyecto.
 */

export { NoAccountError };

export class NotSyncedError extends Error {}

export interface SyncOutcome {
  readonly projectId: string;
  readonly pushed: number;
  readonly pulled: number;
}

interface SyncResponse {
  readonly entries: readonly SyncableEntry[];
  readonly syncedUpTo: string;
}

export async function syncProject(db: DatabaseSync, projectId: string): Promise<SyncOutcome> {
  const account = store.getCloudAccount(db);
  if (!account) {
    throw new NoAccountError(
      tr`Necesitas una cuenta para sincronizar. Vincúlala con:\n\n` +
      tr`  estela login --email tu@correo.com\n`);
  }

  const sync = store.getProjectSync(db, projectId);
  if (!sync) {
    throw new NotSyncedError(
      tr`Este proyecto no sincroniza. Actívalo con:\n\n` +
      tr`  estela sync enable --project ${projectId}\n`);
  }

  const since = store.getSyncCursor(db, projectId);
  const push = store.listEntriesUpdatedSince(db, projectId, since);

  let result: SyncResponse;
  try {
    result = await cloudPost(account.apiBaseUrl, "/sync/entries",
      { projectId, since, push },
      { deviceToken: account.deviceToken });
  } catch (error) {
    // El 402 se deja pasar tal cual. Envolverlo en un Error pelado perdía lo
    // único que importaba: el manejador del CLI imprime CloudError limpio y
    // cualquier otra cosa como un volcado de pila. "Sincronizar es de Pro" no
    // es un fallo del programa, es una respuesta — y salía como si se hubiera
    // roto algo. El mensaje ya viene redactado del servidor.
    if (error instanceof CloudError && error.status === 401) {
      throw new NoAccountError(
        tr`Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n` +
        tr`  estela login --email tu@correo.com\n`);
    }
    throw error;
  }

  for (const entry of result.entries) store.applySyncedEntry(db, entry, projectId);
  store.recordSyncCursor(db, projectId, result.syncedUpTo);

  return { projectId, pushed: push.length, pulled: result.entries.length };
}
