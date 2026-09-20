import assert from "node:assert/strict";
import { test } from "node:test";

import { tooOld, upgradeCommand, versionParts } from "./node-version.js";

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

test("upgradeCommand: en Windows no aconseja nvm, que allí no existe", () => {
  // El fallo real: alguien en Windows con Node 18 vio "Actualiza con nvm (nvm
  // install --lts)" y ese comando no existe en su sistema.
  assert.match(upgradeCommand("win32"), /^winget install /);
  assert.doesNotMatch(upgradeCommand("win32"), /nvm/);
  assert.equal(upgradeCommand("darwin"), "nvm install --lts");
  assert.equal(upgradeCommand("linux"), "nvm install --lts");
});

test("upgradeCommand: con nvm-windows no aconseja winget, chocaría con su Node", () => {
  // El fallo real: alguien con nvm-windows instaló Node con winget, los dos
  // escribieron en la misma carpeta y npx murió con "Class extends value
  // undefined is not a constructor or null".
  const conNvm = upgradeCommand("win32", { NVM_HOME: "C:\\Users\\x\\AppData\\Roaming\\nvm" });
  assert.match(conNvm, /^nvm install lts/);
  assert.doesNotMatch(conNvm, /winget/);
  assert.match(upgradeCommand("win32", {}), /^winget install /, "sin nvm-windows, winget");
  assert.equal(upgradeCommand("darwin", { NVM_HOME: "x" }), "nvm install --lts", "solo cuenta en Windows");
});
