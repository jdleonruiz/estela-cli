import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { EntrySource } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";

/**
 * `estela badge`, ejecutando la CLI de verdad: lo que importa es la línea que
 * alguien pega en su README, y que no cuente como medido lo que no lo es.
 */

const BIN = join(__dirname, "bin.js");

function estela(db: string, ...args: string[]): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [BIN, ...args, "--db", db], {
    encoding: "utf8",
    env: { ...process.env, ESTELA_LANG: "es", NO_COLOR: "1" },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function bloque(id: string, source: EntrySource, hours: number, aiUsd: number) {
  const startedAt = new Date("2026-08-10T10:00:00Z");
  return {
    id, projectId: "p", startedAt, endedAt: new Date(startedAt.getTime() + hours * 3600_000),
    seconds: hours * 3600, description: "Trabajo", billable: true, invoiceId: null,
    aiCost: { microUsd: aiUsd * 1_000_000 }, agentSeconds: source === "agent" ? hours * 3600 : 0,
    commitHashes: [], agents: [], source, kind: "development" as const, branch: "main",
  };
}

function preparar(bloques: ReturnType<typeof bloque>[], cuota?: number): string {
  const path = join(mkdtempSync(join(tmpdir(), "estela-badge-")), "estela.db");
  const db = openDatabase(path);
  try {
    store.upsertClient(db, { id: "c", name: "Interno", currency: "EUR" });
    store.upsertProject(db, {
      id: "p", clientId: "c", name: "Web", repoPaths: [],
      billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
    });
    for (const b of bloques) store.saveTimeEntry(db, b);
    if (cuota !== undefined) {
      store.upsertSubscription(db, {
        id: "max", name: "Claude Max", monthlyFee: { amount: cuota * 100, currency: "EUR" },
        effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null,
      });
    }
  } finally { db.close(); }
  return path;
}

test("badge: horas medidas y coste a tarifa API, sin contar lo estimado", () => {
  const db = preparar([bloque("a", "agent", 42, 18.4), bloque("b", "commit", 5, 0)]);
  const r = estela(db, "badge", "--project", "p");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^\[!\[Built in 42 h · \$18 of AI\]\(https:\/\/img\.shields\.io\/badge\/[^)]+\)\]\(https:\/\/getestela\.dev\/en\/\)$/m);
  assert.match(r.out, /tarifa API/);
});

test("badge: con una cuota registrada, sale lo que se pagó de verdad", () => {
  // Único proyecto con consumo ese mes: se lleva la cuota entera.
  const db = preparar([bloque("a", "agent", 10, 50)], 100);
  const r = estela(db, "badge", "--project", "p");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Built in 10 h · €100 of AI/);
  assert.doesNotMatch(r.out, /tarifa API/);
});

test("badge: sin horas medidas no se inventa un badge", () => {
  const db = preparar([bloque("b", "commit", 5, 0)]);
  const r = estela(db, "badge", "--project", "p");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /no tiene horas medidas/);
});

test("badge: un proyecto que no existe se dice así", () => {
  const db = preparar([]);
  const r = estela(db, "badge", "--project", "nada");
  assert.notEqual(r.code, 0);
  assert.match(r.out, /No existe el proyecto "nada"/);
});
