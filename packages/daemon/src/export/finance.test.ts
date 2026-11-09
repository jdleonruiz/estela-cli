import assert from "node:assert/strict";
import { test } from "node:test";

import { money } from "@estela/shared";

import type { Cost } from "../delivery/report.js";
import { setLang } from "../i18n/index.js";
import { financeToCsv, financeToJson, financeToMarkdown, periodName, sum, type FinanceSummary } from "./finance.js";

/**
 * El informe para finanzas, con cifras inventadas. Lo que se comprueba: que
 * los titulares no hablan como un programador, y que las tres salidas dicen lo
 * mismo.
 */

const cost = (hours: number, usd: number, eur: number | null): Cost => ({
  seconds: hours * 3600, consumption: { microUsd: usd * 1e6 }, real: eur === null ? null : money(eur * 100, "EUR"),
  realPartial: false,
});

function resumen(over: Partial<FinanceSummary> = {}): FinanceSummary {
  const tienda = cost(10, 80, 120);
  const app = cost(4, 20, 30);
  return {
    from: "2026-10-01", to: "2026-10-31", currency: "EUR", paid: cost(14, 110, 180), unassigned: cost(0, 10, 30),
    clients: [
      { id: "acme", name: "Acme", cost: tienda, projects: [{ id: "tienda", name: "Tienda", cost: tienda }] },
      { id: "beta", name: "Beta | Corp", cost: app, projects: [{ id: "app", name: "App", cost: app }] },
    ],
    deliveries: [{
      projectName: "Tienda", clientName: "Acme", source: "github", fetchedAt: new Date("2026-11-02T10:00:00Z"),
      delivered: [{ label: "#12 Login con Google", cost: cost(5, 40, 60) }],
      plan: { label: "Q4", delivered: 1, total: 2, pending: cost(0, 0, 0), unplanned: cost(1, 5, 7.5) },
      requests: [{ name: "Acme", mapped: true, cost: cost(5, 40, 60) }, { name: "globex", mapped: false, cost: cost(1, 5, 7.5) }],
      requestsRest: cost(4, 35, 52.5),
    }],
    undelivered: [{ projectName: "Tienda", total: cost(10, 80, 120), undelivered: cost(0, 20, 30),
                    withoutCommit: cost(0, 16, 24), unmergedBranches: cost(0, 4, 6), unmergedCount: 1 }],
    staleDays: 14, unpricedAgents: true, ...over,
  };
}

test("Markdown: los titulares en lenguaje de finanzas; los detalles técnicos, al final", () => {
  setLang("es");
  const texto = financeToMarkdown(resumen());
  const [cabeza, detalles] = texto.split("## Cómo se calcula");
  assert.ok(detalles, "la sección de cómo se calcula existe y va la última");
  assert.doesNotMatch(cabeza!, /token|sesi[oó]n|commit|API/i, "nada técnico antes de los detalles");
  assert.match(texto, /^# Gasto en IA · octubre de 2026\n/);
  assert.match(texto, /- \*\*Pagado en IA:\*\* €180,00/);
  assert.match(texto, /- \*\*Horas de trabajo con IA:\*\* 14h en 2 proyectos de 2 clientes\./);
  assert.match(texto, /- \*\*Fuera de proyectos:\*\* €30,00 \(16\.7 %\)/);
  assert.match(texto, /\| Acme \| Tienda \| 10h \| €120,00 \| 66\.7 % \|/);
  assert.match(texto, /\| Beta \\\| Corp \| App \|/, "una barra en un nombre no rompe la tabla");
  assert.match(texto, /Del plan \(Q4\) se entregaron 1 de 2\./);
  assert.match(texto, /\| globex \(sin identificar\) \| 1h \| €7,50 \|/);
  assert.match(texto, /No incluye ingresos ni contratos: Estela no los conoce\./);
  assert.match(texto, /\| Tienda \| €30,00 \| 25\.0 % \| €24,00 \| €6,00 \(1\) \|/);
  assert.match(detalles!, /Copilot no registra tokens/);
});

test("sin cuota registrada lo dice: es una estimación a precio de lista, no lo pagado", () => {
  setLang("es");
  const sinCuota = resumen({ currency: null, paid: cost(14, 110, null) });
  const texto = financeToMarkdown(sinCuota);
  assert.match(texto, /- \*\*Gasto en IA:\*\* \$110,00 a precio de lista\. No hay cuota registrada/);
  assert.match(texto, /regístrala con estela subscription add/);
});

test("CSV: una fila por cifra con su sección; JSON: las mismas cifras", () => {
  setLang("es");
  const csv = financeToCsv(resumen()).replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(csv[0], "seccion,cliente,proyecto,concepto,horas,gasto,moneda,valor_uso_usd_precio_lista,pct");
  assert.ok(csv.includes("resumen,,,pagado,14.0000,180.00,EUR,110.0000,100.00"), csv.join("\n"));
  assert.ok(csv.includes("cliente,Acme,Tienda,proyecto,10.0000,120.00,EUR,80.0000,66.67"));
  assert.ok(csv.includes("entrega,Acme,Tienda,#12 Login con Google,5.0000,60.00,EUR,40.0000,"));
  assert.ok(csv.includes("peticion,Acme,Tienda,globex,1.0000,7.50,EUR,5.0000,"));
  assert.ok(csv.includes("sin_entrega,,Tienda,sin_entregar,0.0000,30.00,EUR,20.0000,25.0"));

  const j = financeToJson(resumen()) as { paid: { real: { amountMinor: number } }; clients: unknown[] };
  assert.equal(j.paid.real.amountMinor, 18_000);
  assert.equal(j.clients.length, 2);
});

test("en inglés, el CSV cambia de cabeceras y el texto de idioma", () => {
  setLang("en");
  try {
    assert.match(financeToMarkdown(resumen()), /^# AI spend · October 2026\n/);
    assert.match(financeToCsv(resumen()), /^﻿section,client,project,item,hours,spend,currency/);
  } finally { setLang("es"); }
});

test("el nombre del periodo y la suma de costes", () => {
  setLang("es");
  assert.equal(periodName("2026-02-01", "2026-02-28"), "febrero de 2026");
  assert.equal(periodName("2026-10-01", "2026-10-31"), "octubre de 2026");
  assert.equal(periodName("2026-10-05", "2026-10-20"), "2026-10-05 → 2026-10-20");
  const s = sum(cost(1, 2, 3), cost(2, 3, 4));
  assert.deepEqual([s.seconds, s.consumption.microUsd, s.real], [3 * 3600, 5e6, money(700, "EUR")]);
});
