import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { blocksIn, scanBlocks } from "./plan-blocks.js";

/**
 * `estela plan` como se usa: declarar el plan, sin datos, con datos, --json,
 * y los 429 de los transcripts. Cada prueba con su HOME temporal.
 */

const BIN = join(__dirname, "bin.js");
const DAY = 86_400_000;

function entorno() {
  const home = mkdtempSync(join(tmpdir(), "estela-plan-"));
  mkdirSync(join(home, ".estela"), { recursive: true });
  mkdirSync(join(home, ".claude", "projects", "-r"), { recursive: true });
  return { home, db: join(home, ".estela", "estela.db"), hist: join(home, ".estela", "rate-limits.jsonl") };
}

function estela(home: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", input: "",
    env: { ...process.env, HOME: home, USERPROFILE: home, ESTELA_LANG: "es", NO_COLOR: "1", ESTELA_NO_UPDATE_CHECK: "1" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

/** `n` días hasta hoy, una ventana al día con pico `peak`. */
function historial(file: string, n: number, peak: number): void {
  const now = Date.now();
  let text = "";
  for (let d = n - 1; d >= 0; d--) {
    const ts = now - d * DAY - 3_600_000;
    const reset = Math.floor((ts + 2 * 3_600_000) / 1000);
    text += JSON.stringify({ ts, src: "claude-code", w5: peak, w5_reset: reset, w7: 30, w7_reset: Math.floor((now + DAY) / 1000) }) + "\n";
  }
  appendFileSync(file, text);
}

test("sin plan declarado explica cómo declararlo y sale con 0", () => {
  const { home, db } = entorno();
  const r = estela(home, "plan", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /estela plan set max5/);
});

test("plan set: valida el plan y la fecha, y guarda el cambio", () => {
  const { home, db } = entorno();
  assert.notEqual(estela(home, "plan", "set", "max7", "--db", db).code, 0);
  assert.notEqual(estela(home, "plan", "set", "max5", "--since", "ayer", "--db", db).code, 0);
  const r = estela(home, "plan", "set", "max5", "--since", "2026-10-01", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Plan declarado: Max 5x, desde 2026-10-01/);
});

test("sin muestras: aún no hay datos; si solo se vieron entradas sin rate_limits, API key", () => {
  const { home, db } = entorno();
  estela(home, "plan", "set", "max5", "--db", db);
  assert.match(estela(home, "plan", "--db", db).out, /Aún no hay datos\. Instala la status line/);
  writeFileSync(join(home, ".estela", "statusline.json"), JSON.stringify({ files: {}, noLimitsAt: new Date().toISOString() }));
  assert.match(estela(home, "plan", "--db", db).out, /Este análisis solo funciona con planes Pro o Max\./);
});

test("con 20 días de datos: el informe, y el mismo análisis en --json", () => {
  const { home, db, hist } = entorno();
  estela(home, "plan", "set", "max5", "--since", "2026-01-01", "--db", db);
  historial(hist, 20, 16);
  const r = estela(home, "plan", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^estela plan · Max 5x \(desde 2026-01-01\) · 20 días con datos/);
  assert.match(r.out, /Pro \(20 \$\)\s+p90 equivalente 80 % · no te habría bloqueado en ninguna de las 20 ventanas/);
  assert.match(r.out, /el plan Pro te habría bastado/);

  const j = JSON.parse(estela(home, "plan", "--json", "--db", db).out) as { recommendation: { kind: string; plan: string } };
  assert.deepEqual([j.recommendation.kind, j.recommendation.plan], ["enough", "pro"]);
  assert.notEqual(estela(home, "plan", "--days", "0", "--db", db).code, 0);
});

test("solo cuenta desde el último cambio de plan", () => {
  const { home, db, hist } = entorno();
  historial(hist, 20, 16);
  estela(home, "plan", "set", "max5", "--since", "2026-01-01", "--db", db);
  assert.match(estela(home, "plan", "--db", db).out, /Max 5x .* · 20 días con datos/);
  estela(home, "plan", "set", "max20", "--db", db);   // desde ahora: lo guardado antes era de Max 5x
  const r = estela(home, "plan", "--db", db);
  assert.match(r.out, /^estela plan · Max 20x/);
  assert.match(r.out, /Aún no hay datos/);
});

// ── 429 de los transcripts ────────────────────────────────────────────────

const linea429 = (type: string, reset: number, ts: string) => JSON.stringify({
  type: "assistant", timestamp: ts, error: "rate_limit", apiErrorStatus: 429, isApiErrorMessage: true,
  message: { content: [{ type: "text", text: "no se lee" }] },
  quotaLimits: { status: "rejected", rateLimitType: type, resetsAt: reset, overageStatus: "rejected" },
}) + "\n";

test("los 429: uno por ventana, aunque se repitan, y sin leer el resto de líneas", () => {
  const text = linea429("five_hour", 100, "2026-10-01T10:00:00Z") + '{"type":"user","message":"hola"}\n' +
    linea429("five_hour", 100, "2026-10-01T10:05:00Z") + linea429("seven_day", 900, "2026-10-02T10:00:00Z") + "{roto quotaLimits\n";
  assert.deepEqual(blocksIn(text).map((b) => [b.type, b.reset]), [["five_hour", 100], ["five_hour", 100], ["seven_day", 900]]);
});

test("scanBlocks: lee solo lo nuevo de cada fichero y no duplica", () => {
  const { home, db } = entorno();
  const file = join(home, ".claude", "projects", "-r", "s.jsonl");
  const cache = join(home, ".estela", "plan-blocks.json");
  const ahora = new Date();
  const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000).toISOString();
  writeFileSync(file, linea429("five_hour", 100, hace(5)));
  assert.equal(scanBlocks(join(home, ".claude", "projects"), cache, ahora).length, 1);
  appendFileSync(file, linea429("five_hour", 100, hace(4)) + linea429("five_hour", 200, hace(1)));
  const b = scanBlocks(join(home, ".claude", "projects"), cache, ahora);
  assert.deepEqual(b.map((x) => x.reset), [100, 200]);
  assert.equal(b[0]!.at, Date.parse(hace(5)), "se queda con el primer 429 de la ventana");
  void db;
});

test("estela plan enseña los 429 del período en su línea", () => {
  const { home, db, hist } = entorno();
  estela(home, "plan", "set", "max5", "--since", "2026-01-01", "--db", db);
  historial(hist, 3, 40);
  const ayer = new Date(Date.now() - DAY).toISOString();
  writeFileSync(join(home, ".claude", "projects", "-r", "s.jsonl"),
    linea429("five_hour", 100, ayer) + linea429("seven_day", 500, ayer));
  assert.match(estela(home, "plan", "--db", db).out, /Bloqueos \(429\)\s+1 de 5 h · 1 semanales/);
});
