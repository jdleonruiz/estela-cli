import assert from "node:assert/strict";
import { test } from "node:test";

import { badgeMarkdown, badgeText, badgeUrl } from "./badge.js";

test("el texto del badge: horas medidas y coste de IA", () => {
  assert.equal(badgeText({ measuredSeconds: 42 * 3600, aiCost: "$18" }), "Built in 42 h · $18 of AI");
});

test("sin coste de IA (Copilot, suscripción sin registrar) no se inventa un $0", () => {
  assert.equal(badgeText({ measuredSeconds: 42 * 3600, aiCost: null }), "Built in 42 h");
});

test("las horas se redondean, y menos de media hora no se queda en 0 h", () => {
  assert.equal(badgeText({ measuredSeconds: 90 * 60, aiCost: null }), "Built in 2 h");
  assert.equal(badgeText({ measuredSeconds: 20 * 60, aiCost: null }), "Built in <1 h");
});

test("miles con separador: 1,204 h se lee mejor que 1204 h", () => {
  assert.equal(badgeText({ measuredSeconds: 1204 * 3600, aiCost: null }), "Built in 1,204 h");
});

test("la URL es un badge estático de shields.io, con guiones y espacios escapados", () => {
  const url = badgeUrl("Built in 42 h · $18 of AI");
  assert.equal(url,
    "https://img.shields.io/badge/Built%20in%2042%20h%20%C2%B7%20%2418%20of%20AI-0E7C6B");
  // Un guion en el texto partiría el badge en etiqueta y mensaje: shields lo quiere doble.
  assert.match(badgeUrl("re-write"), /\/badge\/re--write-0E7C6B$/);
  assert.match(badgeUrl("a_b"), /\/badge\/a__b-0E7C6B$/);
});

test("el markdown enlaza a la web en inglés, con el texto como alternativa", () => {
  assert.equal(badgeMarkdown("Built in 42 h"),
    "[![Built in 42 h](https://img.shields.io/badge/Built%20in%2042%20h-0E7C6B)](https://getestela.dev/en/)");
});
