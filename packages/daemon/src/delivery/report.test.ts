import assert from "node:assert/strict";
import { test } from "node:test";

import type { TimeEntry } from "@estela/shared";

import type { MergeRecord } from "../watchers/git.js";
import { deliveryReport, type DeliveryInput } from "./report.js";
import type { TrackerItem } from "./source.js";

/**
 * Planificado frente a entregado. Issues, PRs y horas inventados. Lo que no
 * puede pasar: llamar entregado a lo que se cerró sin hacer, o contar dos
 * veces la misma hora en un bloque.
 */

const issue = (n: number, over: Partial<TrackerItem> = {}): TrackerItem => ({
  key: `github:${n}`, kind: "issue", number: n, title: `Issue ${n}`, state: "open", completed: false,
  closedAt: null, branch: null, closes: [], labels: [], milestone: null, url: "", ...over,
});
const pr = (n: number, branch: string, over: Partial<TrackerItem> = {}): TrackerItem => ({
  key: `github:${n}`, kind: "pr", number: n, title: `PR ${n}`, state: "merged", completed: true,
  closedAt: new Date("2026-10-15T15:00:00Z"), branch, closes: [], labels: [], milestone: null, url: "", ...over,
});
const cerrada = (day: string): Partial<TrackerItem> =>
  ({ state: "closed", completed: true, closedAt: new Date(`${day}T15:00:00Z`) });

let k = 0;
const horas = (branch: string, usd: number, minutes: number, items: string[] = []): TimeEntry => {
  const startedAt = new Date("2026-10-10T15:00:00Z");
  return {
    id: `e${k++}`, projectId: "p", startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000),
    seconds: minutes * 60, description: "", billable: true, invoiceId: null, aiCost: { microUsd: usd * 1e6 },
    agentSeconds: 0, commitHashes: [], agents: ["claude-code"], source: "agent", kind: "development",
    branch, workItems: items,
  };
};

function input(over: Partial<DeliveryInput>): DeliveryInput {
  return { items: [], plan: { label: "plan" }, from: "2026-10-01", to: "2026-10-31", entries: [], merges: [],
           subscriptions: [], monthTotals: new Map(), ...over };
}
const keys = (b: { lines: readonly { item: TrackerItem }[] }) => b.lines.map((l) => l.item.key).sort();
const PLAN = { labels: ["plan"] };

test("los tres bloques: entregado del plan, pendiente y extra", () => {
  const r = deliveryReport(input({ items: [
    issue(1, { ...PLAN, ...cerrada("2026-10-20") }),         // plan, cerrada como hecha
    issue(2, PLAN),                                          // plan, cerrada por un PR del periodo
    pr(10, "feat/2-login", { closes: ["github:2"] }),
    issue(3, PLAN),                                          // plan, sigue abierta
    issue(4, { ...PLAN, state: "closed", completed: false, closedAt: new Date("2026-10-21T10:00:00Z") }), // cerrada sin hacer
    pr(11, "fix/stock"),                                     // extra
    issue(5, cerrada("2026-10-22")),                         // extra, cerrada a mano
    issue(6, {}), pr(12, "fix/x", { closes: ["github:6"] }), // extra: la issue va con su PR
  ] }));
  assert.deepEqual(keys(r.planned!.delivered), ["github:1", "github:2"]);
  assert.deepEqual(keys(r.planned!.pending), ["github:3", "github:4"], "cerrar sin hacer no es entregar");
  assert.deepEqual(keys(r.unplanned), ["github:11", "github:12", "github:5"]);
  const dos = r.planned!.delivered.lines.find((l) => l.item.number === 2)!;
  assert.deepEqual(dos.deliveredBy.map((p) => p.number), [10]);
});

test("lo del plan cerrado antes del periodo ya no es de este periodo", () => {
  const r = deliveryReport(input({ items: [issue(1, { ...PLAN, ...cerrada("2026-09-20") })] }));
  assert.equal(r.planned!.delivered.lines.length + r.planned!.pending.lines.length, 0);
});

test("por milestone en vez de etiqueta", () => {
  const r = deliveryReport(input({ plan: { milestone: "v2" }, items: [
    issue(1, { milestone: "v2", ...cerrada("2026-10-05") }), issue(2, { labels: ["plan"] }),
  ] }));
  assert.deepEqual(keys(r.planned!.delivered), ["github:1"]);
  assert.deepEqual(keys(r.planned!.pending), []);
});

test("sin plan, todo lo entregado va junto", () => {
  const r = deliveryReport(input({ plan: null, items: [pr(10, "a"), issue(1, cerrada("2026-10-02"))] }));
  assert.equal(r.planned, null);
  assert.deepEqual(keys(r.unplanned), ["github:1", "github:10"]);
});

test("coste: la rama del PR (también si fue squash), su número y los PRs que cierran la issue", () => {
  const entries = [
    horas("feat/login", 5, 60),                     // rama del PR 10: squash, sin merge en git
    horas("main", 2, 30, ["github:2"]),             // "#2" en un commit
    horas("spike/otra", 7, 45),                     // no se une a nada
  ];
  const r = deliveryReport(input({ entries, items: [issue(2, PLAN), pr(10, "feat/login", { closes: ["github:2"] })] }));
  const l = r.planned!.delivered.lines[0]!;
  assert.equal(l.consumption.microUsd, 7_000_000);
  assert.equal(l.seconds, 90 * 60);
  assert.deepEqual([...l.basis].sort(), ["branch", "item"]);
});

test("el PR de un merge en git también une la rama con su número", () => {
  const merges: MergeRecord[] = [{ repoPath: "/r", hash: "m", at: new Date("2026-10-15T00:00:00Z"),
    sourceBranch: "feat/sin-numero", ref: "github:20", subject: "" }];
  const r = deliveryReport(input({ plan: null, merges, entries: [horas("feat/sin-numero", 3, 20)],
    items: [pr(20, "otra-rama")] }));
  assert.equal(r.unplanned.lines[0]!.consumption.microUsd, 3_000_000);
});

test("una hora unida a dos líneas cuenta una vez en el total del bloque", () => {
  const compartida = horas("feat/doble", 4, 60, ["github:1", "github:2"]);
  const r = deliveryReport(input({ entries: [compartida], items: [
    issue(1, { ...PLAN, ...cerrada("2026-10-03") }), issue(2, { ...PLAN, ...cerrada("2026-10-04") }),
  ] }));
  assert.equal(r.planned!.delivered.lines[0]!.consumption.microUsd, 4_000_000);
  assert.equal(r.planned!.delivered.lines[1]!.consumption.microUsd, 4_000_000);
  assert.equal(r.planned!.delivered.consumption.microUsd, 4_000_000);
  assert.equal(r.planned!.delivered.seconds, 3600);
});
