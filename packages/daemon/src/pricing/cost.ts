import type { AiCost, TokenUsage } from "@estela/shared";
import { resolvePrice } from "./catalog.js";

/**
 * Coste de un turno de agente, con la caché incluida.
 *
 * Medido sobre transcripts reales, la caché es la mayor parte del gasto: en una
 * sesión típica los `input_tokens` sin cachear son unos cientos mientras que los
 * `cache_read` son millones. Calcular `input * precio` produce un número que
 * parece plausible y está varias veces por debajo del real.
 *
 * Se devuelve en micro-USD enteros para que sumar diez mil turnos no acumule
 * error de coma flotante.
 */
export function costOfTurn(usage: TokenUsage, model: string, at: Date): AiCost | null {
  const price = resolvePrice(model, at);
  if (!price) return null;

  const perToken = price.inputPerMTok / 1_000_000;
  const usd =
    usage.input * perToken +
    usage.output * (price.outputPerMTok / 1_000_000) +
    usage.cacheRead * perToken * price.cacheReadMultiplier +
    usage.cacheWrite5m * perToken * price.cacheWrite5mMultiplier +
    usage.cacheWrite1h * perToken * price.cacheWrite1hMultiplier;

  return { microUsd: Math.round(usd * 1_000_000) };
}

/** Desglose por concepto. Para explicar en la interfaz de dónde sale el número. */
export interface CostBreakdown {
  readonly input: AiCost;
  readonly output: AiCost;
  readonly cacheRead: AiCost;
  readonly cacheWrite: AiCost;
  readonly total: AiCost;
  /** Fracción del total que se va en caché. Suele rondar el 80%. */
  readonly cacheShare: number;
}

export function breakdownOfTurn(usage: TokenUsage, model: string, at: Date): CostBreakdown | null {
  const price = resolvePrice(model, at);
  if (!price) return null;

  const perToken = price.inputPerMTok / 1_000_000;
  const micro = (usd: number) => Math.round(usd * 1_000_000);

  const input = micro(usage.input * perToken);
  const output = micro(usage.output * (price.outputPerMTok / 1_000_000));
  const cacheRead = micro(usage.cacheRead * perToken * price.cacheReadMultiplier);
  const cacheWrite = micro(
    usage.cacheWrite5m * perToken * price.cacheWrite5mMultiplier +
    usage.cacheWrite1h * perToken * price.cacheWrite1hMultiplier);

  const total = input + output + cacheRead + cacheWrite;
  return {
    input: { microUsd: input },
    output: { microUsd: output },
    cacheRead: { microUsd: cacheRead },
    cacheWrite: { microUsd: cacheWrite },
    total: { microUsd: total },
    cacheShare: total === 0 ? 0 : (cacheRead + cacheWrite) / total,
  };
}
