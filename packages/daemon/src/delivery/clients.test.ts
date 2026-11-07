import assert from "node:assert/strict";
import { test } from "node:test";

import type { TimeEntry } from "@estela/shared";

import type { MergeRecord } from "../watchers/git.js";
import { clientRequests, type ClientRequestInput, type Requester } from "./clients.js";
import type { TrackerItem } from "./source.js";

/**
 * Peticiones de clientes. Clientes, issues y horas inventados. Lo que no
 * puede pasar: repartir a ojo una hora entre dos clientes, o inventarse a qué
 * cliente de Estela corresponde una etiqueta.
 */

const issue = (n: number, labels: string[] = []): TrackerItem => ({
  key: `github:${n}`, kind: "issue", number: n, title: `Issue ${n}`, state: "open", completed: false,
  closedAt: null, branch: null, closes: [], labels, milestone: null, url: "",
});
const pr = (n: number, branch: string, closes: number[] = [], labels: string[] = []): TrackerItem => ({
  ...issue(n, labels), kind: "pr", state: "open", branch, closes: closes.map((c) => `github:${c}`),
});

let k = 0;
const horas = (branch: string | null, usd: number, minutes: number, items: string[] = []): TimeEntry => {
  const startedAt = new Date("2026-10-10T15:00:00Z");
  return {
    id: `e${k++}`, projectId: "p", startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000),
    seconds: minutes * 60, description: "", billable: true, invoiceId: null, aiCost: { microUsd: usd * 1e6 },
    agentSeconds: 0, commitHashes: [], agents: ["claude-code"], source: "agent", kind: "development",
    branch, workItems: items,
  };
};

// "acme" y "Acme" son el cliente acme; "beta" no se sabe quién es.
const requesterOf = (name: string): Requester => name.toLowerCase() === "acme"
  ? { id: "acme", clientId: "acme", name: "Acme Retail" }
  : { id: `?${name.toLowerCase()}`, clientId: null, name };

function input(over: Partial<ClientRequestInput>): ClientRequestInput {
  return { items: [], entries: [], merges: [], prefix: "cliente:", requesterOf, subscriptions: [],
           monthTotals: new Map(), ...over };
}
const usd = (c: { consumption: { microUsd: number } }) => c.consumption.microUsd / 1e6;

test("cada hora a quien pidió su issue o PR, y lo demás al resto", () => {
  const r = clientRequests(input({
    items: [issue(1, ["cliente:acme"]), pr(10, "feat/login", [1]), issue(2, ["bug"]), issue(3, ["Cliente:Beta"])],
    entries: [horas("feat/login", 5, 60), horas("main", 2, 30, ["github:2"]), horas("spike", 1, 10),
              horas("fix/x", 3, 20, ["github:3"])],
  }));
  assert.deepEqual(r.groups.map((g) => [g.requesters.map((x) => x.id).join("+"), usd(g)]), [["acme", 5], ["?beta", 3]]);
  assert.equal(usd(r.rest), 3);
  assert.equal(usd(r.total), 11);
  assert.deepEqual(r.groups[0]!.items.map((i) => i.number), [1], "el PR hereda la etiqueta de la issue que cierra");
  assert.equal(r.groups[1]!.requesters[0]!.clientId, null, "una etiqueta sin cliente no se adivina");
});

test("una hora que sirve a dos clientes va a un grupo de los dos, sin repartirla", () => {
  const r = clientRequests(input({
    items: [issue(1, ["cliente:acme"]), issue(2, ["cliente:beta"])],
    entries: [horas("feat/comun", 8, 60, ["github:1", "github:2"]), horas("feat/a", 2, 10, ["github:1"])],
  }));
  const varios = r.groups.find((g) => g.requesters.length === 2)!;
  assert.equal(usd(varios), 8);
  assert.deepEqual(varios.requesters.map((x) => x.name), ["Acme Retail", "beta"]);
  assert.equal(usd(r.groups.find((g) => g.requesters.length === 1)!), 2);
  assert.equal(r.groups.reduce((s, g) => s + usd(g), 0) + usd(r.rest), usd(r.total), "los grupos y el resto suman el total");
});

test("el PR de un merge en git une la rama con su número, y su etiqueta cuenta", () => {
  const merges: MergeRecord[] = [{ repoPath: "/r", hash: "m", at: new Date("2026-10-11T00:00:00Z"),
    sourceBranch: "feat/sin-numero", ref: "github:20", subject: "" }];
  const r = clientRequests(input({ merges, items: [pr(20, "otra", [], ["cliente:acme"])],
    entries: [horas("feat/sin-numero", 4, 30)] }));
  assert.equal(usd(r.groups[0]!), 4);
});

test("otro prefijo de etiqueta", () => {
  const r = clientRequests(input({ prefix: "customer/", items: [issue(1, ["customer/acme", "cliente:otro"])],
    entries: [horas(null, 2, 10, ["github:1"])] }));
  assert.deepEqual(r.groups.map((g) => g.requesters.map((x) => x.id)), [["acme"]]);
});
