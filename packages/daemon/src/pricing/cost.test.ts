import assert from "node:assert/strict";
import { test } from "node:test";

import type { TokenUsage } from "@estela/shared";
import { breakdownOfTurn, costOfTurn } from "./cost.js";
import { resolvePrice } from "./catalog.js";

const AT = new Date("2026-08-21T12:27:42.626Z");

/**
 * Caso dorado, medido sobre un transcript real de Claude Code (445 líneas,
 * 186 filas `assistant`, 65 turnos únicos). Estos totales son los deduplicados.
 *
 * Si este test se cae, o cambió el catálogo de precios o cambió el parser: en
 * ambos casos hay que revisarlo antes de emitir una factura.
 */
const GOLDEN: TokenUsage = {
  input: 130,
  output: 59_962,
  cacheRead: 5_713_309,
  cacheWrite5m: 0,
  cacheWrite1h: 366_030,
};

test("coste dorado de una sesión real de Opus 5", () => {
  const cost = costOfTurn(GOLDEN, "claude-opus-5", AT);
  assert.ok(cost);
  // input 130 * $5/1M                  = $0.0006500
  // output 59.962 * $25/1M             = $1.4990500
  // cacheRead 5.713.309 * $5/1M * 0.1  = $2.8566545
  // cacheWrite1h 366.030 * $5/1M * 2   = $3.6603000
  //                                    = $8.0166545
  assert.equal(cost.microUsd, 8_016_655);
  assert.equal((cost.microUsd / 1e6).toFixed(2), "8.02");
});

test("ignorar la caché infravalora el coste más de 5x", () => {
  const real = costOfTurn(GOLDEN, "claude-opus-5", AT)!;
  const naive = costOfTurn(
    { ...GOLDEN, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    "claude-opus-5", AT)!;

  assert.equal((naive.microUsd / 1e6).toFixed(2), "1.50");
  assert.ok(real.microUsd / naive.microUsd > 5,
    `esperado >5x, obtenido ${(real.microUsd / naive.microUsd).toFixed(1)}x`);
});

test("la caché es la mayor parte del gasto", () => {
  const b = breakdownOfTurn(GOLDEN, "claude-opus-5", AT);
  assert.ok(b);
  assert.ok(b.cacheShare > 0.8, `esperado >80%, obtenido ${(b.cacheShare * 100).toFixed(1)}%`);
  assert.equal(b.total.microUsd,
    b.input.microUsd + b.output.microUsd + b.cacheRead.microUsd + b.cacheWrite.microUsd);
});

test("escribir caché a 1h cuesta el doble que a 5m", () => {
  const base = { input: 0, output: 0, cacheRead: 0 };
  const w5m = costOfTurn({ ...base, cacheWrite5m: 1_000_000, cacheWrite1h: 0 }, "claude-opus-5", AT)!;
  const w1h = costOfTurn({ ...base, cacheWrite5m: 0, cacheWrite1h: 1_000_000 }, "claude-opus-5", AT)!;

  assert.equal(w5m.microUsd, 6_250_000);   // $5 * 1.25
  assert.equal(w1h.microUsd, 10_000_000);  // $5 * 2
  assert.equal(w1h.microUsd, w5m.microUsd * 1.6);
});

test("un modelo desconocido devuelve null en vez de inventar un precio", () => {
  assert.equal(costOfTurn(GOLDEN, "modelo-que-no-existe", AT), null);
  assert.equal(resolvePrice("modelo-que-no-existe", AT), null);
});

test("gana el prefijo más específico", () => {
  const opus5 = resolvePrice("claude-opus-5", AT);
  const sonnet46 = resolvePrice("claude-sonnet-4-6", AT);
  assert.equal(opus5?.modelPrefix, "claude-opus-5");
  assert.equal(opus5?.inputPerMTok, 5);
  assert.equal(sonnet46?.modelPrefix, "claude-sonnet-4-6");
  assert.equal(sonnet46?.inputPerMTok, 3);
});

test("precios distintos por familia de modelo", () => {
  const usage: TokenUsage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };
  assert.equal(costOfTurn(usage, "claude-opus-5", AT)!.microUsd, 5_000_000);
  assert.equal(costOfTurn(usage, "claude-sonnet-5", AT)!.microUsd, 2_000_000);
  assert.equal(costOfTurn(usage, "claude-haiku-4-5", AT)!.microUsd, 1_000_000);
});

/**
 * Codex. Tarifas de la página oficial de OpenAI, consultadas el 23/09/2026:
 * gpt-5.6-terra a $2.00 de entrada y $12.00 de salida por millón, con la caché
 * a $0.20 (0.1x) y la escritura a $2.50 (1.25x) — los mismos multiplicadores
 * que Anthropic, así que STANDARD_CACHE vale para los dos.
 */
test("coste de un turno de Codex con gpt-5.6-terra", () => {
  const uso: TokenUsage = {
    input: 1_000_000, output: 1_000_000,
    cacheRead: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 0,
  };

  const cost = costOfTurn(uso, "gpt-5.6-terra", AT);

  assert.ok(cost, "gpt-5.6-terra tiene que estar en el catálogo");
  // input   1M * $2/1M          = $ 2.00
  // output  1M * $12/1M         = $12.00
  // caché   1M * $2/1M * 0.1    = $ 0.20
  // escrit. 1M * $2/1M * 1.25   = $ 2.50
  assert.equal(cost.microUsd, 16_700_000);
});

test("los modelos de OpenAI que no están en el catálogo no se inventan", () => {
  // La regla del fichero: un coste ausente se ve, uno inventado no. Sin
  // comodín por familia, porque entre sol, terra y luna hay 20x de diferencia
  // y un prefijo corto los mal-tarifaría en silencio.
  assert.equal(resolvePrice("gpt-5.6-inventado", AT), null);
  assert.equal(costOfTurn({ input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    "gpt-5.6-inventado", AT), null);
});
