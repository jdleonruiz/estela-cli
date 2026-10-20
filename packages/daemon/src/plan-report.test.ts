import assert from "node:assert/strict";
import { test } from "node:test";

import { withLang } from "./i18n/index.js";
import { analyzePlan, type PlanAnalysis } from "./metrics/plan.js";
import { planToJson, renderNoData, renderNoPlan, renderPlanReport } from "./plan-report.js";
import type { RateSample } from "./rate-history.js";

/**
 * Lo que enseña `estela plan`. La regla que más importa aquí: ningún texto
 * dice cuánto te queda ni habla de tokens, en ningún caso y en ningún idioma.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);
const NOW = new Date(T0 + 40 * DAY);

function dias(n: number, peak: (d: number) => number, w7 = 30): RateSample[] {
  return Array.from({ length: n }, (_, i) => {
    const start = T0 + (40 - n + i) * DAY + 5 * 3_600_000;
    const reset = Math.floor((start + 5 * 3_600_000) / 1000);
    return [0.5, 1].map((f, k) => ({
      ts: start + (k + 1) * 3_600_000, src: "claude-code" as const, w5: peak(i) * f, w5_reset: reset,
      w7, w7_reset: Math.floor((T0 + 7 * DAY * (Math.floor((40 - n + i) / 7) + 1)) / 1000),
    }));
  }).flat();
}

const analizar = (samples: RateSample[], plan: "pro" | "max5" | "max20" = "max5") =>
  analyzePlan({ samples, plan, since: new Date(0), now: NOW, days: 28, localDay: (ms) => String(Math.floor(ms / DAY)) });

/** Un caso por cada rama de la salida. */
const CASOS: Record<string, PlanAnalysis> = {
  justoConSuperior: analizar(dias(14, (d) => (d % 3 === 0 ? 100 : 30))),
  justoSinSuperior: analizar(dias(14, () => 100), "max20"),
  bastaba: analizar(dias(14, () => 16)),
  casi: analizar(dias(14, (d) => (d < 2 ? 21 : 10))),
  encaja: analizar(dias(14, () => 30)),
  provisional: analizar(dias(8, () => 30)),
  insuficiente: analizar(dias(3, () => 30)),
  sinDatos: analizar([]),
};

function todasLasSalidas(): string[] {
  const out: string[] = [];
  for (const lang of ["es", "en"] as const) {
    withLang(lang, () => {
      for (const a of Object.values(CASOS)) {
        out.push(renderPlanReport(a, { color: false, now: NOW, blocks: { fiveHour: 2, sevenDay: 1 } }));
        out.push(renderPlanReport(a, { color: true, now: new Date(T0 + 400 * DAY), blocks: null }));
        out.push(JSON.stringify(planToJson(a, { blocks: null, now: NOW })));
      }
      out.push(renderNoPlan(), renderNoData(CASOS["sinDatos"]!, true, false), renderNoData(CASOS["sinDatos"]!, false, false));
    });
  }
  return out;
}

test("ningún texto dice cuánto queda ni habla de tokens, en español ni en inglés", () => {
  for (const text of todasLasSalidas()) {
    assert.doesNotMatch(text, /quedan?|queda\b|remaining|left\b|tokens?/i, text);
  }
});

test("siempre lleva el aviso semanal, la fuente del multiplicador y el aviso de repetirlo", () => {
  withLang("es", () => {
    for (const a of Object.values(CASOS).filter((x) => x.dataState !== "none")) {
      const t = renderPlanReport(a, { color: false, now: NOW, blocks: null });
      assert.match(t, /Límite semanal entre planes: Anthropic no publica la relación\. No lo estimamos\./);
      assert.match(t, /https:\/\/support\.claude\.com\/en\/articles\/11049741-what-is-the-max-plan/);
      assert.match(t, /repite el análisis cada mes/);
    }
  });
});

test("cada rama de la recomendación tiene su frase", () => {
  withLang("es", () => {
    const r = (k: string) => renderPlanReport(CASOS[k]!, { color: false, now: NOW, blocks: null });
    assert.match(r("justoConSuperior"), /Vas justo con tu plan\. Con Max 20x habrías evitado 5 de 5 topes\./);
    assert.match(r("justoSinSuperior"), /Vas justo con tu plan\.\n/);
    assert.match(r("bastaba"), /Con los datos de estas 2 semanas, el plan Pro te habría bastado en todas las ventanas de 5 h\./);
    assert.match(r("bastaba"), /80 \$ menos al mes, según la web de Anthropic a 2026-10-19; compruébalo\./);
    assert.match(r("casi"), /El plan Pro te habría bastado casi siempre: te habría bloqueado 2 veces en estas semanas\./);
    assert.match(r("encaja"), /Tu plan actual encaja con tu uso\./);
    assert.match(r("provisional"), /Recomendación \(provisional, 8 días\)/);
    assert.match(r("insuficiente"), /Datos de 3 días\. La recomendación necesita al menos 14\./);
    assert.doesNotMatch(r("insuficiente"), /Recomendación/);
  });
});

test("con topes enseña el tiempo parado como cota superior estimada", () => {
  withLang("es", () => {
    const t = renderPlanReport(CASOS["justoSinSuperior"]!, { color: false, now: NOW, blocks: null });
    assert.match(t, /Parado tras topes\s+hasta \S+ \(estimado: no sabemos si seguías trabajando\)/);
  });
});

test("precios con más de 90 días: lo avisa", () => {
  withLang("es", () => {
    const fresco = renderPlanReport(CASOS["encaja"]!, { color: false, now: new Date("2026-10-20T00:00:00Z"), blocks: null });
    const viejo = renderPlanReport(CASOS["encaja"]!, { color: false, now: new Date("2027-02-01T00:00:00Z"), blocks: null });
    assert.doesNotMatch(fresco, /desactualizados/);
    assert.match(viejo, /los precios pueden estar desactualizados/);
  });
});

test("--no-color: ni un código de escape", () => {
  for (const a of Object.values(CASOS)) {
    assert.doesNotMatch(renderPlanReport(a, { color: false, now: NOW, blocks: null }), /\x1b\[/);
  }
  assert.match(renderPlanReport(CASOS["encaja"]!, { color: true, now: NOW, blocks: null }), /\x1b\[38;2;70;192;167mestela/);
});

/** La forma del JSON: nombres de campo y tipos, sin los valores. */
function forma(v: unknown): unknown {
  if (Array.isArray(v)) return v.length ? [forma(v[0])] : [];
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, forma(x)]));
  }
  return v === null ? "null" : typeof v;
}

test("--json: estructura estable", () => {
  const j = planToJson(CASOS["casi"]!, { blocks: { fiveHour: 2, sevenDay: 1 }, now: NOW });
  assert.deepEqual(forma(j), {
    alternatives: [{
      blockedWindows: "number", capsAvoided: "number", direction: "string", maxEquivalent: "number",
      monthlyDiffUsd: "number", monthlyUsd: "number", name: "string", p90Equivalent: "number", plan: "string",
    }],
    blocks429: { fiveHour: "number", sevenDay: "number" },
    dataState: "string",
    fiveHour: { caps: "number", maxPeak: "number", medianPeak: "number", p90Peak: "number",
                stoppedMinutesUpperBound: "number", windows: "number" },
    period: { daysWithData: "number", days: "number", from: "string", samples: "number", to: "string" },
    plan: { id: "string", name: "string", sessionMultiplier: "number", since: "string" },
    plans: [{ id: "string", monthlyUsd: "number", name: "string", sessionMultiplier: "number" }],
    recommendation: { blockedWindows: "number", capsAvoided: "null", kind: "string", plan: "string",
                      provisional: "boolean", text: "string" },
    sources: { prices: "string", pricesCheckedAt: "string", pricesStale: "boolean", sessionMultiplier: "string" },
    version: "number",
    week: { maxPeak: "number", medianPeak: "number", weeks: "number", weeksAtOrAbove90: "number" },
    weeklyBetweenPlans: "string",
  });
  assert.equal(j.version, 1);
  assert.equal(j.weeklyBetweenPlans, "not_published");
  assert.deepEqual(j.recommendation, {
    kind: "almost", provisional: false, plan: "pro", blockedWindows: 2, capsAvoided: null,
    text: j.recommendation!.text,
  });
});
