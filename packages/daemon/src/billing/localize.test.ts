import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client, CommitRecord, Project, RatePeriod, TimeEntry } from "@estela/shared";
import { money } from "@estela/shared";

import { invoiceToCsv, timeEntriesToCsv } from "../export/csv.js";
import { buildPanel } from "../export/panel.js";
import { buildShareReport } from "../export/share.js";
import { withLang } from "../i18n/index.js";
import { issueInvoice } from "./invoice.js";
import { localizeDescription } from "./localize.js";
import { describeBlock, type WorkBlock } from "./sessionize.js";

/**
 * Las frases que Estela escribe en la descripción de un bloque se guardan en el
 * idioma de la terminal de aquel momento, y las lee un cliente en el suyo.
 *
 * Dos cosas que no pueden fallar: que en un panel en inglés no cuele
 * "(+3 commits más)", y — más importante aún — que NUNCA se reescriba texto
 * tuyo: un asunto de commit o lo que escribes con `estela log --what` es lo que
 * el cliente paga, y traducírselo por error sería alterar su factura.
 */

function commit(subject: string, i: number): CommitRecord {
  return {
    repoPath: "/repo", hash: `abc${i}`.padEnd(10, "0"), at: new Date("2026-08-10T10:00:00Z"),
    authorEmail: "yo@ejemplo.com", authorName: "Yo", branch: "main", subject,
    linesAdded: 1, linesDeleted: 0, files: [],
  };
}

function bloque(subjects: string[], branch: string | null): WorkBlock {
  return {
    startedAt: new Date("2026-08-10T09:00:00Z"), endedAt: new Date("2026-08-10T11:00:00Z"),
    seconds: 7200, repoPath: "/repo", branch, turnCount: 3,
    aiCost: { microUsd: 0 }, models: [], sessionIds: [], unpricedModels: [],
    commits: subjects.map(commit),
  };
}

function entrada(over: Partial<TimeEntry>): TimeEntry {
  return {
    id: "e", projectId: "p", startedAt: new Date("2026-08-10T09:00:00Z"),
    endedAt: new Date("2026-08-10T10:00:00Z"), seconds: 3600, description: "x",
    billable: true, invoiceId: null, aiCost: { microUsd: 0 }, agentSeconds: 3600,
    commitHashes: [], agents: ["claude-code"], source: "agent", kind: "development",
    branch: "main", ...over,
  };
}

const HASHES = (n: number) => Array.from({ length: n }, (_, i) => `h${i}`);

// ── Que los reconocedores no se desincronicen del generador ─────────────

test("lo que describeBlock escribió en un idioma, localizeDescription lo dice igual que si lo hubiera escrito en el otro", () => {
  // Es la prueba que evita la deriva: si alguien cambia la frase de describeBlock
  // sin tocar el reconocedor, o al revés, esto falla en vez de dejar un panel a
  // medias en producción.
  const casos: [string[], string | null][] = [
    [[], null],                                   // "Desarrollo"
    [[], "feature/informes"],                     // "Desarrollo en informes"
    [["fix: login"], "main"],                     // un solo asunto: tal cual
    [["fix: login", "feat: pagos"], "main"],      // (+1 commit más)
    [["a", "b", "c", "d", "e"], "main"],          // (+4 commits más)
  ];
  for (const [asuntos, rama] of casos) {
    const b = bloque(asuntos, rama);
    for (const [de, a] of [["es", "en"], ["en", "es"]] as const) {
      const guardada = withLang(de, () => describeBlock(b));
      const esperada = withLang(a, () => describeBlock(b));
      const obtenida = withLang(a, () => localizeDescription(
        entrada({ description: guardada, commitHashes: HASHES(asuntos.length) })));
      assert.equal(obtenida, esperada, `${de}→${a} con ${JSON.stringify(asuntos)} / ${rama}`);
    }
  }
});

// ── Lo que NO se toca ───────────────────────────────────────────────────

test("el asunto de un commit no se reescribe aunque se parezca a una plantilla", () => {
  // Un bloque de un solo commit: su descripción ES el asunto, y no hay plantilla.
  for (const asunto of ["Desarrollo en curso", "Desarrollo", "Fix (+3 commits más)", "Development on hold"]) {
    const e = entrada({ description: asunto, commitHashes: HASHES(1) });
    assert.equal(withLang("en", () => localizeDescription(e)), asunto, asunto);
    assert.equal(withLang("es", () => localizeDescription(e)), asunto, asunto);
  }
});

test("una hora anotada a mano solo cambia si es exactamente la etiqueta de su tipo", () => {
  const es = (description: string, kind: TimeEntry["kind"] = "development") =>
    withLang("en", () => localizeDescription(entrada({ source: "manual", kind, description })));

  // Lo que se guarda cuando no se escribe --what: la etiqueta del tipo.
  assert.equal(es("Reunión", "meeting"), "Meeting");
  assert.equal(es("Investigación", "research"), "Research");
  // Texto escrito por la persona: intocable, aunque empiece igual.
  assert.equal(es("Reunión con el equipo de Northwind", "meeting"), "Reunión con el equipo de Northwind");
  assert.equal(es("Desarrollo en curso"), "Desarrollo en curso");
  // La etiqueta de OTRO tipo no cuenta: "Reunión" en un bloque de investigación es texto suyo.
  assert.equal(es("Reunión", "research"), "Reunión");
});

test("un bloque con commits no cae en la plantilla 'Desarrollo en': eso solo pasa sin commits", () => {
  const e = entrada({ description: "Desarrollo en curso del módulo", commitHashes: HASHES(2) });
  assert.equal(withLang("en", () => localizeDescription(e)), "Desarrollo en curso del módulo");
});

// ── Que llega a cada documento ──────────────────────────────────────────

const CLIENT: Client = { id: "nebula", name: "Nebula", currency: "EUR" };
const PROJECT: Project = {
  id: "p", clientId: "nebula", name: "Portal", repoPaths: [], billable: true,
  roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client", closedAt: null,
};
const RATE: RatePeriod = {
  projectId: "p", hourlyRate: money(1300, "EUR"),
  effectiveFrom: new Date("2025-01-01T00:00:00Z"), effectiveTo: null,
};

/** Guardado con la terminal en español, como lo guardaría un usuario español. */
const GUARDADA = entrada({
  description: "feat: pagos (+3 commits más)", commitHashes: HASHES(4),
});
const SIN_COMMITS = entrada({
  id: "e2", description: "Desarrollo en informes", commitHashes: [],
  startedAt: new Date("2026-08-11T09:00:00Z"), endedAt: new Date("2026-08-11T10:00:00Z"),
});

test("un panel en inglés no trae la plantilla en español", () => {
  const html = withLang("en", () => buildPanel({
    project: PROJECT, client: CLIENT, entries: [GUARDADA, SIN_COMMITS],
    generatedAt: new Date("2026-09-20T09:00:00Z"),
  }));
  assert.ok(html.includes("feat: pagos (+3 more commits)"), "cola traducida");
  assert.ok(html.includes("Development on informes"), "rama traducida");
  assert.ok(!html.includes("commits más") && !html.includes("Desarrollo en"));

  const es = withLang("es", () => buildPanel({
    project: PROJECT, client: CLIENT, entries: [GUARDADA, SIN_COMMITS],
    generatedAt: new Date("2026-09-20T09:00:00Z"),
  }));
  assert.ok(es.includes("feat: pagos (+3 commits más)"), "en español queda como estaba");
});

test("el informe, el CSV y las líneas de factura también salen traducidos", () => {
  const informe = withLang("en", () => buildShareReport({
    project: PROJECT, client: CLIENT, entries: [GUARDADA], from: "2026-08-01", to: "2026-08-31",
  }));
  assert.ok(informe.includes("feat: pagos (+3 more commits)"));

  const csv = withLang("en", () => timeEntriesToCsv([GUARDADA], PROJECT, CLIENT, () => null));
  assert.ok(csv.includes("feat: pagos (+3 more commits)"));

  const factura = withLang("en", () => issueInvoice({
    client: CLIENT, project: PROJECT, rates: [RATE], entries: [GUARDADA, SIN_COMMITS],
    cutoffAt: new Date("2026-08-31T23:59:59Z"), number: "F-1",
  }));
  const conceptos = factura.lines.map((l) => l.description);
  assert.ok(conceptos.includes("feat: pagos (+3 more commits)"), conceptos.join(" | "));
  assert.ok(conceptos.includes("Development on informes"), conceptos.join(" | "));
  assert.ok(invoiceToCsv(factura, CLIENT, PROJECT).includes("feat: pagos (+3 more commits)"));
});
