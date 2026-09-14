import assert from "node:assert/strict";
import { test } from "node:test";

import { isNewer } from "./updateCheck.js";

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
