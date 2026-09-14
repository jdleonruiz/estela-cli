import assert from "node:assert/strict";
import { test } from "node:test";

import { tooOld, versionParts } from "./node-version.js";

/**
 * Esto decide si el programa arranca en absoluto. Un fallo aquí no rompe una
 * función: deja a alguien en una versión de Node vieja viendo un error de
 * `node:sqlite` sin sentido, en vez del aviso claro que este fichero existe
 * para dar. Ver bin.ts.
 */

test("versionParts: con o sin la 'v' de delante, da los tres números", () => {
  assert.deepEqual(versionParts("v22.5.0"), [22, 5, 0]);
  assert.deepEqual(versionParts("22.5.0"), [22, 5, 0]);
  assert.deepEqual(versionParts("v16.20.2"), [16, 20, 2]);
});

test("versionParts: un formato raro no revienta, da ceros", () => {
  assert.deepEqual(versionParts(""), [0, 0, 0]);
  assert.deepEqual(versionParts("v"), [0, 0, 0]);
});

test("tooOld: por debajo del mínimo, en mayor, menor o parche", () => {
  assert.equal(tooOld("v16.20.2", "22.5.0"), true);
  assert.equal(tooOld("v22.4.9", "22.5.0"), true);
  assert.equal(tooOld("v22.5.0", "22.5.1"), true);
});

test("tooOld: en el mínimo exacto, o por encima, no está anticuado", () => {
  assert.equal(tooOld("v22.5.0", "22.5.0"), false);
  assert.equal(tooOld("v22.5.1", "22.5.0"), false);
  assert.equal(tooOld("v22.6.0", "22.5.0"), false);
  assert.equal(tooOld("v23.0.0", "22.5.0"), false);
});
