import assert from "node:assert/strict";
import { test } from "node:test";

import { formatAiCost, formatMoney } from "@estela/shared";

/**
 * El coste de IA sale con los separadores del idioma, igual que la cuota. En
 * español una misma tabla salía con "$12.86" en la columna API y "$71,67" en la
 * de la cuota.
 */

test("el coste de IA usa los mismos separadores que el resto de importes", () => {
  const api = { microUsd: 12_860_000 };
  const real = { amount: 7_167, currency: "USD" as const };
  assert.equal(formatAiCost(api, "es-EC"), "$12,86");
  assert.equal(formatMoney(real, "es-EC"), "$71,67");
  assert.equal(formatAiCost(api, "en-US"), "$12.86");
  assert.equal(formatMoney(real, "en-US"), "$71.67");
});

test("menos de un céntimo, cuatro decimales; y separador de miles", () => {
  assert.equal(formatAiCost({ microUsd: 1_200 }, "es-EC"), "$0,0012");
  assert.equal(formatAiCost({ microUsd: 1_200 }, "en-US"), "$0.0012");
  assert.equal(formatAiCost({ microUsd: 0 }, "es-EC"), "$0,00");
  assert.equal(formatAiCost({ microUsd: 42_999_710_000 }, "en-US"), "$42,999.71");
  assert.equal(formatAiCost({ microUsd: 42_999_710_000 }, "es-EC"), "$42.999,71");
});
