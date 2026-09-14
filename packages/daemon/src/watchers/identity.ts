import type { DatabaseSync } from "node:sqlite";

import type { CommitRecord } from "@estela/shared";

import * as store from "../db/store.js";
import { gitUserEmail, repoRoot } from "./git.js";

/**
 * Qué commits son tuyos.
 *
 * Desde que existe la vista de equipo, `commits` guarda a **todos** los autores
 * del repositorio: es lo que permite enseñar el trabajo del equipo sin que cada
 * compañero instale nada. Pero eso convierte una tabla que antes solo contenía
 * trabajo tuyo en una que contiene el de seis personas.
 *
 * Todo lo que imputa horas tiene que filtrar por aquí antes de sessionizar. Si
 * no, `sessionizeCommits()` derivaría bloques de los commits de tus compañeros
 * y te los imputaría como tiempo tuyo: acabarías facturándole a un cliente el
 * trabajo de otra persona. Es el peor fallo que este sistema puede cometer, así
 * que la decisión vive en un solo sitio y la CLI y el servidor lo comparten.
 */

/**
 * Correos con los que commiteas en cada repositorio, indexados por su raíz.
 *
 * Manda lo configurado con `estela author`. Solo si un repositorio no tiene
 * autores declarados se cae a `git config user.email`, que es la suposición que
 * en el repositorio de un cliente casi nunca acierta — ahí commiteas con el
 * correo de la empresa, no con el tuyo.
 */
export async function myEmailsByRepo(
  db: DatabaseSync, repoPaths: Iterable<string>,
): Promise<Map<string, Set<string>>> {
  const configured = store.authorsByRepo(db);
  const mine = new Map<string, Set<string>>();

  for (const path of repoPaths) {
    const root = await repoRoot(path);
    if (!root || mine.has(root)) continue;

    const declared = configured.get(root) ?? configured.get(path) ?? [];
    const emails = declared.length ? declared : [await gitUserEmail(root)].filter(Boolean);
    mine.set(root, new Set(emails as string[]));
  }
  return mine;
}

/**
 * Se queda solo con tus commits.
 *
 * Un repositorio sin ningún correo conocido no aporta nada: preferimos perder
 * horas a imputarte las de otro. Quedarse corto se arregla con
 * `estela author`; haber facturado trabajo ajeno, no.
 */
export function onlyMine(
  commits: readonly CommitRecord[], mine: ReadonlyMap<string, Set<string>>,
): CommitRecord[] {
  return commits.filter((c) => mine.get(c.repoPath)?.has(c.authorEmail) ?? false);
}
