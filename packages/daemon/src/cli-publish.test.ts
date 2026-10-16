import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";

/**
 * `estela publish` y `estela unpublish` contra una API de mentira: lo que se
 * prueba es lo que pasa en esta máquina — que nada se sube sin confirmar, que
 * el resumen dice lo que va a quedar público, y que despublicar llama a borrar
 * y olvida el enlace.
 */

const BIN = join(__dirname, "bin.js");

interface Call { method: string; path: string; body: Record<string, unknown> }

async function fakeApi(panels: { token: string; projectName: string; projectId: string | null }[] = []) {
  const calls: Call[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const path = req.url ?? "";
    calls.push({ method: req.method ?? "", path, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    };
    if (req.method === "POST" && path === "/panels") return send(200, { url: "https://x/e/t/", adopted: false });
    if (req.method === "GET" && path === "/panels") return send(200, { panels });
    if (req.method === "DELETE" && path.startsWith("/panels/")) return send(200, { ok: true });
    return send(404, { error: "no" });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { calls, base, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function escenario(apiBaseUrl: string | null) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "estela-publish-")));
  mkdirSync(join(home, ".estela"));
  const db = join(home, ".estela", "estela.db");
  const c = openDatabase(db);
  try {
    store.upsertClient(c, { id: "acme", name: "ACME", currency: "EUR" });
    store.upsertProject(c, { id: "web", clientId: "acme", name: "Web de ACME", repoPaths: [],
      billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client" });
    store.saveTimeEntry(c, {
      projectId: "web", startedAt: new Date(2026, 9, 5, 10), endedAt: new Date(2026, 9, 5, 11), seconds: 3600,
      description: "login", billable: true, invoiceId: null, aiCost: { microUsd: 0 }, agentSeconds: 3600,
      commitHashes: [], agents: ["claude-code"], source: "agent", kind: "development",
      branch: "feature/login", workItems: [],
    });
    if (apiBaseUrl) {
      store.setCloudAccount(c, { accountId: "a", email: "yo@x.com", plan: "free", deviceToken: "dev",
        apiBaseUrl, linkedAt: new Date() });
    }
  } finally { c.close(); }
  return { home, db };
}

function estela(home: string, ...args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { ...process.env, HOME: home, USERPROFILE: home, ESTELA_LANG: "es", NO_COLOR: "1",
        ESTELA_NO_UPDATE_CHECK: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.stdin.end();
    child.on("close", (code) => resolve({ code, out }));
  });
}

test("sin --yes y sin terminal, enseña lo que quedaría público y no sube nada", async () => {
  const api = await fakeApi();
  try {
    const { home, db } = escenario(api.base);
    const r = await estela(home, "publish", "--project", "web", "--client", "cliente@acme.com", "--db", db);
    assert.notEqual(r.code, 0, "un script que no confirma no puede creer que publicó");
    assert.match(r.out, /Esto va a quedar público/);
    assert.match(r.out, /Proyecto\s+Web de ACME · ACME/);
    assert.match(r.out, /Clientes\s+cliente@acme\.com \(recibirán un correo\)/);
    assert.match(r.out, /No se ha publicado nada/);
    assert.ok(!api.calls.some((c) => c.method === "POST" && c.path === "/panels"));
  } finally { await api.close(); }
});

test("con --yes se sube, y el enlace queda recordado para republicar", async () => {
  const api = await fakeApi();
  try {
    const { home, db } = escenario(api.base);
    const r = await estela(home, "publish", "--project", "web", "--yes", "--db", db);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Esto va a quedar público/);
    assert.match(r.out, /Panel publicado/);
    const post = api.calls.find((c) => c.method === "POST" && c.path === "/panels")!;
    assert.ok(post);
    const c = openDatabase(db);
    try { assert.equal(store.getPublicationToken(c, "web"), post.body["token"]); } finally { c.close(); }
  } finally { await api.close(); }
});

test("sin cuenta, pide login antes de enseñar ningún resumen", async () => {
  const { home, db } = escenario(null);
  const r = await estela(home, "publish", "--project", "web", "--yes", "--db", db);
  assert.notEqual(r.code, 0);
  assert.match(r.out, /estela login/);
  assert.doesNotMatch(r.out, /Esto va a quedar público/);
});

test("unpublish por proyecto borra en el servidor y olvida el enlace", async () => {
  const token = "a".repeat(32);
  const api = await fakeApi([{ token, projectName: "Web de ACME", projectId: "web" }]);
  try {
    const { home, db } = escenario(api.base);
    const c = openDatabase(db);
    try { store.recordPublication(c, "web", token, "https://getestela.dev"); } finally { c.close(); }

    const r = await estela(home, "unpublish", "web", "--db", db);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /despublicado/);
    assert.ok(api.calls.some((x) => x.method === "DELETE" && x.path === `/panels/${token}`));
    const d = openDatabase(db);
    try { assert.equal(store.getPublicationToken(d, "web"), null); } finally { d.close(); }
  } finally { await api.close(); }
});

test("unpublish --all sin terminal ni --yes no borra nada; con --yes, todos", async () => {
  const panels = [
    { token: "a".repeat(32), projectName: "Uno", projectId: "web" },
    { token: "b".repeat(32), projectName: "Dos", projectId: null },
  ];
  const api = await fakeApi(panels);
  try {
    const { home, db } = escenario(api.base);
    const no = await estela(home, "unpublish", "--all", "--db", db);
    assert.notEqual(no.code, 0);
    assert.ok(!api.calls.some((x) => x.method === "DELETE"));

    const si = await estela(home, "unpublish", "--all", "--yes", "--db", db);
    assert.equal(si.code, 0, si.out);
    assert.deepEqual(api.calls.filter((x) => x.method === "DELETE").map((x) => x.path),
      panels.map((p) => `/panels/${p.token}`));
  } finally { await api.close(); }
});

test("unpublish de algo que no está publicado lo dice, sin borrar nada", async () => {
  const api = await fakeApi([]);
  try {
    const { home, db } = escenario(api.base);
    const r = await estela(home, "unpublish", "web", "--db", db);
    assert.notEqual(r.code, 0);
    assert.match(r.out, /No hay ningún panel publicado de "web"/);
    assert.ok(!api.calls.some((x) => x.method === "DELETE"));
  } finally { await api.close(); }
});
