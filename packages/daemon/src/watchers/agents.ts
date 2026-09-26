import type { AgentKind, AgentTurn, ParseReport } from "@estela/shared";

import { resolveScratchpads, scanClaudeCode } from "./claude.js";
import { scanCodex } from "./codex.js";
import { defaultCopilotRoots, scanCopilot } from "./copilot.js";

/**
 * Escaneo de todos los agentes que Estela sabe leer.
 *
 * Existe para que añadir un agente sea tocar un sitio y no tres. Antes de esto,
 * `setup`, `import` y el servidor del panel llamaban cada uno a Claude Code por
 * su cuenta, así que un agente nuevo se olvidaba en alguno.
 *
 * Los informes van **por agente y sin mezclar**: `logScan` guarda uno por cada
 * uno, y el canario de formato de Codex no debe quedar tapado porque el de
 * Claude Code esté sano.
 */

export interface AgentScan {
  readonly agent: AgentKind;
  readonly turns: readonly AgentTurn[];
  readonly report: ParseReport;
  /**
   * Turnos devueltos de un scratchpad a su repositorio.
   *
   * La CLI lo imprime porque son horas que sin el rescate no aparecían en
   * ningún proyecto. Solo Claude Code los tiene; Codex trabaja en el repo.
   */
  readonly scratchpadsResolved: number;
}

export interface AgentScanOptions {
  readonly since?: Date;
  readonly repoPaths?: readonly string[];
  /** Raíces de cada store. Inyectables para los tests; en producción, ~/. */
  readonly roots?: {
    readonly claudeCode?: string;
    readonly codex?: string;
    /**
     * Carpetas `workspaceStorage` de VS Code. Si se pasan `roots` sin esta, no
     * se lee Copilot: un test que prepara sus propios Claude y Codex no puede
     * acabar leyendo las sesiones reales de VS Code de quien lo corre.
     */
    readonly copilot?: readonly string[];
  };
}

export async function scanAgents(options: AgentScanOptions = {}): Promise<AgentScan[]> {
  const comunes = {
    ...(options.since ? { since: options.since } : {}),
    ...(options.repoPaths ? { repoPaths: options.repoPaths } : {}),
  };

  // En paralelo: son dos lecturas de disco independientes, y en un portátil con
  // meses de historial la diferencia se nota en `estela setup`.
  const [claude, codex, copilot] = await Promise.all([
    scanClaudeCode({ ...comunes, ...(options.roots?.claudeCode ? { root: options.roots.claudeCode } : {}) }),
    scanCodex({ ...comunes, ...(options.roots?.codex ? { root: options.roots.codex } : {}) }),
    scanCopilot({ ...comunes, roots: options.roots ? (options.roots.copilot ?? []) : defaultCopilotRoots() }),
  ]);

  // El scratchpad solo lo tiene Claude Code; Codex trabaja en el repositorio.
  const rescatados = resolveScratchpads(claude.turns);
  const movidos = rescatados.filter((t, i) => t.repoPath !== claude.turns[i]!.repoPath).length;

  return [
    { agent: "claude-code", turns: rescatados, report: claude.report, scratchpadsResolved: movidos },
    { agent: "codex", turns: codex.turns, report: codex.report, scratchpadsResolved: 0 },
    { agent: "copilot", turns: copilot.turns, report: copilot.report, scratchpadsResolved: 0 },
  ];
}

/** Todos los turnos de todos los agentes, ordenados en el tiempo. */
export function allTurns(scans: readonly AgentScan[]): AgentTurn[] {
  return scans.flatMap((s) => [...s.turns]).sort((a, b) => a.at.getTime() - b.at.getTime());
}
