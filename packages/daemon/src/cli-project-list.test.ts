import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";

/**
 * `estela project list`, ejecutando la CLI de verdad. Los clientes y proyectos
 * son inventados.
 */

const BIN = join(__dirname, "bin.js");

function estela(db: string, lang: string, ...args: string[]): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [BIN, ...args, "--db", db], {
    encoding: "utf8",
    env: { ...process.env, ESTELA_LANG: lang, NO_COLOR: "1" },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function baseVacia(): string {
  return join(mkdtempSync(join(tmpdir(), "estela-plist-")), "estela.db");
}

test("project list: id, cliente, gestor, estado y repos; los archivados aparte", () => {
  const path = baseVacia();
  const db = openDatabase(path);
  try {
    store.upsertClient(db, { id: "acme", name: "Acme", currency: "EUR" });
    const base = { clientId: "acme", billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed" as const, kind: "client" as const };
    store.upsertProject(db, { ...base, id: "acme-web", name: "Web", repoPaths: ["/tmp/acme-web"] });
    store.upsertProject(db, { ...base, id: "acme-app", name: "App", repoPaths: [] });
    store.upsertProject(db, { ...base, id: "viejo", name: "Viejo", repoPaths: [] });
    store.setProjectTracker(db, "acme-web", { system: "gitlab", prefixes: [] });
    store.closeProject(db, "acme-app");
    store.archiveProject(db, "viejo");
  } finally { db.close(); }

  const r = estela(path, "es", "project", "list");
  assert.equal(r.code, 0, r.out);
  const lines = r.out.split("\n");
  assert.ok(lines.some((l) => /^ {2}acme-web {2}Web · Acme · gitlab$/.test(l)), r.out);
  assert.ok(lines.some((l) => l.trim() === "/tmp/acme-web"), r.out);
  assert.ok(lines.some((l) => /^ {2}acme-app {2}App · Acme · cerrado$/.test(l)), r.out);
  const archivados = lines.indexOf("Archivados:");
  assert.ok(archivados > 0 && lines.slice(archivados).some((l) => l.startsWith("  viejo")), r.out);
  assert.ok(lines.slice(0, archivados).every((l) => !l.startsWith("  viejo")), "el archivado no sale entre los activos");

  assert.match(estela(path, "en", "project", "list").out, /Projects \(the id is what goes in --project\)/);
});

test("project list sin proyectos dice cómo crearlos", () => {
  const r = estela(baseVacia(), "es", "project", "list");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Todavía no hay proyectos\. Para crearlos: {2}estela setup/);
});
