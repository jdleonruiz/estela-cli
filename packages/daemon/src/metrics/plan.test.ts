import assert from "node:assert/strict";
import { test } from "node:test";

import type { RateSample } from "../rate-history.js";
import { analyzePlan, fiveHourWindows, median, p90, weekWindows, type PlanAnalysisInput } from "./plan.js";

/**
 * `estela plan`, las cuentas. Todo con fechas fijas y días en UTC, para que
 * no dependa de la hora ni de la zona de quien corre los tests.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1);            // 1-sep-2026, 00:00 UTC
const NOW = new Date(T0 + 40 * DAY);
const utcDay = (ms: number) => String(Math.floor(ms / DAY));

/** Una ventana de 5 h en el día `d`, hueco `slot` (0–3), con tres muestras que suben hasta `peak`. */
function ventana(d: number, slot: number, peak: number, w7?: number): RateSample[] {
  const start = T0 + d * DAY + slot * 5 * 3_600_000;
  const reset = Math.floor((start + 5 * 3_600_000) / 1000);
  return [peak / 3, (2 * peak) / 3, peak].map((w5, i) => ({
    ts: start + (i + 1) * 3_600_000, src: "claude-code" as const, w5, w5_reset: reset,
    ...(w7 !== undefined ? { w7, w7_reset: Math.floor((T0 + 7 * DAY * (Math.floor(d / 7) + 1)) / 1000) } : {}),
  }));
}

/** `dias` días seguidos, empezando hace `dias` días, con una ventana al día de pico `peak(d)`. */
function dias(n: number, peak: (d: number) => number, w7 = 30): RateSample[] {
  const first = 40 - n;
  return Array.from({ length: n }, (_, i) => ventana(first + i, 1, peak(i), w7)).flat();
}

function analizar(samples: RateSample[], over: Partial<PlanAnalysisInput> = {}) {
  return analyzePlan({ samples, plan: "max5", since: new Date(0), now: NOW, days: 28, localDay: utcDay, ...over });
}

// ── Estadística ───────────────────────────────────────────────────────────

test("mediana y p90 (rango más cercano: siempre un valor observado)", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 9);
  assert.equal(p90([5]), 5);
  assert.equal(median([]), null);
  assert.equal(p90([]), null);
});

// ── Agrupación ────────────────────────────────────────────────────────────

test("agrupa por reinicio aunque las muestras lleguen desordenadas y repetidas", () => {
  const a = ventana(1, 0, 60), b = ventana(1, 1, 30);
  const mezcla = [b[2]!, a[0]!, a[2]!, b[0]!, a[1]!, a[2]!, b[1]!, b[2]!];
  const w = fiveHourWindows(mezcla, NOW);
  assert.deepEqual(w.map((x) => x.peak), [60, 30]);
  const r = analizar(mezcla, { days: 120 });
  assert.equal(r.samples, 6, "las repetidas cuentan una vez");
});

test("el mismo reinicio con segundos distintos es la misma ventana", () => {
  const [s1, s2] = ventana(1, 0, 50);
  const w = fiveHourWindows([s1!, { ...s2!, w5_reset: s2!.w5_reset! + 20 }], NOW);
  assert.equal(w.length, 1);
});

test("una ventana con una sola muestra", () => {
  const w = fiveHourWindows([ventana(1, 0, 42)[2]!], NOW);
  assert.deepEqual(w.map((x) => [x.peak, x.samples]), [[42, 1]]);
});

test("muestras sin semana o sin 5 h: cada una cuenta solo donde tiene dato", () => {
  const solo5: RateSample = { ts: T0 + DAY, src: "claude-code", w5: 40, w5_reset: 1_788_000_000 };
  const solo7: RateSample = { ts: T0 + DAY + 1, src: "claude-code", w7: 55, w7_reset: 1_789_000_000 };
  const sinReset: RateSample = { ts: T0 + DAY + 2, src: "claude-code", w5: 99 };
  assert.deepEqual(fiveHourWindows([solo5, solo7, sinReset], NOW).map((w) => w.peak), [40]);
  assert.deepEqual(weekWindows([solo5, solo7, sinReset]).map((w) => w.peak), [55]);
});

test("semanas: pico por reinicio semanal, mediana, máximo y semanas ≥ 90", () => {
  const semana = (d: number, w7: number, reset: number): RateSample =>
    ({ ts: T0 + d * DAY, src: "claude-code", w7, w7_reset: reset });
  const s = [semana(20, 30, 1_000), semana(21, 40, 1_000), semana(27, 92, 2_000), semana(28, 70, 2_000),
             semana(34, 85, 3_000), semana(35, 60, 3_000)];
  const r = analizar(s);
  assert.deepEqual(r.week.weeks.map((w) => w.peak), [40, 92, 85]);
  assert.equal(r.week.medianPeak, 85);
  assert.equal(r.week.maxPeak, 92);
  assert.equal(r.week.weeksAtOrAbove90, 1);
});

// ── Umbrales ──────────────────────────────────────────────────────────────

test("tope: 95 sí, 94,9 no", () => {
  const w = fiveHourWindows([...ventana(1, 0, 95), ...ventana(1, 1, 94.9)], NOW);
  assert.deepEqual(w.map((x) => x.capped), [true, false]);
});

test("equivalente: 100 no bloquea, 100,1 sí", () => {
  // En Max 5x, un pico de 20 en Pro es 100; uno de 20,02 es 100,1.
  const r = analizar([...ventana(30, 0, 20), ...ventana(30, 1, 20.02)]);
  const pro = r.alternatives.find((a) => a.plan.id === "pro")!;
  assert.equal(pro.blockedWindows, 1);
  assert.ok(Math.abs(pro.maxEquivalent - 100.1) < 1e-9);
});

test("tiempo parado: desde la primera muestra ≥ 99 hasta el reinicio, solo en topes", () => {
  const start = T0 + DAY;
  const reset = Math.floor((start + 5 * 3_600_000) / 1000);
  const s: RateSample[] = [
    { ts: start + 3_600_000, src: "claude-code", w5: 80, w5_reset: reset },
    { ts: start + 2 * 3_600_000, src: "claude-code", w5: 99.5, w5_reset: reset },
    { ts: start + 3 * 3_600_000, src: "claude-code", w5: 100, w5_reset: reset },
  ];
  assert.equal(fiveHourWindows(s, NOW)[0]!.stoppedMs, 3 * 3_600_000);
  // Una ventana que aún no se ha reiniciado cuenta hasta ahora, no hasta el reinicio.
  assert.equal(fiveHourWindows(s, new Date(start + 4 * 3_600_000))[0]!.stoppedMs, 2 * 3_600_000);
  assert.equal(fiveHourWindows(ventana(1, 0, 97), NOW)[0]!.stoppedMs, 0, "tope sin llegar a 99");
});

// ── Período y cambio de plan ──────────────────────────────────────────────

test("solo cuenta desde el cambio de plan, y solo el período pedido", () => {
  const s = dias(20, (d) => (d < 10 ? 90 : 10));          // días 20–39
  const since = new Date(T0 + 30 * DAY);                   // cambio de plan el día 30
  const r = analizar(s, { since });
  assert.equal(r.daysWithData, 10);
  assert.equal(r.fiveHour.maxPeak, 10, "lo de antes del cambio no cuenta");
  assert.equal(analizar(s, { days: 5 }).daysWithData, 5);
});

// ── Datos mínimos ─────────────────────────────────────────────────────────

test("sin datos, menos de 7 días, de 7 a 13 y 14 o más", () => {
  assert.equal(analizar([]).dataState, "none");
  const seis = analizar(dias(6, () => 10));
  assert.equal(seis.dataState, "insufficient");
  assert.equal(seis.recommendation, null, "con menos de 7 días no hay recomendación");
  assert.equal(analizar(dias(7, () => 10)).dataState, "provisional");
  assert.equal(analizar(dias(13, () => 10)).dataState, "provisional");
  assert.equal(analizar(dias(14, () => 10)).dataState, "ok");
  assert.notEqual(analizar(dias(7, () => 10)).recommendation, null);
});

// ── Recomendación ─────────────────────────────────────────────────────────

test("1. vas justo: dos topes por semana de media, y cuántos evitarías con el plan superior", () => {
  const r = analizar(dias(14, (d) => (d % 3 === 0 ? 100 : 30)));    // 5 topes en 2 semanas
  assert.equal(r.fiveHour.caps, 5);
  assert.deepEqual(r.recommendation, { kind: "tight", higher: r.alternatives.find((a) => a.plan.id === "max20")!.plan, capsAvoided: 5 });
});

test("1. vas justo también con una semana ≥ 90 %, aunque no haya topes de 5 h", () => {
  const r = analizar(dias(14, () => 10, 90));
  assert.equal(r.fiveHour.caps, 0);
  assert.equal(r.recommendation!.kind, "tight");
});

test("1. en Max 20x no hay plan superior", () => {
  const r = analizar(dias(14, () => 100), { plan: "max20" });
  assert.deepEqual(r.recommendation, { kind: "tight", higher: null, capsAvoided: null });
});

test("2. te habría bastado el plan inferior: ningún bloqueo y p90 equivalente ≤ 80", () => {
  const r = analizar(dias(14, () => 16));                            // en Pro: 80
  assert.equal(r.recommendation!.kind, "enough");
  assert.equal(r.recommendation!.kind === "enough" && r.recommendation!.plan.id, "pro");
  assert.equal(r.recommendation!.kind === "enough" && r.recommendation!.weeks, 2);
});

test("2. desde Max 20x se prueba primero el más barato", () => {
  const r = analizar(dias(14, () => 4), { plan: "max20" });          // en Pro: 80
  assert.equal(r.recommendation!.kind === "enough" && r.recommendation!.plan.id, "pro");
  const r2 = analizar(dias(14, () => 15), { plan: "max20" });        // en Pro: 300; en Max 5x: 60
  assert.equal(r2.recommendation!.kind === "enough" && r2.recommendation!.plan.id, "max5");
});

test("3. te habría bastado casi siempre: de 1 a 3 bloqueos", () => {
  const r = analizar(dias(14, (d) => (d < 2 ? 21 : 10)));            // dos ventanas a 105 en Pro
  assert.deepEqual(r.recommendation!.kind === "almost" && [r.recommendation!.plan.id, r.recommendation!.blocked], ["pro", 2]);
});

test("4. si no, tu plan encaja", () => {
  assert.equal(analizar(dias(14, () => 30)).recommendation!.kind, "fits");           // Pro bloquearía siempre
  assert.equal(analizar(dias(14, (d) => (d < 4 ? 21 : 10))).recommendation!.kind, "fits", "4 bloqueos ya no es casi");
  assert.equal(analizar(dias(14, () => 17)).recommendation!.kind, "fits", "sin bloqueos pero p90 85 > 80");
  assert.equal(analizar(dias(14, () => 50), { plan: "pro" }).recommendation!.kind, "fits", "Pro no tiene plan inferior");
});
