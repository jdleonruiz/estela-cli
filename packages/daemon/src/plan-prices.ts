/**
 * Los planes de Claude que analiza `estela plan`: lo único que Estela sabe de
 * ellos, en un solo sitio y con su fuente.
 *
 * - El multiplicador por sesión de 5 h es el que publica Anthropic: Max 5x da
 *   5 veces la cuota por sesión de Pro, y Max 20x, 20 veces.
 * - Del límite semanal Anthropic no publica la relación entre planes, así que
 *   aquí no hay ningún número para él, y no se compara.
 * - Los precios son los de la suscripción web, en USD al mes, y caducan:
 *   `estela plan` avisa si la fecha de comprobación tiene más de 90 días.
 */

export type ClaudePlanId = "pro" | "max5" | "max20";

export interface ClaudePlan {
  readonly id: ClaudePlanId;
  readonly name: string;
  /** Veces la cuota por sesión de 5 h de Pro. */
  readonly sessionMultiplier: number;
  readonly monthlyUsd: number;
}

export const CLAUDE_PLANS: readonly ClaudePlan[] = [
  { id: "pro", name: "Pro", sessionMultiplier: 1, monthlyUsd: 20 },
  { id: "max5", name: "Max 5x", sessionMultiplier: 5, monthlyUsd: 100 },
  { id: "max20", name: "Max 20x", sessionMultiplier: 20, monthlyUsd: 200 },
];

export const MULTIPLIER_SOURCE = "https://support.claude.com/en/articles/11049741-what-is-the-max-plan";
export const PRICES_SOURCE = "https://claude.com/pricing";
/** Cuándo se comprobaron los precios en `PRICES_SOURCE`. */
export const PRICES_CHECKED_AT = "2026-10-19";
export const PRICES_STALE_DAYS = 90;

export function planById(id: string): ClaudePlan | null {
  return CLAUDE_PLANS.find((p) => p.id === id) ?? null;
}
