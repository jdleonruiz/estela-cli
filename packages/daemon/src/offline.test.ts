import assert from "node:assert/strict";
import { test } from "node:test";

import { cloudGet, cloudPost, CloudError } from "./cloud/client.js";
import { isOffline } from "./offline.js";
import { updateCheckDisabled } from "./updateCheck.js";

/**
 * `ESTELA_OFFLINE=1` apaga toda la red. Se prueba en cada punto por donde
 * Estela sale: la comprobación de versión, las llamadas a la cuenta (aquí) y
 * el banner del panel local (server.test.ts).
 */

test("ESTELA_OFFLINE=1 o cualquier valor que no sea vacío ni 0", () => {
  assert.equal(isOffline({ ESTELA_OFFLINE: "1" }), true);
  assert.equal(isOffline({ ESTELA_OFFLINE: "true" }), true);
  assert.equal(isOffline({ ESTELA_OFFLINE: "0" }), false);
  assert.equal(isOffline({ ESTELA_OFFLINE: "" }), false);
  assert.equal(isOffline({}), false);
});

test("sin red, tampoco se comprueba la versión", () => {
  assert.equal(updateCheckDisabled({ ESTELA_OFFLINE: "1" }), true);
});

test("sin red, ninguna llamada a la cuenta llega a fetch, y el error dice por qué", async () => {
  const realFetch = globalThis.fetch;
  const before = process.env["ESTELA_OFFLINE"];
  let llamadas = 0;
  globalThis.fetch = (async () => { llamadas++; return new Response("{}"); }) as typeof fetch;
  process.env["ESTELA_OFFLINE"] = "1";
  try {
    for (const call of [
      () => cloudPost("https://getestela.dev", "/auth/device/start", { email: "a@b.com" }),
      () => cloudGet("https://getestela.dev", "/account", { deviceToken: "d" }),
    ]) {
      await assert.rejects(call(), (e: unknown) => e instanceof CloudError && /ESTELA_OFFLINE=1/.test(e.message));
    }
    assert.equal(llamadas, 0);
  } finally {
    globalThis.fetch = realFetch;
    if (before === undefined) delete process.env["ESTELA_OFFLINE"]; else process.env["ESTELA_OFFLINE"] = before;
  }
});
