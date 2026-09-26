import assert from "node:assert/strict";
import { test } from "node:test";

import { baseName, isSameOrInside, normalizePath } from "./paths.js";

test("una ruta de Windows queda igual venga del agente o de git", () => {
  assert.equal(normalizePath("C:\\Users\\ana\\repo"), "C:/Users/ana/repo");
  assert.equal(normalizePath("c:/Users/ana/repo/"), "C:/Users/ana/repo");
  assert.equal(normalizePath("C:\\Users\\ana\\\\repo\\"), "C:/Users/ana/repo");
  assert.equal(normalizePath("C:\\"), "C:/");
  assert.equal(normalizePath("\\\\servidor\\equipo\\repo"), "//servidor/equipo/repo");
  // macOS y Linux no se tocan, ni siquiera la barra del final.
  assert.equal(normalizePath("/Users/ana/repo"), "/Users/ana/repo");
  assert.equal(normalizePath("/home/ana/mi\\carpeta"), "/home/ana/mi\\carpeta");
});

test("dentro de un repo, con barras y mayúsculas de Windows mezcladas", () => {
  assert.ok(isSameOrInside("C:\\Users\\Ana\\repo\\src\\UI", "C:/Users/ana/repo"));
  assert.ok(isSameOrInside("c:\\users\\ana\\repo", "C:/Users/Ana/repo"));
  assert.ok(!isSameOrInside("C:\\Users\\ana\\repo2", "C:/Users/ana/repo"));
  // En macOS y Linux las mayúsculas sí cuentan.
  assert.ok(isSameOrInside("/Users/ana/repo/src", "/Users/ana/repo"));
  assert.ok(!isSameOrInside("/Users/ana/Repo", "/Users/ana/repo"));
  assert.ok(!isSameOrInside("/Users/ana/repo2", "/Users/ana/repo"));
});

test("el nombre de un repositorio, en cualquier sistema", () => {
  assert.equal(baseName("C:\\Users\\ana\\tienda-acme"), "tienda-acme");
  assert.equal(baseName("/home/ana/tienda-acme/"), "tienda-acme");
});
