import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client, Project, TimeEntry } from "@estela/shared";

import { clockifyDate, clockifyDuration, clockifyTime, timeEntriesToClockifyCsv } from "./clockify.js";

const PROJECT: Project = {
  id: "web", clientId: "acme", name: "Web, nueva", repoPaths: [], billable: true,
  roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client", closedAt: null,
};
const CLIENT: Client = { id: "acme", name: "ACME", currency: "EUR" } as Client;

// Hora LOCAL (mes 8 = septiembre): Clockify lee la hora que ve quien importa,
// y así el test no depende de la zona horaria de la máquina que lo corre.
function entry(start: Date, seconds: number, extra: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: "te", projectId: "web", startedAt: start, endedAt: new Date(start.getTime() + seconds * 1000),
    seconds, description: "feat: login", billable: true, invoiceId: null,
    aiCost: { microUsd: 0 }, agentSeconds: seconds, commitHashes: [], agents: [],
    source: "agent", kind: "development", branch: "main", ...extra,
  };
}

test("fecha, hora y duración en los formatos que lee Clockify", () => {
  const d = new Date(2026, 8, 3, 14, 5);
  assert.equal(clockifyDate(d, "MM/DD/YYYY"), "09/03/2026");
  assert.equal(clockifyDate(d, "DD/MM/YYYY"), "03/09/2026");
  assert.equal(clockifyDate(d, "YYYY-MM-DD"), "2026-09-03");
  assert.equal(clockifyDate(d, "DD.MM.YYYY"), "03.09.2026");
  assert.equal(clockifyTime(d, "12h"), "2:05 PM");
  assert.equal(clockifyTime(d, "24h"), "14:05");
  assert.equal(clockifyTime(new Date(2026, 8, 3, 0, 30), "12h"), "12:30 AM");
  assert.equal(clockifyTime(new Date(2026, 8, 3, 12, 0), "12h"), "12:00 PM");
  assert.equal(clockifyDuration(5400), "1:30");
  assert.equal(clockifyDuration(29), "0:00");
  assert.equal(clockifyDuration(3599), "1:00");
});

test("el CSV lleva las cabeceras exactas de Clockify, sin BOM, y el ticket en la descripción", () => {
  const csv = timeEntriesToClockifyCsv([
    entry(new Date(2026, 8, 3, 9, 0), 5400, { workItems: ["jira:PROJ-12", "azure:77"] }),
    entry(new Date(2026, 8, 4, 16, 45), 1800, { billable: false }),
    entry(new Date(2026, 8, 5, 10, 0), 20),
  ], PROJECT, CLIENT, { email: "yo@acme.com", dateFormat: "MM/DD/YYYY", timeFormat: "12h" });

  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "Project,Client,Description,Task,Email,Tags,Billable,Start Date,Start Time,Duration (h)");
  assert.ok(!csv.startsWith("﻿"), "sin BOM: se pegaría a la cabecera Project");
  assert.equal(lines[1], '"Web, nueva",ACME,[PROJ-12 AB#77] feat: login,,yo@acme.com,,Yes,09/03/2026,9:00 AM,1:30');
  assert.equal(lines[2], '"Web, nueva",ACME,feat: login,,yo@acme.com,,No,09/04/2026,4:45 PM,0:30');
  assert.equal(lines.length, 3, "un bloque de 20 segundos saldría como 0:00 y Clockify lo rechaza");
});
