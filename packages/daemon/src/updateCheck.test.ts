import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { checkForUpdate, isNewer, updateCheckDisabled } from "./updateCheck.js";

test("compara versiones como números, no como texto", () => {
  // El fallo con comparación de texto: "1.10.0" < "1.2.3" alfabéticamente,
  // porque "1" va antes que "2". Numéricamente es al revés.
  assert.equal(isNewer("1.10.0", "1.2.3"), true);
  assert.equal(isNewer("1.2.3", "1.10.0"), false);
});

test("la misma versión no es más nueva que sí misma", () => {
  assert.equal(isNewer("0.1.2", "0.1.2"), false);
});

test("compara por partes, no por longitud", () => {
  assert.equal(isNewer("0.1.2", "0.1"), true, "0.1 se lee como 0.1.0");
  assert.equal(isNewer("0.1", "0.1.2"), false);
});

test("casos normales", () => {
  assert.equal(isNewer("0.1.3", "0.1.2"), true);
  assert.equal(isNewer("0.1.2", "0.1.3"), false);
  assert.equal(isNewer("1.0.0", "0.9.9"), true);
});

// ── Desactivarla ──────────────────────────────────────────────────────────

test("ESTELA_NO_UPDATE_CHECK=1 la apaga; vacía o 0, no", () => {
  assert.equal(updateCheckDisabled({ ESTELA_NO_UPDATE_CHECK: "1" }), true);
  assert.equal(updateCheckDisabled({ ESTELA_NO_UPDATE_CHECK: "true" }), true);
  assert.equal(updateCheckDisabled({ ESTELA_NO_UPDATE_CHECK: "0" }), false);
  assert.equal(updateCheckDisabled({ ESTELA_NO_UPDATE_CHECK: "" }), false);
  assert.equal(updateCheckDisabled({}), false);
});

test("con CI definida no se comprueba, tenga el valor que tenga", () => {
  assert.equal(updateCheckDisabled({ CI: "true" }), true);
  assert.equal(updateCheckDisabled({ CI: "1" }), true);
  assert.equal(updateCheckDisabled({ CI: "" }), true);
});

/** Ejecuta `fn` con un fetch que apunta cada llamada y HOME en una carpeta vacía. */
async function withFakeFetch(fn: (urls: string[]) => Promise<void> | void): Promise<void> {
  const realFetch = globalThis.fetch;
  const home = process.env["HOME"];
  const urls: string[] = [];
  process.env["HOME"] = mkdtempSync(join(tmpdir(), "estela-update-"));
  globalThis.fetch = (async (url: unknown) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 });
  }) as typeof fetch;
  try { await fn(urls); } finally {
    globalThis.fetch = realFetch;
    if (home === undefined) delete process.env["HOME"]; else process.env["HOME"] = home;
  }
}

test("desactivada no llama a npm ni escribe el caché", async () => {
  await withFakeFetch(async (urls) => {
    checkForUpdate("0.2.3", { ESTELA_NO_UPDATE_CHECK: "1" });
    checkForUpdate("0.2.3", { CI: "true" });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(urls, []);
    assert.ok(!existsSync(join(process.env["HOME"]!, ".estela", "update-check.json")));
  });
});

test("sin desactivar, consulta npm una vez y guarda el resultado", async () => {
  await withFakeFetch(async (urls) => {
    checkForUpdate("0.2.3", {});
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(urls, ["https://registry.npmjs.org/estela/latest"]);
    assert.ok(existsSync(join(process.env["HOME"]!, ".estela", "update-check.json")));
  });
});
