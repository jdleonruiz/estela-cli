import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client, Project, RatePeriod, TimeEntry } from "@estela/shared";
import {
  billableAmount, convertMoney, formatMoney, money, parseMoney, roundSeconds,
} from "@estela/shared";

import { InvoiceError, issueInvoice, marginOf, rateAt } from "./invoice.js";

// El caso real: freelance, proyecto por horas, 13 EUR/hora pactados.
const NEBULA: Client = {
  id: "nebula", name: "Nebula", currency: "EUR", taxId: "B-12345678",
};

const PROYECTO: Project = {
  id: "portal-ventas",
  clientId: "nebula",
  name: "Portal Ventas",
  repoPaths: ["/home/dev/proyectos/portal-ventas"],
  billable: true,
  roundingMinutes: 0,
  aiCostPolicy: "absorbed", kind: "client",
};

const TARIFA: RatePeriod = {
  projectId: "portal-ventas",
  hourlyRate: money(1300, "EUR"), // 13,00 EUR/hora
  effectiveFrom: new Date("2025-01-01T00:00:00Z"),
  effectiveTo: null,
};

function entry(id: string, startIso: string, seconds: number, microUsd = 0): TimeEntry {
  const startedAt = new Date(startIso);
  return {
    id, projectId: "portal-ventas", startedAt,
    endedAt: new Date(startedAt.getTime() + seconds * 1000),
    seconds, description: `Bloque ${id}`, billable: true, invoiceId: null,
    aiCost: { microUsd }, agentSeconds: seconds, commitHashes: [], agents: ["claude-code"],
    source: "agent", kind: "development", branch: "main",
  };
}

// ---------------------------------------------------------------------------
// Dinero
// ---------------------------------------------------------------------------

test("13 EUR/hora se guarda como 1300 céntimos, no como 13.0", () => {
  const rate = parseMoney("13", "EUR");
  assert.equal(rate.amount, 1300);
  assert.equal(rate.currency, "EUR");
  assert.equal(formatMoney(rate), "€13,00");
});

test("acepta decimales y coma decimal", () => {
  assert.equal(parseMoney("13.50", "EUR").amount, 1350);
  assert.equal(parseMoney("13,50", "EUR").amount, 1350);
  assert.equal(parseMoney("0.01", "EUR").amount, 1);
});

test("una hora exacta a 13 EUR son 13 EUR", () => {
  assert.equal(billableAmount(3600, money(1300, "EUR")).amount, 1300);
});

test("media hora a 13 EUR son 6,50 EUR sin error de coma flotante", () => {
  assert.equal(billableAmount(1800, money(1300, "EUR")).amount, 650);
});

test("sumar diez mil bloques no acumula deriva", () => {
  let total = 0;
  for (let i = 0; i < 10_000; i++) total += billableAmount(600, money(1300, "EUR")).amount;
  // 10 min a 13 EUR/h = 216,666... céntimos -> 217 tras redondear
  assert.equal(total, 217 * 10_000);
  assert.ok(Number.isInteger(total));
});

test("no se pueden sumar monedas distintas sin tipo de cambio", () => {
  const { addMoney } = require("@estela/shared") as typeof import("@estela/shared");
  assert.throws(() => addMoney(money(100, "EUR"), money(100, "USD")), /Monedas distintas/);
});

test("el redondeo de tiempo es una decisión separada del de dinero", () => {
  // Half-up sobre el bloque: 50 min está más cerca de 45 que de 60.
  assert.equal(roundSeconds(3000, 15), 2700);  // 50 min -> 45 min
  assert.equal(roundSeconds(3300, 15), 3600);  // 55 min -> 1 h
  assert.equal(roundSeconds(3000, 0), 3000);   // exacto
  assert.equal(roundSeconds(400, 15), 0);      // 6,6 min -> 0 con bloques de 15
});

// ---------------------------------------------------------------------------
// Tarifas con vigencia
// ---------------------------------------------------------------------------

test("subir la tarifa no reescribe lo ya trabajado", () => {
  const rates: RatePeriod[] = [
    { ...TARIFA, effectiveTo: new Date("2026-06-01T00:00:00Z") },
    { projectId: "portal-ventas", hourlyRate: money(1600, "EUR"),
      effectiveFrom: new Date("2026-06-01T00:00:00Z"), effectiveTo: null },
  ];

  assert.equal(rateAt(rates, "portal-ventas", new Date("2026-03-15T10:00:00Z"))!.amount, 1300);
  assert.equal(rateAt(rates, "portal-ventas", new Date("2026-08-15T10:00:00Z"))!.amount, 1600);
});

// ---------------------------------------------------------------------------
// Emisión
// ---------------------------------------------------------------------------

test("factura al corte: incluye lo anterior y excluye lo posterior", () => {
  const entries = [
    entry("a", "2026-08-10T09:00:00Z", 3600),
    entry("b", "2026-08-15T09:00:00Z", 5400),   // 1,5 h
    entry("c", "2026-08-28T09:00:00Z", 3600),   // después del corte
  ];

  const invoice = issueInvoice({
    client: NEBULA, project: PROYECTO, rates: [TARIFA], entries,
    cutoffAt: new Date("2026-08-25T23:59:59Z"), number: "F-2026-001",
  });

  assert.equal(invoice.lines.length, 2);
  assert.equal(invoice.totalSeconds, 9000);            // 2,5 h
  assert.equal(invoice.subtotal.amount, 3250);         // 2,5 * 13 = 32,50 EUR
  assert.equal(formatMoney(invoice.total), "€32,50");
  assert.equal(invoice.currency, "EUR");
});

test("el coste de IA se registra aunque no se facture", () => {
  const invoice = issueInvoice({
    client: NEBULA, project: PROYECTO, rates: [TARIFA],
    entries: [entry("a", "2026-08-10T09:00:00Z", 3600, 8_016_665)],
    cutoffAt: new Date("2026-08-25T23:59:59Z"), number: "F-2026-002",
  });

  assert.equal(invoice.aiCost.microUsd, 8_016_665);
  assert.equal(invoice.aiCostBilled, null, "con política 'absorbed' no se repercute");
  assert.equal(invoice.total.amount, 1300, "el total es solo la hora facturada");
});

test("repercutir IA en EUR exige tipo de cambio explícito", () => {
  const passthrough: Project = { ...PROYECTO, aiCostPolicy: "passthrough" };
  const input = {
    client: NEBULA, project: passthrough, rates: [TARIFA],
    entries: [entry("a", "2026-08-10T09:00:00Z", 3600, 10_000_000)], // $10
    cutoffAt: new Date("2026-08-25T23:59:59Z"), number: "F-2026-003",
  };

  assert.throws(() => issueInvoice(input), /tipo de cambio/);

  const invoice = issueInvoice({ ...input, usdFxRate: 0.92 });
  assert.equal(invoice.usdFxRate, 0.92, "el tipo queda grabado en la factura");
  assert.equal(invoice.aiCostBilled!.amount, 920);        // $10 -> 9,20 EUR
  assert.equal(invoice.total.amount, 1300 + 920);
});

test("una tarifa en otra moneda que la del cliente se rechaza en vez de convertirse", () => {
  const rateUsd: RatePeriod = { ...TARIFA, hourlyRate: money(1300, "USD") };
  assert.throws(
    () => issueInvoice({
      client: NEBULA, project: PROYECTO, rates: [rateUsd],
      entries: [entry("a", "2026-08-10T09:00:00Z", 3600)],
      cutoffAt: new Date("2026-08-25T23:59:59Z"), number: "F-2026-004",
    }),
    /USD.*EUR|EUR.*USD/);
});

test("distintos freelancers, distintas monedas", () => {
  const usa: Client = { id: "acme", name: "Acme", currency: "USD" };
  const proyecto: Project = { ...PROYECTO, id: "acme-app", clientId: "acme" };
  const rate: RatePeriod = {
    projectId: "acme-app", hourlyRate: parseMoney("85", "USD"),
    effectiveFrom: new Date("2025-01-01T00:00:00Z"), effectiveTo: null,
  };

  const invoice = issueInvoice({
    client: usa, project: proyecto, rates: [rate],
    entries: [{ ...entry("a", "2026-08-10T09:00:00Z", 7200), projectId: "acme-app" }],
    cutoffAt: new Date("2026-08-25T23:59:59Z"), number: "F-2026-005",
  });

  assert.equal(invoice.currency, "USD");
  assert.equal(invoice.subtotal.amount, 17_000);   // 2 h * $85
  assert.equal(formatMoney(invoice.subtotal), "$170,00");
});

test("sin tarifa definida, error claro en vez de factura a cero", () => {
  assert.throws(
    () => issueInvoice({
      client: NEBULA, project: PROYECTO, rates: [],
      entries: [entry("a", "2026-08-10T09:00:00Z", 3600)],
      cutoffAt: new Date("2026-08-25T23:59:59Z"), number: "F-2026-006",
    }),
    /Sin tarifa vigente/);
});

test("lo ya facturado no se vuelve a facturar", () => {
  const entries = [
    { ...entry("a", "2026-08-10T09:00:00Z", 3600), invoiceId: "inv_F-2026-001" },
    entry("b", "2026-08-11T09:00:00Z", 3600),
  ];

  const invoice = issueInvoice({
    client: NEBULA, project: PROYECTO, rates: [TARIFA], entries,
    cutoffAt: new Date("2026-08-25T23:59:59Z"), number: "F-2026-007",
  });

  assert.equal(invoice.lines.length, 1);
  assert.equal(invoice.subtotal.amount, 1300);
});

test("margen real tras descontar la IA", () => {
  const invoice = issueInvoice({
    client: NEBULA, project: PROYECTO, rates: [TARIFA],
    entries: [entry("a", "2026-08-10T09:00:00Z", 36_000, 8_016_665)], // 10 h, $8,02 de IA
    cutoffAt: new Date("2026-08-25T23:59:59Z"), number: "F-2026-008",
  });

  const m = marginOf(invoice, 0.92);
  assert.equal(m.revenue.amount, 13_000);            // 10 h * 13 EUR = 130 EUR
  assert.equal(m.aiCost.amount, 738);                // $8,02 * 0,92 = 7,38 EUR
  assert.equal(m.margin.amount, 13_000 - 738);
  assert.ok(m.marginPct > 94 && m.marginPct < 95);
});

test("un tipo de cambio nunca se recalcula solo", () => {
  const en_marzo = convertMoney(money(1000, "USD"), "EUR", 0.92);
  const en_noviembre = convertMoney(money(1000, "USD"), "EUR", 0.88);
  assert.equal(en_marzo.amount, 920);
  assert.equal(en_noviembre.amount, 880);
  // La factura guarda su tipo, así que la de marzo sigue diciendo 920.
});

test("sin horas pendientes, error explicativo", () => {
  assert.throws(
    () => issueInvoice({
      client: NEBULA, project: PROYECTO, rates: [TARIFA], entries: [],
      cutoffAt: new Date("2026-08-25T23:59:59Z"), number: "F-2026-009",
    }),
    InvoiceError);
});
