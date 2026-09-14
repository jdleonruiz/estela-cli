import assert from "node:assert/strict";
import { test } from "node:test";

import type { CommitRecord, TimeEntry } from "@estela/shared";

import { cadence, churn, effortByFeature, featureName, openWork } from "./index.js";

function entry(day: string, hours: number, branch: string | null = "feature/x"): TimeEntry {
  const startedAt = new Date(`${day}T14:00:00Z`);
  return {
    id: `e-${day}-${branch}`, projectId: "p", startedAt,
    endedAt: new Date(startedAt.getTime() + hours * 3600_000),
    seconds: Math.round(hours * 3600), description: "Trabajo",
    billable: true, invoiceId: null, aiCost: { microUsd: 0 },
    agentSeconds: 0, commitHashes: [], agents: [],
    source: "agent", kind: "development", branch,
  };
}

function commit(day: string, branch: string, files: string[], subject = "feat: algo"): CommitRecord {
  return {
    repoPath: "/repo", hash: `${day.replace(/-/g, "")}${branch.length}`.padEnd(40, "0"),
    at: new Date(`${day}T15:00:00Z`), authorEmail: "yo@ejemplo.com", authorName: "Yo",
    branch, subject, linesAdded: 10, linesDeleted: 2, files,
  };
}

// ── Esfuerzo por funcionalidad ─────────────────────────────────────────

test("agrupa las horas por rama, no por día", () => {
  // Un gestor piensa en funcionalidades: "18h en el informe de servicios" es
  // una frase que puede contrastar; "3h el martes" no le dice nada.
  const features = effortByFeature([
    entry("2026-08-10", 3, "feature/informe"),
    entry("2026-08-11", 2, "feature/informe"),
    entry("2026-08-11", 1, "feature/login"),
  ], []);

  assert.equal(features.length, 2);
  assert.equal(features[0]!.branch, "feature/informe", "la de más horas primero");
  assert.equal(features[0]!.seconds, 5 * 3600);
  assert.equal(features[0]!.days, 2);
});

test("el nombre legible quita el prefijo de convención", () => {
  assert.equal(featureName("feature/servicios-socios-cartera"), "servicios socios cartera");
  assert.equal(featureName("fix/SavePreferences"), "SavePreferences");
  assert.equal(featureName("main"), "main");
});

test("adjunta lo entregado en palabras de quien lo hizo", () => {
  const features = effortByFeature(
    [entry("2026-08-10", 3, "feature/informe")],
    [commit("2026-08-10", "feature/informe", ["a.cs"], "feat: filtro de Canarias")]);

  assert.equal(features[0]!.delivered.length, 1);
  assert.equal(features[0]!.delivered[0]!.subject, "feat: filtro de Canarias");
});

test("no inventa funcionalidades con commits pero sin horas", () => {
  // Si apareciera una rama con commits y cero horas, el lector se preguntaría
  // por qué y perdería confianza en el resto de las cifras.
  const features = effortByFeature(
    [entry("2026-08-10", 3, "feature/informe")],
    [commit("2026-08-10", "feature/otra", ["b.cs"])]);

  assert.equal(features.length, 1);
  assert.equal(features[0]!.branch, "feature/informe");
});

test("lo no facturable no cuenta como esfuerzo del proyecto", () => {
  const interno = { ...entry("2026-08-10", 5, "feature/x"), billable: false };
  assert.equal(effortByFeature([interno], []).length, 0);
});

test("marca si la funcionalidad está integrada", () => {
  const merged = new Set(["feature/hecha"]);
  const features = effortByFeature(
    [entry("2026-08-10", 1, "feature/hecha"), entry("2026-08-11", 1, "feature/abierta")],
    [], merged);

  assert.equal(features.find((f) => f.branch === "feature/hecha")!.merged, true);
  assert.equal(features.find((f) => f.branch === "feature/abierta")!.merged, false);
});

test("sin información de integración, no se afirma nada", () => {
  // null no es false: decir "sin integrar" cuando no se sabe sería mentir
  // sobre el estado del proyecto delante del cliente.
  const features = effortByFeature([entry("2026-08-10", 1)], []);
  assert.equal(features[0]!.merged, null);
});

// ── Ritmo ──────────────────────────────────────────────────────────────

test("mide el hueco más largo sin actividad", () => {
  const c = cadence([
    entry("2026-08-01", 2), entry("2026-08-02", 2), entry("2026-08-10", 2),
  ]);

  assert.equal(c.activeDays, 3);
  assert.equal(c.spanDays, 10);
  assert.equal(c.longestGapDays, 7, "del 2 al 10 hay 7 días sin nada");
});

test("la mediana resiste un día atípico", () => {
  // La media se dispara con una jornada de 12h y haría parecer que el ritmo
  // habitual es otro. La mediana dice lo que pasa un día normal.
  const c = cadence([
    entry("2026-08-01", 2), entry("2026-08-02", 2),
    entry("2026-08-03", 2), entry("2026-08-04", 12),
  ]);
  assert.equal(c.medianSecondsPerActiveDay, 2 * 3600);
});

test("sin trabajo, ritmo en cero y sin dividir por cero", () => {
  const c = cadence([]);
  assert.equal(c.activeDays, 0);
  assert.equal(c.spanDays, 0);
  assert.equal(c.medianSecondsPerActiveDay, 0);
});

// ── Reescritura ────────────────────────────────────────────────────────

test("detecta un fichero que se toca una y otra vez", () => {
  const commits = [
    commit("2026-08-10", "f/a", ["Servicio.cs"]),
    commit("2026-08-11", "f/a", ["Servicio.cs"]),
    commit("2026-08-13", "f/a", ["Servicio.cs", "Otro.cs"]),
  ];

  const result = churn(commits, { minTouches: 3 });
  assert.equal(result.length, 1);
  assert.equal(result[0]!.file, "Servicio.cs");
  assert.equal(result[0]!.touches, 3);
});

test("tocar un fichero con meses de diferencia no es reescritura", () => {
  // Enero y agosto es mantenimiento normal. Llamarlo reescritura sería acusar
  // al proyecto de un problema que no tiene.
  const commits = [
    commit("2026-01-10", "f/a", ["Viejo.cs"]),
    commit("2026-05-10", "f/a", ["Viejo.cs"]),
    commit("2026-08-10", "f/a", ["Viejo.cs"]),
  ];
  assert.equal(churn(commits, { withinDays: 14, minTouches: 3 }).length, 0);
});

test("un fichero tocado dos veces no llega al umbral", () => {
  const commits = [
    commit("2026-08-10", "f/a", ["A.cs"]),
    commit("2026-08-11", "f/a", ["A.cs"]),
  ];
  assert.equal(churn(commits, { minTouches: 3 }).length, 0);
});

// ── Trabajo abierto ────────────────────────────────────────────────────

test("lista las ramas sin integrar y su antigüedad", () => {
  const hoy = new Date("2026-08-20T12:00:00Z");
  const result = openWork(
    [commit("2026-08-12", "feature/abierta", ["a.cs"]),
     commit("2026-08-19", "feature/reciente", ["b.cs"]),
     commit("2026-08-01", "feature/hecha", ["c.cs"])],
    new Set(["feature/hecha"]),
    hoy);

  assert.equal(result.length, 2, "la integrada no aparece");
  assert.equal(result[0]!.branch, "feature/abierta", "la más antigua primero");
  assert.equal(result[0]!.ageDays, 8);
  assert.equal(result[1]!.ageDays, 1);
});

test("sin ramas abiertas, lista vacía en vez de error", () => {
  assert.deepEqual(
    openWork([commit("2026-08-01", "main", ["a.cs"])], new Set(["main"])), []);
});

test("el trabajo sin rama se agrupa por su tipo, no como un hueco", () => {
  // "sin rama" delante de un cliente es una pregunta incómoda sin buena
  // respuesta. Una reunión no ocurre en ninguna rama: es una línea legítima.
  const reunion = { ...entry("2026-08-10", 1.5, null), kind: "meeting" as const };
  const viaje = { ...entry("2026-08-11", 2, null), id: "v", kind: "travel" as const };

  const features = effortByFeature([reunion, viaje, entry("2026-08-12", 3)], []);
  const nombres = features.map((f) => f.name);

  assert.ok(nombres.includes("Reunión"));
  assert.ok(nombres.includes("Desplazamiento"));
  assert.ok(!nombres.some((n) => n.includes("sin rama")));
});

test("a un grupo por tipo no se le pregunta si está integrado", () => {
  // "Reunión — en curso" no significa nada y confunde.
  const reunion = { ...entry("2026-08-10", 1, null), kind: "meeting" as const };
  const features = effortByFeature([reunion], [], new Set(["main"]));
  assert.equal(features[0]!.merged, null);
});

test("desarrollo sin rama cae en un grupo general, no en 'otro'", () => {
  const features = effortByFeature([entry("2026-08-10", 1, null)], []);
  assert.equal(features[0]!.name, "Otro");
});
