import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client, Invoice, Project, TimeEntry } from "@estela/shared";
import { money, setMoneyLocale } from "@estela/shared";

import { withLang } from "../i18n/index.js";
import { invoiceToCsv, timeEntriesToCsv } from "./csv.js";
import { invoiceToPdf } from "./invoice-pdf.js";
import { buildPanel } from "./panel.js";
import { buildShareReport } from "./share.js";

/**
 * El idioma de lo que recibe el cliente.
 *
 * El fallo que esto previene es el silencioso: un freelance con la terminal en
 * español que factura a una empresa de fuera manda un PDF, un CSV o un panel en
 * un idioma que su cliente no eligió, y nada falla — solo queda mal justo donde
 * se juzga el producto. Los textos no se comprueban uno a uno: se comprueba que
 * en un idioma no cuele el otro.
 */

const CLIENT: Client = { id: "nebula", name: "Nebula", currency: "EUR", taxId: "B-12345678" };
const PROJECT: Project = {
  id: "p", clientId: "nebula", name: "Portal Ventas", repoPaths: [],
  billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client", closedAt: null,
};

function entry(day: string, seconds: number, over: Partial<TimeEntry> = {}): TimeEntry {
  const startedAt = new Date(`${day}T10:00:00Z`);
  return {
    id: `e-${day}`, projectId: "p", startedAt,
    endedAt: new Date(startedAt.getTime() + seconds * 1000),
    seconds, description: `Trabajo del ${day}`, billable: true, invoiceId: null,
    aiCost: { microUsd: 0 }, agentSeconds: seconds,
    commitHashes: ["abc1234def"], agents: ["claude-code"],
    source: "agent", kind: "development", branch: "main",
    ...over,
  };
}

const PANEL_BASE = {
  project: PROJECT, client: CLIENT,
  commitsOf: () => [{ hash: "abc1234def", subject: "feat: validación de cédula" }],
  generatedAt: new Date("2026-09-20T09:00:00Z"),
};

/** Palabras que solo existen en español: si salen en el texto inglés, se coló. */
const SOLO_ESPANOL = /[áéíóúñ¿¡]|\b(de|del|con|sin|para|los|las|una|que|el|la|hoy|ayer|por)\b/i;

// ── El panel, ejecutado como lo ejecuta el navegador ────────────────────

interface Nodo { innerHTML: string; textContent: string; attrs: Record<string, string> }

/**
 * Ejecuta el JS del panel contra un DOM de mentira y devuelve lo que pintó.
 *
 * Es lo único que prueba el cableado de verdad: que cada `L.algo` que pide el
 * script existe en las etiquetas, y que ninguna plantilla quedó a medias. Un
 * error tipográfico ahí solo se vería, de otro modo, abriendo el panel.
 */
function pintar(html: string): Record<string, Nodo> {
  const bloque = (id: string) =>
    new RegExp(`<script id="${id}"[^>]*>(.*?)</script>`, "s").exec(html)![1]!;
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const programa = scripts[scripts.length - 1]![1]!;

  const nodos: Record<string, Nodo> = {};
  const nodo = (id: string): Nodo => (nodos[id] ??= { innerHTML: "", textContent: "", attrs: {} });
  const doc = {
    getElementById(id: string) {
      // Los dos bloques de datos se leen; el resto son nodos que se rellenan.
      if (id === "data" || id === "ui") return { textContent: bloque(id) };
      const n = nodo(id);
      return Object.assign(n, {
        setAttribute: (k: string, v: string) => { n.attrs[k] = v; },
        classList: { toggle: () => false, add: () => undefined },
      });
    },
    querySelectorAll: () => [],
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  new Function("document", "requestAnimationFrame", "setTimeout", programa)(
    doc, () => undefined, () => undefined);
  return nodos;
}

const HORAS = [entry("2026-07-28", 3600), entry("2026-09-16", 5400)];

test("el panel en inglés: documento, texto y fechas, todo en inglés", () => {
  const html = withLang("en", () => buildPanel({ ...PANEL_BASE, entries: HORAS }));
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Project progress<\/title>/);
  assert.ok(html.includes("Read-only"));
  assert.ok(html.includes("Where the effort went"));
  assert.ok(!html.includes("Solo lectura") && !html.includes("Avance del proyecto"),
    "no queda español en el HTML estático");

  const p = pintar(html);
  // Los KPI: "hours worked" y "days with activity · from Jul 28 to Sep 16".
  assert.ok(p["kpis"]!.innerHTML.includes("hours worked"), p["kpis"]!.innerHTML);
  assert.ok(p["kpis"]!.innerHTML.includes("days with activity · from Jul 28 to Sep 16"),
    p["kpis"]!.innerHTML);
  assert.ok(p["kpis"]!.innerHTML.includes("workstream"));
  assert.match(p["lead"]!.innerHTML, /^Most of the work went into <b>main<\/b>/);
  assert.equal(p["detail-count"]!.textContent, "2 days");
  assert.ok(p["footer-text"]!.innerHTML.includes("Hours measured with"));
  assert.ok(p["footer-text"]!.innerHTML.includes(">Estela</a>"));
  assert.ok(p["days"]!.innerHTML.includes("Tuesday, July 28"), p["days"]!.innerHTML);
});

test("el panel en español sigue diciendo lo mismo que antes", () => {
  const html = withLang("es", () => buildPanel({ ...PANEL_BASE, entries: HORAS }));
  assert.match(html, /<html lang="es">/);
  assert.match(html, /<title>Avance del proyecto<\/title>/);
  assert.ok(html.includes("Solo lectura"));

  const p = pintar(html);
  assert.ok(p["kpis"]!.innerHTML.includes("horas trabajadas"));
  assert.ok(p["kpis"]!.innerHTML.includes("días con actividad · del 28 jul al 16 sep"),
    p["kpis"]!.innerHTML);
  assert.equal(p["detail-count"]!.textContent, "2 días");
  assert.ok(p["days"]!.innerHTML.includes("martes 28 de julio"), p["days"]!.innerHTML);
});

test("ninguna etiqueta del panel en inglés conserva palabras del español", () => {
  const html = withLang("en", () => buildPanel({ ...PANEL_BASE, entries: HORAS }));
  const ui = JSON.parse(/<script id="ui"[^>]*>(.*?)<\/script>/s.exec(html)![1]!) as {
    L: Record<string, string | { one: string; other: string }>;
  };

  const textos: [string, string][] = [];
  for (const [clave, valor] of Object.entries(ui.L)) {
    if (typeof valor === "string") textos.push([clave, valor]);
    else textos.push([`${clave}.one`, valor.one], [`${clave}.other`, valor.other]);
  }
  assert.ok(textos.length > 40, "se están mirando las etiquetas de verdad");
  const colados = textos.filter(([, t]) => SOLO_ESPANOL.test(t));
  assert.deepEqual(colados, [], "estas etiquetas siguen en español");
});

test("los importes del panel usan el formato del idioma del documento, no el de la terminal", () => {
  // La terminal está en español (setMoneyLocale por defecto) y el panel en inglés.
  setMoneyLocale("es-EC");
  const opts = {
    ...PANEL_BASE, entries: [entry("2026-08-10", 3600)],
    withAmounts: true, rateAt: () => money(130000, "EUR"),
  };
  const en = withLang("en", () => buildPanel(opts));
  const es = withLang("es", () => buildPanel(opts));
  assert.ok(en.includes("€1,300.00"), "inglés: coma para miles, punto para decimales");
  assert.ok(es.includes("€1.300,00"), "español: al revés");
});

test("los tipos de trabajo sin rama salen traducidos", () => {
  const reunion = entry("2026-08-10", 3600, { kind: "meeting", branch: null, commitHashes: [] });
  const en = withLang("en", () => buildPanel({ ...PANEL_BASE, entries: [reunion] }));
  const es = withLang("es", () => buildPanel({ ...PANEL_BASE, entries: [reunion] }));

  const nombres = (html: string) => (JSON.parse(/<script id="data"[^>]*>(.*?)<\/script>/s.exec(html)![1]!) as {
    features: { name: string }[]; days: { items: { kind: string }[] }[];
  });
  assert.equal(nombres(en).features[0]!.name, "Meeting");
  assert.equal(nombres(en).days[0]!.items[0]!.kind, "Meeting");
  assert.equal(nombres(es).features[0]!.name, "Reunión");
});

test("un commit con $' o $$ llega intacto: String.replace no lo reinterpreta", () => {
  // El fallo real: el JSON entraba en la página con `replace("__DATA__", json)`,
  // y `$'` inserta lo que viene DESPUÉS de la coincidencia (rompía el JSON y el
  // panel salía en blanco) mientras que `$$` se convertía en un solo `$`.
  const subject = "fix: cobrar $$ y $' en el total, y $` también";
  const html = buildPanel({
    ...PANEL_BASE, entries: [entry("2026-08-10", 3600)],
    commitsOf: () => [{ hash: "abc1234", subject }],
  });
  const datos = JSON.parse(/<script id="data"[^>]*>(.*?)<\/script>/s.exec(html)![1]!) as {
    days: { items: { commits: { subject: string }[] }[] }[];
  };
  assert.equal(datos.days[0]!.items[0]!.commits[0]!.subject, subject);
});

test("el texto de interfaz viaja aparte de los datos", () => {
  // Los datos son lo único que se vigila de cerca (nada de IA ni de costes): si
  // las frases sueltas viajaran dentro, esa comprobación daría falsos positivos.
  const html = buildPanel({ ...PANEL_BASE, entries: HORAS });
  const datos = /<script id="data"[^>]*>(.*?)<\/script>/s.exec(html)![1]!;
  assert.ok(!datos.includes("readOnly") && !datos.includes("Solo lectura"));
  assert.ok(/<script id="ui"[^>]*>.*Solo lectura/s.test(html));
});

// ── El informe compartible ──────────────────────────────────────────────

test("el informe compartible usa el formato de importes de SU idioma, no el de la terminal", () => {
  setMoneyLocale("es-EC");
  const opts = {
    project: PROJECT, client: CLIENT, entries: [entry("2026-08-10", 3600)],
    from: "2026-08-01", to: "2026-08-31",
    withAmounts: true, rateAt: () => money(130000, "EUR"),
  };
  assert.ok(withLang("en", () => buildShareReport(opts)).includes("€1,300.00"));
  assert.ok(withLang("es", () => buildShareReport(opts)).includes("€1.300,00"));
});

// ── El CSV ──────────────────────────────────────────────────────────────

test("las cabeceras del CSV en español no cambian nunca: hay quien las procesa", () => {
  // Una macro de Excel o el programa de la gestoría dependen de estos nombres
  // exactos. Este test es la promesa de que traducir no los toca.
  const csv = withLang("es", () => timeEntriesToCsv([entry("2026-08-10", 3600)], PROJECT, CLIENT, () => null));
  const cabecera = csv.replace("﻿", "").split("\r\n")[0];
  assert.equal(cabecera,
    "fecha,inicio,fin,horas,descripcion,proyecto,cliente,facturable,tarifa,moneda,importe,coste_ia_usd,factura,commits");
  assert.ok(csv.includes(",si,"), "facturable: si");
});

test("el CSV en inglés traduce cabeceras y valores", () => {
  const csv = withLang("en", () => timeEntriesToCsv([entry("2026-08-10", 3600)], PROJECT, CLIENT, () => null));
  const cabecera = csv.replace("﻿", "").split("\r\n")[0];
  assert.equal(cabecera,
    "date,start,end,hours,description,project,client,billable,rate,currency,amount,ai_cost_usd,invoice,commits");
  assert.ok(csv.includes(",yes,"), "billable: yes");
  assert.ok(!csv.includes(",si,"));
});

// ── El PDF ───────────────────────────────────────────────────────────────

function factura(lineas: number): Invoice {
  const lines = Array.from({ length: lineas }, (_, i) => ({
    description: `Desarrollo día ${i + 1}`,
    seconds: 3600, hourlyRate: money(130000, "EUR"), amount: money(130000, "EUR"),
  }));
  return {
    id: "inv", number: "F-2026-001", clientId: "nebula", projectId: "p",
    issuedAt: new Date("2026-08-26T10:00:00Z"),
    cutoffAt: new Date("2026-08-26T23:59:59Z"),
    periodStart: new Date("2026-07-29T00:00:00Z"),
    currency: "EUR", lines,
    subtotal: money(130000 * lineas, "EUR"), total: money(130000 * lineas, "EUR"),
    totalSeconds: 3600 * lineas, aiCost: { microUsd: 315_950_000 },
    usdFxRate: null, aiCostBilled: null, aiAmortized: null,
  };
}

const pdfDe = (lang: "es" | "en", n = 3) =>
  withLang(lang, () => invoiceToPdf(factura(n), CLIENT, PROJECT, {
    issuer: { name: "Sam Rivera" },
  })).toString("latin1");

test("el PDF en inglés no deja ninguna etiqueta en español", () => {
  const t = pdfDe("en");
  // En el PDF los paréntesis van escapados con barra invertida.
  for (const etiqueta of ["HOURS REPORT", "FROM", "TO", "PROJECT", "PERIOD", "DESCRIPTION",
                          "TIME", "RATE", "AMOUNT", "VALUE", "3 items",
                          "Issued 2026-08-26", "2026-07-29  to  2026-08-26"]) {
    assert.ok(t.includes(`(${etiqueta})`), `falta "${etiqueta}"`);
  }
  for (const viejo of ["INFORME DE HORAS", "PARA", "PERIODO", "IMPORTE", "TARIFA", "TIEMPO",
                       "conceptos", "Emitido", "NOTA INTERNA"]) {
    assert.ok(!t.includes(viejo), `no debe quedar "${viejo}"`);
  }
});

test("el PDF en español sigue igual", () => {
  const t = pdfDe("es");
  for (const etiqueta of ["INFORME DE HORAS", "PARA", "PERIODO", "IMPORTE", "3 conceptos",
                          "Emitido el 2026-08-26"]) {
    assert.ok(t.includes(`(${etiqueta})`), `falta "${etiqueta}"`);
  }
});

test("con un solo concepto el pie dice 1 concepto, no '1 conceptos'", () => {
  assert.ok(pdfDe("es", 1).includes("(1 concepto)"));
  assert.ok(pdfDe("en", 1).includes("(1 item)"));
});

test("los importes del PDF siguen el idioma del documento", () => {
  setMoneyLocale("es-EC");
  // El símbolo va codificado (\200, WinAnsi); lo que cambia con el idioma es el número.
  assert.ok(pdfDe("en").includes("1,300.00/h"));
  assert.ok(pdfDe("es").includes("1.300,00/h"));
});

test("el CSV de la factura en inglés traduce etiquetas, periodo y totales", () => {
  // El BOM del principio (para que Excel abra bien los acentos) se quita.
  const lineas = (csv: string) => csv.replace("﻿", "").split("\r\n");
  const en = lineas(withLang("en", () => invoiceToCsv(factura(2), CLIENT, PROJECT)));
  assert.ok(en.includes("invoice,F-2026-001"));
  assert.ok(en.includes("period,2026-07-29 to 2026-08-26"));
  assert.ok(en.includes("item,hours,rate,amount"));
  assert.ok(en.some((l) => l.startsWith("total,")));

  const es = lineas(withLang("es", () => invoiceToCsv(factura(2), CLIENT, PROJECT)));
  assert.ok(es.includes("periodo,2026-07-29 a 2026-08-26"));
  assert.ok(es.includes("concepto,horas,tarifa,importe"));
});
