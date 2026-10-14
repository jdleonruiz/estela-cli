import type { DatabaseSync } from "node:sqlite";

import * as store from "./db/store.js";
import { buildQuota, officialWindow, quotaRange, type QuotaBucket, type QuotaReport } from "./metrics/quota.js";
import { ownerResolver } from "./project-of.js";
import { readFiveHourReset } from "./statusline-cache.js";
import { scanAgents } from "./watchers/agents.js";

/**
 * La cuota sobre la base: lo que comparten `estela quota` y el panel web.
 * El cálculo vive en `metrics/quota.ts`; aquí solo se leen los datos.
 */

export interface QuotaLoadOptions {
  /** % por precio de lista en vez de por tokens (`--weighted`). */
  readonly weighted?: boolean;
  /**
   * La base de la que se lee, para encontrar al lado lo que guardó la status
   * line (el `resets_at` de Claude Code). Sin ella, la ventana se estima.
   */
  readonly dbPath?: string;
}

export function loadQuotaReport(db: DatabaseSync, now: Date = new Date(), options: QuotaLoadOptions = {}): QuotaReport {
  const range = quotaRange(now);
  const names = new Map(store.listProjects(db).map((p) => [p.id, p.name]));

  // La carpeta, y si no, su raíz git: ver project-of.ts. Una carpeta sin
  // proyecto sale con el nombre de su raíz git, no el de una subcarpeta.
  const ownerOf = ownerResolver(db);
  const bucketOf = (repoPath: string | null): QuotaBucket => {
    const o = ownerOf(repoPath);
    if (o.kind === "project") return { kind: "project", projectId: o.projectId, projectName: names.get(o.projectId) ?? o.projectId };
    if (o.kind === "folder") return { kind: "folder", folder: o.name, path: o.path };
    return { kind: "none" };
  };

  return buildQuota({
    turns: store.quotaTurns(db, range.start, range.end),
    firstTurnAt: store.firstTurnByAgent(db),
    now,
    bucketOf,
    weighted: options.weighted === true,
    claudeWindow: options.dbPath ? officialWindow(readFiveHourReset(options.dbPath), now) : null,
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
