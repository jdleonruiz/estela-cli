/**
 * Catálogo de precios con fechas de vigencia.
 *
 * Los precios son **datos**, no constantes en el código. Motivo: recalcular el
 * histórico. Si en marzo baja el precio de un modelo y en noviembre reconstruyes
 * un informe de enero, el informe debe seguir dando lo mismo que dio en enero.
 * Por eso cada entrada lleva `effectiveFrom` y el cálculo busca la vigente en la
 * fecha del turno, nunca "la actual".
 *
 * Fuente: tarifas de la API de Anthropic (precio por millón de tokens).
 * Multiplicadores de caché: lectura 0.1x sobre input; escritura 1.25x con TTL de
 * 5 minutos y 2x con TTL de 1 hora.
 */

export interface ModelPrice {
  /** Prefijo de `model` con el que casa esta entrada. */
  readonly modelPrefix: string;
  readonly effectiveFrom: string; // ISO date
  /** USD por millón de tokens de entrada sin cachear. */
  readonly inputPerMTok: number;
  /** USD por millón de tokens de salida. */
  readonly outputPerMTok: number;
  readonly cacheReadMultiplier: number;
  readonly cacheWrite5mMultiplier: number;
  readonly cacheWrite1hMultiplier: number;
}

const STANDARD_CACHE = {
  cacheReadMultiplier: 0.1,
  cacheWrite5mMultiplier: 1.25,
  cacheWrite1hMultiplier: 2.0,
} as const;

/**
 * Ordenado por especificidad de prefijo (el más largo gana) y luego por fecha.
 * `resolvePrice` se encarga del orden; aquí basta con que estén todos.
 */
export const PRICE_CATALOG: readonly ModelPrice[] = [
  // --- Anthropic ---
  { modelPrefix: "claude-fable-5",   effectiveFrom: "2020-01-01", inputPerMTok: 10, outputPerMTok: 50, ...STANDARD_CACHE },
  { modelPrefix: "claude-mythos-5",  effectiveFrom: "2020-01-01", inputPerMTok: 10, outputPerMTok: 50, ...STANDARD_CACHE },
  { modelPrefix: "claude-opus-5",    effectiveFrom: "2020-01-01", inputPerMTok: 5,  outputPerMTok: 25, ...STANDARD_CACHE },
  { modelPrefix: "claude-opus-4-8",  effectiveFrom: "2020-01-01", inputPerMTok: 5,  outputPerMTok: 25, ...STANDARD_CACHE },
  { modelPrefix: "claude-opus-4-7",  effectiveFrom: "2020-01-01", inputPerMTok: 5,  outputPerMTok: 25, ...STANDARD_CACHE },
  { modelPrefix: "claude-opus-4-6",  effectiveFrom: "2020-01-01", inputPerMTok: 5,  outputPerMTok: 25, ...STANDARD_CACHE },
  { modelPrefix: "claude-sonnet-5",  effectiveFrom: "2020-01-01", inputPerMTok: 2,  outputPerMTok: 10, ...STANDARD_CACHE },
  { modelPrefix: "claude-sonnet-4-6",effectiveFrom: "2020-01-01", inputPerMTok: 3,  outputPerMTok: 15, ...STANDARD_CACHE },
  { modelPrefix: "claude-haiku-4-5", effectiveFrom: "2020-01-01", inputPerMTok: 1,  outputPerMTok: 5,  ...STANDARD_CACHE },
  // Familias antiguas: prefijo corto como red de seguridad.
  { modelPrefix: "claude-opus",      effectiveFrom: "2020-01-01", inputPerMTok: 5,  outputPerMTok: 25, ...STANDARD_CACHE },
  { modelPrefix: "claude-sonnet",    effectiveFrom: "2020-01-01", inputPerMTok: 3,  outputPerMTok: 15, ...STANDARD_CACHE },
  { modelPrefix: "claude-haiku",     effectiveFrom: "2020-01-01", inputPerMTok: 1,  outputPerMTok: 5,  ...STANDARD_CACHE },
];

/**
 * Busca el precio vigente para un modelo en una fecha.
 *
 * Devuelve `null` en vez de adivinar cuando el modelo no está en el catálogo:
 * un coste inventado en una factura es peor que un coste ausente, porque el
 * ausente se ve y el inventado no.
 */
export function resolvePrice(model: string, at: Date): ModelPrice | null {
  const id = model.toLowerCase();
  const iso = at.toISOString();

  const candidates = PRICE_CATALOG
    .filter((p) => id.startsWith(p.modelPrefix) && p.effectiveFrom <= iso)
    .sort((a, b) =>
      b.modelPrefix.length - a.modelPrefix.length ||
      b.effectiveFrom.localeCompare(a.effectiveFrom));

  return candidates[0] ?? null;
}
