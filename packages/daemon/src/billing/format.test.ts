import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDuration, localDate } from "@estela/shared";

import { groupByBranchAndDay, type WorkBlock } from "./sessionize.js";

// ── Duraciones ─────────────────────────────────────────────────────────

test("nunca imprime 60 minutos", () => {
  // El fallo que esto previene: redondear los minutos después de haber
  // separado las horas. 2h 59m 50s salía como "2h 60m", y en una factura.
  assert.equal(formatDuration(2 * 3600 + 59 * 60 + 50), "3h");
  assert.equal(formatDuration(3599), "1h");
  assert.equal(formatDuration(59 * 60 + 55), "1h");
});

test("duraciones normales", () => {
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(90), "2m");
  assert.equal(formatDuration(3600), "1h");
  assert.equal(formatDuration(3660), "1h 01m");
  assert.equal(formatDuration(4 * 3600 + 16 * 60), "4h 16m");
});

test("ninguna duración razonable produce 60m", () => {
  for (let s = 0; s < 12 * 3600; s += 7) {
    const out = formatDuration(s);
    assert.ok(!out.includes("60m"), `formatDuration(${s}) = "${out}"`);
  }
});

// ── Fecha local ────────────────────────────────────────────────────────

test("el día de trabajo es el del reloj de quien trabaja", () => {
  // En UTC-5, las 22:00 del día 25 son las 03:00 UTC del 26. Usar la fecha UTC
  // partiría la jornada de tarde-noche entre dos días.
  const tarde = new Date("2026-08-26T03:19:00Z"); // 22:19 del 25 en Ecuador
  const esperado = new Date(tarde.getTime() - tarde.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 10);

  assert.equal(localDate(tarde), esperado);
  if (tarde.getTimezoneOffset() > 0) {
    assert.notEqual(localDate(tarde), tarde.toISOString().slice(0, 10),
      "al oeste de Greenwich, la fecha local y la UTC difieren en esta hora");
  }
});

// ── Agrupación ─────────────────────────────────────────────────────────

function block(startIso: string, minutes: number, branch = "main"): WorkBlock {
  const startedAt = new Date(startIso);
  return {
    startedAt,
    endedAt: new Date(startedAt.getTime() + minutes * 60_000),
    seconds: minutes * 60,
    repoPath: "/repo", branch, turnCount: 1,
    aiCost: { microUsd: 1_000_000 },
    models: ["claude-opus-5"], sessionIds: ["s"], commits: [], unpricedModels: [],
  };
}

test("suma el tiempo trabajado, no el lapso entre el primero y el último", () => {
  // Dos bloques de 30 min con tres horas de comida en medio son 1h, no 4h.
  // Facturar el hueco sería cobrarle de más al cliente.
  const merged = groupByBranchAndDay([
    block("2026-08-26T14:00:00Z", 30),
    block("2026-08-26T21:00:00Z", 30),
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.seconds, 3600, "1h de trabajo real");
  assert.equal(formatDuration(merged[0]!.seconds), "1h");
});

test("ramas distintas no se fusionan", () => {
  const merged = groupByBranchAndDay([
    block("2026-08-26T14:00:00Z", 30, "main"),
    block("2026-08-26T15:00:00Z", 30, "feature/auth"),
  ]);
  assert.equal(merged.length, 2);
});

test("se acumulan commits, modelos y coste al fusionar", () => {
  const a = block("2026-08-26T14:00:00Z", 30);
  const b = block("2026-08-26T15:00:00Z", 30);
  const merged = groupByBranchAndDay([a, b]);

  assert.equal(merged[0]!.aiCost.microUsd, 2_000_000);
  assert.equal(merged[0]!.turnCount, 2);
});

// ── Identificador determinista de una imputación ───────────────────────

/** La misma fórmula que usan la CLI y el servidor para nombrar un bloque. */
function entryId(projectId: string, startedAt: Date, branch: string | null): string {
  const day = localDate(startedAt);
  const slug = (branch ?? "sin-rama").replace(/[^a-zA-Z0-9]+/g, "-");
  return `te_${projectId}_${day}_${slug}`;
}

test("el id usa la fecha local, no la UTC", () => {
  // El fallo que esto previene: la CLI construía el id con toISOString() (UTC)
  // y el servidor con localDate(). Para el mismo bloque salían dos ids, así que
  // en vez de actualizar una fila se creaba otra y el día se contaba doble.
  const tarde = new Date("2026-08-27T02:49:59Z");   // 21:49 del 26 en UTC-5

  const id = entryId("nebula", tarde, "feature/x");
  assert.ok(id.includes(localDate(tarde)), "el id lleva la fecha local");

  if (tarde.getTimezoneOffset() > 0) {
    assert.ok(!id.includes(tarde.toISOString().slice(0, 10)),
      "y no la UTC, que aquí es el día siguiente");
  }
});

test("el mismo bloque siempre produce el mismo id", () => {
  const at = new Date("2026-08-26T14:00:00Z");
  assert.equal(entryId("p", at, "main"), entryId("p", new Date(at), "main"));
});

test("el id coincide con el local_date de la fila", () => {
  // La invariante que hace posible detectar filas huérfanas: si un id lleva una
  // fecha distinta a su local_date, esa fila la creó una versión con el bug.
  for (const iso of ["2026-08-27T02:49:00Z", "2026-08-26T14:00:00Z", "2026-01-01T03:00:00Z"]) {
    const at = new Date(iso);
    assert.ok(entryId("p", at, "main").includes(`_${localDate(at)}_`));
  }
});
