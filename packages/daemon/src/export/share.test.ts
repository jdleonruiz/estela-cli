import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client, Project, TimeEntry } from "@estela/shared";
import { money } from "@estela/shared";

import { buildShareReport } from "./share.js";

const CLIENT: Client = { id: "nebula", name: "Nebula", currency: "EUR" };
const PROJECT: Project = {
  id: "nebula", clientId: "nebula", name: "Portal Ventas", repoPaths: [],
  billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client",
};

function entry(id: string, dayIso: string, seconds: number, micro = 250_000_000): TimeEntry {
  const startedAt = new Date(`${dayIso}T09:00:00Z`);
  return {
    id, projectId: "nebula", startedAt,
    endedAt: new Date(startedAt.getTime() + seconds * 1000),
    seconds, description: `Trabajo del ${dayIso}`, billable: true, invoiceId: null,
    aiCost: { microUsd: micro }, agentSeconds: seconds,
    commitHashes: ["abc1234def"], agents: ["claude-code"],
    source: "agent", kind: "development", branch: "main",
  };
}

const BASE = {
  project: PROJECT, client: CLIENT, from: "2026-08-01", to: "2026-08-31",
  commitsOf: () => [{ hash: "abc1234def", subject: "feat: validación de cédula" }],
};

// ── La garantía que no puede romperse ──────────────────────────────────

test("el consumo de IA NUNCA llega al informe compartido", () => {
  // Si un cliente ve qué parte del trabajo generó una IA, tiene un argumento
  // nuevo para negociar la tarifa. Con `aiPayer: "self"` el dato no viaja, y no
  // hay ninguna bandera que lo haga viajar.
  const html = buildShareReport({
    ...BASE,
    entries: [entry("a", "2026-08-10", 7200, 999_000_000)],
    aiPayer: "self",
  });

  for (const leak of ["microUsd", "aiCost", "tarifa API", "consumo de IA",
                      "tokens", "Claude", "999", "USD"]) {
    assert.ok(!html.includes(leak), `el informe no debe contener "${leak}"`);
  }
});

test("los importes quedan fuera salvo que se pidan explícitamente", () => {
  const entries = [entry("a", "2026-08-10", 3600)];
  const rateAt = () => money(1300, "EUR");

  const sin = buildShareReport({ ...BASE, entries, rateAt });
  assert.ok(!sin.includes("€"), "sin --with-amounts no aparece ningún importe");
  assert.ok(!sin.includes("valor del trabajo"));

  const con = buildShareReport({ ...BASE, entries, rateAt, withAmounts: true });
  assert.ok(con.includes("€13,00"), "con --with-amounts sí aparece");
  assert.ok(con.includes("valor del trabajo"));
});

test("pedir importes sin función de tarifa no rompe ni inventa cifras", () => {
  const html = buildShareReport({
    ...BASE, entries: [entry("a", "2026-08-10", 3600)], withAmounts: true,
  });
  assert.ok(!html.includes("€"));
});

// ── Autonomía del fichero ──────────────────────────────────────────────

test("no depende de ningún recurso externo salvo el enlace del pie", () => {
  // Se abre desde un adjunto de correo, sin red y sin servidor. Cualquier
  // src= o link rel=stylesheet lo dejaría a medio pintar.
  const html = buildShareReport({ ...BASE, entries: [entry("a", "2026-08-10", 3600)] });

  assert.ok(!html.includes("<script"), "sin JavaScript");
  assert.ok(!/src\s*=/.test(html), "sin recursos externos");
  assert.ok(!/<link\b/.test(html), "sin hojas de estilo enlazadas");

  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["https://getestela.dev"], "solo el enlace del pie");
});

test("escapa el contenido para que un mensaje de commit no rompa el HTML", () => {
  const malicioso = {
    ...entry("a", "2026-08-10", 3600),
    description: `<script>alert("x")</script> & "comillas"`,
  };
  const html = buildShareReport({ ...BASE, entries: [malicioso], commitsOf: () => [] });

  assert.ok(!html.includes("<script>alert"), "la etiqueta va escapada");
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp;"));
});

// ── Contenido ──────────────────────────────────────────────────────────

test("agrupa por día y suma las horas", () => {
  const html = buildShareReport({
    ...BASE,
    entries: [
      entry("a", "2026-08-10", 3600),
      entry("b", "2026-08-10", 1800),
      entry("c", "2026-08-12", 7200),
    ],
  });

  assert.ok(html.includes("3h 30m"), "total de 1h + 30m + 2h");
  assert.ok(html.includes("2 días con actividad") || html.includes(">2<"));
});

test("incluye los commits como respaldo", () => {
  const html = buildShareReport({ ...BASE, entries: [entry("a", "2026-08-10", 3600)] });
  assert.ok(html.includes("abc1234"), "hash abreviado");
  assert.ok(html.includes("validación de cédula"), "asunto del commit");
});

test("solo el periodo pedido, y solo lo facturable", () => {
  const fuera = entry("fuera", "2026-09-15", 3600);
  const noFacturable = { ...entry("nf", "2026-08-11", 3600), billable: false };

  const html = buildShareReport({
    ...BASE,
    entries: [entry("dentro", "2026-08-10", 3600), fuera, noFacturable],
  });

  assert.ok(html.includes("Trabajo del 2026-08-10"));
  assert.ok(!html.includes("Trabajo del 2026-09-15"), "fuera del periodo");
  assert.ok(!html.includes("Trabajo del 2026-08-11"), "no facturable");
});

test("un periodo vacío da un informe válido, no un error", () => {
  const html = buildShareReport({ ...BASE, entries: [] });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("No hay trabajo registrado"));
});
