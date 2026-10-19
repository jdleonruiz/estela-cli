import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { historyPath, pruneSamples, readSamples, recordSample, sampleOf, shouldWrite, type RateSample } from "./rate-history.js";
import { loadCache } from "./statusline-cache.js";

/**
 * El historial de porcentajes de la status line: qué se guarda, cuándo, y que
 * nunca rompe la línea.
 */

const T0 = new Date("2026-10-19T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

function entrada(w5?: number, w7?: number, extra: Record<string, unknown> = {}) {
  const limits: Record<string, unknown> = {};
  if (w5 !== undefined) limits["five_hour"] = { used_percentage: w5, resets_at: 1760910000 };
  if (w7 !== undefined) limits["seven_day"] = { used_percentage: w7, resets_at: 1761300000 };
  return {
    session_id: "secreto", transcript_path: "/Users/x/.claude/projects/p/s.jsonl", cwd: "/Users/x/cliente",
    workspace: { current_dir: "/Users/x/cliente", project_dir: "/Users/x/cliente" },
    model: { display_name: "Opus" }, version: "2.1.302", rate_limits: limits, ...extra,
  };
}

function home() {
  const dir = join(mkdtempSync(join(tmpdir(), "estela-hist-")), ".estela");
  mkdirSync(dir);
  return join(dir, "estela.db");
}

// ── Qué se guarda ─────────────────────────────────────────────────────────

test("la muestra lleva solo los porcentajes, los reinicios y la versión, tal cual", () => {
  const s = sampleOf(entrada(42, 31.5), T0)!;
  assert.deepEqual(s, {
    ts: T0.getTime(), src: "claude-code", w5: 42, w5_reset: 1760910000, w7: 31.5, w7_reset: 1761300000, cc: "2.1.302",
  });
  // Nada de sesión, rutas, proyectos ni modelo.
  assert.doesNotMatch(JSON.stringify(s), /secreto|Users|cliente|Opus|transcript/);
});

test("una ventana que no llega se omite: nunca se escribe 0", () => {
  assert.deepEqual(Object.keys(sampleOf(entrada(42, undefined), T0)!).sort(), ["cc", "src", "ts", "w5", "w5_reset"]);
  assert.deepEqual(Object.keys(sampleOf(entrada(undefined, 12), T0)!).sort(), ["cc", "src", "ts", "w7", "w7_reset"]);
  const sinVersion = entrada(42, 12); delete (sinVersion as Record<string, unknown>)["version"];
  assert.equal(sampleOf(sinVersion, T0)!.cc, undefined);
});

test("sin rate_limits no hay muestra", () => {
  const e = entrada(); delete (e as Record<string, unknown>)["rate_limits"];
  assert.equal(sampleOf(e, T0), null);
  assert.equal(sampleOf(entrada(), T0), null, "rate_limits vacío tampoco");
  assert.equal(sampleOf("no es json", T0), null);
});

// ── Cuándo ────────────────────────────────────────────────────────────────

test("se guarda a los 5 minutos, con un punto de cambio, o con ventana nueva; si no, no", () => {
  const base = sampleOf(entrada(40, 20), T0)!;
  const s = (min: number, w5: number, w7: number, over: Partial<RateSample> = {}): RateSample =>
    ({ ...sampleOf(entrada(w5, w7), at(min))!, ...over });

  assert.equal(shouldWrite(undefined, base), true, "la primera siempre");
  assert.equal(shouldWrite(base, s(4.9, 40.9, 20.5)), false, "menos de 5 min y menos de un punto");
  assert.equal(shouldWrite(base, s(5, 40, 20)), true, "5 minutos exactos");
  assert.equal(shouldWrite(base, s(1, 41, 20)), true, "un punto en la 5 h");
  assert.equal(shouldWrite(base, s(1, 40, 19)), true, "un punto en la semana, también bajando");
  assert.equal(shouldWrite(base, s(1, 40, 20, { w5_reset: 1760928000 })), true, "ventana de 5 h nueva");
  assert.equal(shouldWrite(base, s(1, 40, 20, { w7_reset: 1761900000 })), true, "semana nueva");
  const sinSemana = sampleOf(entrada(40, undefined), at(1))!;
  assert.equal(shouldWrite(base, sinSemana), true, "deja de llegar una ventana");
});

test("en la status line: escribe, frena las repetidas y vuelve a escribir al moverse", () => {
  const db = home();
  recordSample(db, entrada(40, 20), at(0));
  recordSample(db, entrada(40.5, 20), at(1));   // nada nuevo
  recordSample(db, entrada(41.2, 20), at(2));   // un punto desde la última guardada
  recordSample(db, entrada(41.2, 20), at(8));   // 6 minutos después
  assert.deepEqual(readSamples(historyPath(db)).map((s) => s.w5), [40, 41.2, 41.2]);
  assert.equal(loadCache(db).lastSample!.ts, at(8).getTime(), "la última va en statusline.json");
});

test("sin rate_limits no escribe muestra, pero apunta que se vio una entrada así", () => {
  const db = home();
  const e = entrada(); delete (e as Record<string, unknown>)["rate_limits"];
  recordSample(db, e, T0);
  assert.ok(!existsSync(historyPath(db)));
  assert.equal(loadCache(db).noLimitsAt, T0.toISOString());
});

test("sin el directorio de Estela no se crea nada", () => {
  const db = join(mkdtempSync(join(tmpdir(), "estela-hist-")), "no-existe", "estela.db");
  recordSample(db, entrada(40, 20), T0);
  assert.ok(!existsSync(historyPath(db)));
});

test("un error al escribir no lanza", { skip: process.platform === "win32" || process.getuid?.() === 0 }, () => {
  const db = home();
  const dir = join(db, "..");
  chmodSync(dir, 0o500);
  try {
    assert.doesNotThrow(() => recordSample(db, entrada(40, 20), T0));
  } finally { chmodSync(dir, 0o700); }
});

// ── Rotación ──────────────────────────────────────────────────────────────

test("la rotación quita lo de más de 120 días y deja lo demás intacto", () => {
  const db = home();
  const file = historyPath(db);
  const day = 24 * 60 * 60_000;
  const lines = [
    { ts: T0.getTime() - 121 * day, src: "claude-code", w5: 1 },
    { ts: T0.getTime() - 120 * day, src: "claude-code", w5: 2 },
    { ts: T0.getTime() - 1 * day, src: "claude-code", w5: 3 },
  ];
  writeFileSync(file, lines.map((l) => JSON.stringify(l) + "\n").join("") + "{roto\n");
  assert.equal(pruneSamples(file, T0), 2, "la vieja y la línea rota");
  assert.deepEqual(readSamples(file).map((s) => s.w5), [2, 3]);
  assert.equal(pruneSamples(file, T0), 0, "sin nada que quitar, no reescribe");
});

test("la status line rota una vez al día", () => {
  const db = home();
  const file = historyPath(db);
  const old = JSON.stringify({ ts: T0.getTime() - 200 * 24 * 60 * 60_000, src: "claude-code", w5: 9 }) + "\n";
  writeFileSync(file, old);
  recordSample(db, entrada(40, 20), T0);
  assert.deepEqual(readSamples(file).map((s) => s.w5), [40]);

  writeFileSync(file, old + readFileSync(file, "utf8"));
  recordSample(db, entrada(50, 20), at(60));     // mismo día: no rota
  assert.equal(readSamples(file).length, 3);
  recordSample(db, entrada(60, 20), at(24 * 60)); // al día siguiente, sí
  assert.deepEqual(readSamples(file).map((s) => s.w5), [40, 50, 60]);
});
