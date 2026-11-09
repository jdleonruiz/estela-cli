import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { money } from "@estela/shared";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";

/**
 * `estela ai-cost --by` como se usa, con datos inventados: el cliente Acme y
 * sus ramas no existen. Y `ai-cost` sin --by, igual que siempre.
 */

const BIN = join(__dirname, "bin.js");

function estela(home: string, ...args: string[]) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8", input: "",
    env: { ...process.env, HOME: home, USERPROFILE: home, ESTELA_LANG: "es", NO_COLOR: "1", ESTELA_NO_UPDATE_CHECK: "1" },
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

function entorno(conCuota = true) {
  const home = mkdtempSync(join(tmpdir(), "estela-aicost-"));
  mkdirSync(join(home, ".estela"));
  const path = join(home, ".estela", "estela.db");
  const db = openDatabase(path);
  store.upsertClient(db, { id: "acme", name: "Acme", currency: "EUR" });
  store.upsertClient(db, { id: "beta", name: "Beta", currency: "USD" });
  const proyecto = (id: string, clientId: string, repo: string) => store.upsertProject(db, {
    id, clientId, name: id.toUpperCase(), repoPaths: [repo], billable: true, roundingMinutes: 0,
    aiCostPolicy: "absorbed", kind: "client",
  });
  proyecto("web", "acme", "/tmp/acme-web");
  proyecto("app", "beta", "/tmp/beta-app");
  for (const id of ["web", "app"]) store.setProjectTracker(db, id, { system: "github", prefixes: [] });

  let k = 0;
  const imputar = (projectId: string, day: string, branch: string | null, minutes: number, usd: number, items: string[] = []) => {
    const startedAt = new Date(`${day}T15:00:00Z`);
    store.saveTimeEntry(db, {
      id: `te_${k++}`, projectId, startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000),
      seconds: minutes * 60, description: "trabajo", billable: true, invoiceId: null,
      aiCost: { microUsd: usd * 1_000_000 }, agentSeconds: minutes * 60, commitHashes: [],
      agents: ["claude-code"], source: "agent", kind: "development", branch, workItems: items,
    });
  };
  imputar("web", "2026-10-05", "feat/12-login", 90, 6, ["github:12"]);
  imputar("web", "2026-10-06", "feat/buscador", 60, 3);
  imputar("web", "2026-10-07", null, 30, 1);
  imputar("web", "2026-09-20", "feat/viejo", 60, 10);
  imputar("app", "2026-10-08", "fix/pagos", 45, 2);
  store.saveMerges(db, [{ repoPath: "/tmp/acme-web", hash: "m1", at: new Date("2026-10-09T10:00:00Z"),
    sourceBranch: "feat/buscador", ref: "github:31", subject: "Merge pull request #31 from ana/feat/buscador" }]);
  if (conCuota) {
    store.upsertSubscription(db, { id: "max", name: "Max", monthlyFee: money(10_000, "EUR"),
      effectiveFrom: new Date("2026-09-01T00:00:00Z"), effectiveTo: null });
  }
  db.close();
  return { home, path };
}

test("sin --by, ai-cost sale como siempre", () => {
  const { home, path } = entorno();
  const r = estela(home, "ai-cost", "--db", path);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^\n2026-09   \(consumo total: \$10,00 equiv\. API\)\n  WEB\s+\$10,00 100\.0%/m);
  assert.match(r.out, /La última columna es dinero real: tu cuota repartida por consumo\./);
  assert.doesNotMatch(r.out, /Sin atribuir|por rama/);
});

test("--by branch: por proyecto, con su base, y sin rama a sin atribuir", () => {
  const { home, path } = entorno();
  const r = estela(home, "ai-cost", "--by", "branch", "--month", "2026-10", "--db", path);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^Coste de IA por rama · 2026-10\n/);
  assert.match(r.out, /\nWEB · Acme\n/);
  assert.match(r.out, /  feat\/12-login\s+1h 30m\s+\$6,00\s+/);
  assert.match(r.out, /      #12 · según: rama anotada por el agente/);
  assert.match(r.out, /      PR #31 · según: rama anotada por el agente/);
  assert.match(r.out, /  Sin atribuir \(sin rama\)\s+30m\s+\$1,00/);
  assert.match(r.out, /\nAPP · Beta\n/);
  assert.doesNotMatch(r.out, /feat\/viejo/, "septiembre queda fuera del periodo");
  assert.match(r.out, /Real es tu cuota repartida por consumo/);
});

test("--by item --client: solo ese cliente, y el PR del merge cuando no hay ticket", () => {
  const { home, path } = entorno();
  const r = estela(home, "ai-cost", "--by", "item", "--client", "acme", "--from", "2026-10-01", "--to", "2026-10-31", "--db", path);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /  #12\s+1h 30m\s+\$6,00/);
  assert.match(r.out, /  PR #31\s+1h\s+\$3,00/);
  assert.match(r.out, /      ramas: feat\/buscador · según: commit de merge del PR/);
  assert.match(r.out, /  Sin atribuir \(sin ticket ni PR\)\s+30m/);
  assert.doesNotMatch(r.out, /APP/);
});

test("--json: las dos cifras por separado, y la cuota repartida sobre el consumo del mes", () => {
  const { home, path } = entorno();
  const r = estela(home, "ai-cost", "--by", "branch", "--month", "2026-10", "--project", "web", "--json", "--db", path);
  assert.equal(r.code, 0, r.out);
  const j = JSON.parse(r.out) as { projects: { id: string; units: { key: string | null; apiMicroUsd: number; real: { amountMinor: number; currency: string } | null }[]; total: { apiMicroUsd: number } }[] };
  assert.deepEqual(j.projects.map((p) => p.id), ["web"]);
  const login = j.projects[0]!.units.find((u) => u.key === "feat/12-login")!;
  assert.equal(login.apiMicroUsd, 6_000_000);
  // Octubre: 12 $ de consumo en toda la base (6 + 3 + 1 + 2); 100 € de cuota.
  assert.deepEqual(login.real, { amountMinor: 5_000, currency: "EUR" });
  assert.equal(j.projects[0]!.total.apiMicroUsd, 10_000_000);
});

test("--csv: una fila por unidad, sin atribuir con la unidad vacía", () => {
  const { home, path } = entorno(false);
  const out = join(home, "coste.csv");
  const r = estela(home, "ai-cost", "--by", "branch", "--month", "2026-10", "--csv", out, "--db", path);
  assert.equal(r.code, 0, r.out);
  const lines = readFileSync(out, "utf8").replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "proyecto,cliente,unidad,atribuido,ramas,tickets,pr,segun,horas,coste_ia_usd_equiv_api,gasto_real,moneda,gasto_real_parcial,incluye_copilot_sin_coste");
  assert.ok(lines.includes("WEB,Acme,feat/12-login,si,feat/12-login,#12,,agent-branch,1.5000,6.0000,,,no,no"), lines.join("\n"));
  assert.ok(lines.includes("WEB,Acme,,no,,,,,0.5000,1.0000,,,no,no"), lines.join("\n"));
});

test("sin suscripción lo dice, y --by mal escrito o un cliente que no existe fallan claro", () => {
  const { home, path } = entorno(false);
  assert.match(estela(home, "ai-cost", "--by", "branch", "--db", path).out, /Sin suscripciones registradas no hay dinero real/);
  const mal = estela(home, "ai-cost", "--by", "rama", "--db", path);
  assert.notEqual(mal.code, 0);
  assert.match(mal.out, /--by va como branch o item\./);
  assert.match(estela(home, "ai-cost", "--by", "item", "--client", "nadie", "--db", path).out, /No existe el cliente "nadie"\./);
});
