import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AgentTurn } from "@estela/shared";
import { money } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { normalizePath } from "./paths.js";

/**
 * `estela summary` con datos inventados: Acme y Beta no existen. Lo que tiene
 * que cumplir un informe para finanzas: un mes cerrado suma su cuota exacta, y
 * clientes más "fuera de proyectos" es el total.
 */

const BIN = join(__dirname, "bin.js");

function estela(home: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", input: "", cwd: home,
    env: { ...process.env, HOME: home, USERPROFILE: home, ESTELA_LANG: "es", NO_COLOR: "1", ESTELA_NO_UPDATE_CHECK: "1" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function entorno() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "estela-summary-")));
  const tienda = join(home, "tienda");
  const app = join(home, "app");
  const suelto = join(home, "experimentos");
  for (const d of [tienda, app, suelto]) mkdirSync(d);
  mkdirSync(join(home, ".estela"));
  const db = join(home, ".estela", "estela.db");
  const c = openDatabase(db);
  store.upsertClient(c, { id: "acme", name: "Acme", currency: "EUR" });
  store.upsertClient(c, { id: "beta", name: "Beta", currency: "EUR" });
  const proyecto = (id: string, clientId: string, name: string, repo: string) => store.upsertProject(c, {
    id, clientId, name, repoPaths: [normalizePath(repo)], billable: true, roundingMinutes: 0,
    aiCostPolicy: "absorbed", kind: "client" });
  proyecto("tienda", "acme", "Tienda", tienda);
  proyecto("app", "beta", "App", app);
  store.upsertSubscription(c, { id: "max", name: "Max", monthlyFee: money(10_000, "EUR"),
    effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null });

  // El consumo de octubre en toda la máquina: los dos proyectos y una carpeta suelta.
  let k = 0;
  const turnos = (cwd: string, day: number, n: number): AgentTurn[] => Array.from({ length: n }, (_, i) => ({
    agent: "claude-code", turnId: `t${k++}`, sessionId: `s-${cwd}-${day}`, at: new Date(2026, 9, day, 10, i),
    model: "claude-sonnet-4-6", repoPath: normalizePath(cwd), branch: "main", producerVersion: null,
    tokens: { input: 100_000, output: 10_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 } }));
  // El 31 a última hora: en UTC ya es noviembre, pero es octubre en tu reloj.
  const tarde: AgentTurn[] = turnos(tienda, 31, 3).map((t, i) => ({ ...t, at: new Date(2026, 9, 31, 23, 50 + i) }));
  store.saveTurns(c, [...turnos(tienda, 6, 20), ...turnos(app, 8, 10), ...turnos(suelto, 9, 10), ...tarde]);

  let n = 0;
  const imputar = (projectId: string, day: number, minutes: number, usd: number) => {
    const startedAt = new Date(2026, 9, day, 10, 0);
    store.saveTimeEntry(c, { id: `te_${n++}`, projectId, startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000),
      seconds: minutes * 60, description: "x", billable: true, invoiceId: null, aiCost: { microUsd: usd * 1e6 },
      agentSeconds: minutes * 60, commitHashes: [], agents: ["claude-code"], source: "agent", kind: "development",
      branch: "main", workItems: [] });
  };
  imputar("tienda", 6, 120, 2);
  imputar("app", 8, 60, 1);
  c.close();
  return { home, db };
}

test("un mes cerrado suma la cuota exacta, y clientes más fuera de proyectos dan el total", () => {
  const { home, db } = entorno();
  const r = estela(home, "summary", "--month", "2026-10", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^# Gasto en IA · octubre de 2026\n/);
  assert.match(r.out, /- \*\*Pagado en IA:\*\* €100,00/);
  assert.match(r.out, /- \*\*Horas de trabajo con IA:\*\* 3h en 2 proyectos de 2 clientes\./);
  assert.match(r.out, /\| Acme \| Tienda \| 2h \| €\d+,\d\d \| [\d.]+ % \|/);
  assert.match(r.out, /\| Fuera de proyectos \| — \| — \| €\d+,\d\d \|/);
  assert.match(r.out, /## Cómo se calcula/);

  type C = { real: { amountMinor: number } | null };
  const j = JSON.parse(estela(home, "summary", "--month", "2026-10", "--format", "json", "--db", db).out) as
    { paid: C; unassigned: C; clients: (C & { name: string })[] };
  assert.equal(j.paid.real!.amountMinor, 10_000);
  const suma = j.clients.reduce((s, c) => s + c.real!.amountMinor, 0) + j.unassigned.real!.amountMinor;
  assert.ok(Math.abs(suma - 10_000) <= 1, `${suma}: los redondeos no pasan de un céntimo`);
});

test("--client deja solo lo de ese cliente, sin fuera de proyectos", () => {
  const { home, db } = entorno();
  const r = estela(home, "summary", "--month", "2026-10", "--client", "acme", "--db", db);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\| Acme \| Tienda \|/);
  assert.doesNotMatch(r.out, /\| Beta \||Fuera de proyectos/);
});

test("--out elige el formato por la extensión, y --format mal escrito falla claro", () => {
  const { home, db } = entorno();
  const csv = join(home, "informe.csv");
  assert.match(estela(home, "summary", "--month", "2026-10", "--out", csv, "--db", db).out, /Informe guardado en .*informe\.csv/);
  const lines = readFileSync(csv, "utf8").replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "seccion,cliente,proyecto,concepto,horas,gasto,moneda,valor_uso_usd_precio_lista,pct");
  assert.ok(lines.some((l) => l.startsWith("resumen,,,pagado,3.0000,100.00,EUR,")), lines.join("\n"));

  const json = join(home, "informe.json");
  estela(home, "summary", "--month", "2026-10", "--out", json, "--db", db);
  assert.equal((JSON.parse(readFileSync(json, "utf8")) as { period: { from: string } }).period.from, "2026-10-01");

  const mal = estela(home, "summary", "--format", "xml", "--db", db);
  assert.notEqual(mal.code, 0);
  assert.match(mal.out, /--format va como md, csv o json\./);
});
