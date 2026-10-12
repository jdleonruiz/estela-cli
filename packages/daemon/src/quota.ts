import { basename } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import * as store from "./db/store.js";
import { buildQuota, quotaRange, type QuotaBucket, type QuotaReport } from "./metrics/quota.js";
import { scanAgents } from "./watchers/agents.js";

/**
 * La cuota sobre la base: lo que comparten `estela quota` y el panel web.
 * El cálculo vive en `metrics/quota.ts`; aquí solo se leen los datos.
 */

export function loadQuotaReport(db: DatabaseSync, now: Date = new Date()): QuotaReport {
  const range = quotaRange(now);
  const names = new Map(store.listProjects(db).map((p) => [p.id, p.name]));

  // Un proyecto por carpeta, una sola vez: `projectForRepo` lee todos los
  // repos vinculados en cada llamada, y una semana tiene miles de turnos.
  const cache = new Map<string, QuotaBucket>();
  const bucketOf = (repoPath: string | null): QuotaBucket => {
    if (!repoPath) return { kind: "none" };
    let bucket = cache.get(repoPath);
    if (!bucket) {
      const projectId = store.projectForRepo(db, repoPath);
      bucket = projectId
        ? { kind: "project", projectId, projectName: names.get(projectId) ?? projectId }
        : { kind: "folder", folder: basename(repoPath.replace(/[\\/]+$/, "")) || repoPath };
      cache.set(repoPath, bucket);
    }
    return bucket;
  };

  return buildQuota({
    turns: store.quotaTurns(db, range.start, range.end),
    firstTurnAt: store.firstTurnByAgent(db),
    now,
    bucketOf,
  });
}

/**
 * Trae los turnos de esta semana antes de calcular.
 *
 * Sin esto, la "ventana actual" sería la de la última vez que alguien ejecutó
 * `estela import`, que puede ser de ayer. Solo se leen los transcripts desde el
 * lunes, y solo se guardan turnos: `INSERT OR IGNORE` sobre el `turn_id` hace
 * que repetirlo no duplique nada, y el siguiente `import` reconstruye las horas
 * con lo que lee él mismo, así que no se le quita trabajo.
 */
export async function refreshQuotaTurns(db: DatabaseSync, since: Date): Promise<number> {
  const scans = await scanAgents({ since });
  return store.saveTurns(db, scans.flatMap((s) => [...s.turns]));
}
