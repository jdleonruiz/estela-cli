import assert from "node:assert/strict";
import { test } from "node:test";

import type { Subscription } from "@estela/shared";
import { formatMoney, money, parseMoney } from "@estela/shared";

import { amortize, feeForMonth, monthOf, shareForProject } from "./amortize.js";

const CLAUDE_MAX: Subscription = {
  id: "claude-max", name: "Claude Max",
  monthlyFee: parseMoney("200", "USD"),
  effectiveFrom: new Date("2025-01-01T00:00:00Z"), effectiveTo: null,
};

test("reparte la cuota en proporción al consumo", () => {
  const shares = amortize([
    { projectId: "a", month: "2026-08", consumption: { microUsd: 75_000_000 } }, // 75%
    { projectId: "b", month: "2026-08", consumption: { microUsd: 25_000_000 } }, // 25%
  ], [CLAUDE_MAX]);

  const a = shares.find((s) => s.projectId === "a")!;
  const b = shares.find((s) => s.projectId === "b")!;

  assert.equal(a.share, 0.75);
  assert.equal(formatMoney(a.amount), "$150,00");
  assert.equal(formatMoney(b.amount), "$50,00");
  assert.equal(a.amount.amount + b.amount.amount, 20_000, "el reparto suma la cuota entera");
});

test("lo no facturable también consume cuota, y por eso entra en el denominador", () => {
  // Si tus experimentos se comen la mitad, al cliente solo le toca la otra mitad.
  const shares = amortize([
    { projectId: "cliente", month: "2026-08", consumption: { microUsd: 50_000_000 } },
    { projectId: "experimentos", month: "2026-08", consumption: { microUsd: 50_000_000 } },
  ], [CLAUDE_MAX]);

  const cliente = shares.find((s) => s.projectId === "cliente")!;
  assert.equal(formatMoney(cliente.amount), "$100,00");
  assert.equal(cliente.share, 0.5);
});

test("el trabajo sin asignar a proyecto también diluye la cuota", () => {
  // El fallo que esto previene: con un solo proyecto configurado y el 90% del
  // consumo en repos sin registrar, ese proyecto cargaba con la cuota entera.
  const shares = amortize(
    [{ projectId: "nebula", month: "2026-08", consumption: { microUsd: 10_000_000 } }],
    [CLAUDE_MAX],
    new Map([["2026-08", { microUsd: 100_000_000 }]]));  // total real de la máquina

  assert.equal(shares[0]!.share, 0.1);
  assert.equal(formatMoney(shares[0]!.amount), "$20,00");
  assert.equal(shares[0]!.monthTotal.microUsd, 100_000_000,
    "el denominador es el consumo real de la máquina, no la suma de proyectos");
});

test("un total incoherente nunca hace que las partes pasen del 100%", () => {
  const shares = amortize(
    [{ projectId: "a", month: "2026-08", consumption: { microUsd: 50_000_000 } }],
    [CLAUDE_MAX],
    new Map([["2026-08", { microUsd: 10_000_000 }]]));  // menor que lo asignado

  assert.equal(shares[0]!.share, 1, "se limita al 100%, no al 500%");
  assert.equal(formatMoney(shares[0]!.amount), "$200,00");
});

test("el reparto es por mes, no acumulado", () => {
  const shares = amortize([
    { projectId: "a", month: "2026-07", consumption: { microUsd: 10_000_000 } },
    { projectId: "a", month: "2026-08", consumption: { microUsd: 30_000_000 } },
    { projectId: "b", month: "2026-08", consumption: { microUsd: 10_000_000 } },
  ], [CLAUDE_MAX]);

  const julio = shares.find((s) => s.projectId === "a" && s.month === "2026-07")!;
  const agosto = shares.find((s) => s.projectId === "a" && s.month === "2026-08")!;

  assert.equal(formatMoney(julio.amount), "$200,00", "único proyecto en julio: cuota entera");
  assert.equal(formatMoney(agosto.amount), "$150,00", "75% de agosto");
});

test("varias suscripciones a la vez se suman", () => {
  const cursor: Subscription = {
    id: "cursor", name: "Cursor", monthlyFee: parseMoney("20", "USD"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"), effectiveTo: null,
  };
  assert.equal(formatMoney(feeForMonth([CLAUDE_MAX, cursor], "2026-08")!), "$220,00");
});

test("una suscripción no vigente no cuenta", () => {
  const antigua: Subscription = {
    ...CLAUDE_MAX, id: "vieja",
    effectiveTo: new Date("2026-01-01T00:00:00Z"),
  };
  assert.equal(feeForMonth([antigua], "2026-08"), null);
  assert.equal(formatMoney(feeForMonth([antigua], "2025-06")!), "$200,00");
});

test("suscripciones en monedas distintas se rechazan en vez de convertirse", () => {
  const enEuros: Subscription = {
    id: "x", name: "X", monthlyFee: money(2000, "EUR"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"), effectiveTo: null,
  };
  assert.throws(() => feeForMonth([CLAUDE_MAX, enEuros], "2026-08"), /monedas distintas/);
});

test("sin suscripción, el reparto sale a cero en vez de inventar un coste", () => {
  const shares = amortize(
    [{ projectId: "a", month: "2026-08", consumption: { microUsd: 8_016_655 } }], []);
  assert.equal(shares[0]!.amount.amount, 0);
  assert.equal(shares[0]!.consumption.microUsd, 8_016_655, "el consumo sí se conserva");
});

test("consumo cero no divide por cero", () => {
  const shares = amortize(
    [{ projectId: "a", month: "2026-08", consumption: { microUsd: 0 } }], [CLAUDE_MAX]);
  assert.equal(shares[0]!.share, 0);
  assert.equal(shares[0]!.amount.amount, 0);
});

test("suma de un proyecto a lo largo de varios meses", () => {
  const shares = amortize([
    { projectId: "a", month: "2026-07", consumption: { microUsd: 100_000_000 } },
    { projectId: "a", month: "2026-08", consumption: { microUsd: 100_000_000 } },
  ], [CLAUDE_MAX]);

  const total = shareForProject(shares, "a", ["2026-07", "2026-08"])!;
  assert.equal(formatMoney(total), "$400,00");

  const soloJulio = shareForProject(shares, "a", ["2026-07"])!;
  assert.equal(formatMoney(soloJulio), "$200,00");
});

test("monthOf usa UTC de forma consistente", () => {
  assert.equal(monthOf(new Date("2026-08-26T23:30:00Z")), "2026-08");
  assert.equal(monthOf(new Date("2026-09-01T00:00:00Z")), "2026-09");
});

test("el reparto de la cuota se congela en el informe", () => {
  // El fallo que esto previene: el reparto es un valor derivado que cambia al
  // entrar más consumo del mismo mes. Sin congelarlo, reimprimir un informe de
  // agosto en diciembre daría otra cifra, y un documento que cambia solo no es
  // un documento.
  const enAgosto = amortize(
    [{ projectId: "a", month: "2026-08", consumption: { microUsd: 50_000_000 } }],
    [CLAUDE_MAX],
    new Map([["2026-08", { microUsd: 100_000_000 }]]));

  const congelado = shareForProject(enAgosto, "a", ["2026-08"])!;
  assert.equal(formatMoney(congelado), "$100,00");

  // En diciembre se conoce el doble de consumo de ese mismo mes.
  const enDiciembre = amortize(
    [{ projectId: "a", month: "2026-08", consumption: { microUsd: 50_000_000 } }],
    [CLAUDE_MAX],
    new Map([["2026-08", { microUsd: 200_000_000 }]]));

  const recalculado = shareForProject(enDiciembre, "a", ["2026-08"])!;
  assert.equal(formatMoney(recalculado), "$50,00");
  assert.notEqual(congelado.amount, recalculado.amount,
    "el recálculo cambia: por eso hay que guardar el de su día");
});
