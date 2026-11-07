import assert from "node:assert/strict";
import { test } from "node:test";

import { GitHubPlanSource, type GhRunner } from "./github.js";

/**
 * La fuente de GitHub con un `gh` falso: nunca se llama al de verdad. El JSON
 * tiene la forma que documenta `gh issue list --json` y `gh pr list --json`.
 */

function falso(responder: (args: readonly string[]) => string | Error): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    const r = responder(args);
    if (r instanceof Error) throw r;
    return r;
  };
  return { gh, calls };
}

test("disponibilidad: sin gh, sin sesión, sin repo de GitHub, o lista", async () => {
  const enoent = Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
  const sin = new GitHubPlanSource("/r", falso(() => enoent).gh);
  assert.deepEqual(await sin.availability(), { ok: false, reason: "missing", detail: "gh no está instalado" });

  const sinSesion = new GitHubPlanSource("/r", falso((a) =>
    a[0] === "auth" ? Object.assign(new Error("x"), { stderr: "You are not logged into any GitHub hosts.\n" }) : "").gh);
  assert.deepEqual(await sinSesion.availability(),
    { ok: false, reason: "auth", detail: "You are not logged into any GitHub hosts." });

  const sinRepo = new GitHubPlanSource("/r", falso((a) => (a[0] === "repo" ? new Error("no git remotes found") : "")).gh);
  assert.equal(((await sinRepo.availability()) as { reason: string }).reason, "repo");

  assert.deepEqual(await new GitHubPlanSource("/r", falso(() => "ok").gh).availability(), { ok: true });
});

test("fetch: lo entregado del periodo más el plan, normalizado y sin repetir", async () => {
  const { gh, calls } = falso((a) => {
    const json = (rows: unknown[]) => JSON.stringify(rows);
    if (a[0] === "pr" && a.includes("merged")) {
      return json([{ number: 10, title: "Login", state: "MERGED", mergedAt: "2026-10-15T10:00:00Z", closedAt: "2026-10-15T10:00:00Z",
        headRefName: "feat/2-login", labels: [{ name: "plan" }], milestone: null,
        closingIssuesReferences: [{ number: 2 }], url: "https://github.com/acme/web/pull/10" }]);
    }
    if (a[0] === "issue" && a.includes("closed")) {
      return json([
        { number: 2, title: "Login con Google", state: "CLOSED", stateReason: "COMPLETED", closedAt: "2026-10-15T10:00:00Z",
          labels: [{ name: "plan" }], milestone: null, url: "u2" },
        { number: 7, title: "Duplicada", state: "CLOSED", stateReason: "NOT_PLANNED", closedAt: "2026-10-16T10:00:00Z",
          labels: [], milestone: null, url: "u7" },
      ]);
    }
    if (a[0] === "issue") {
      return json([{ number: 2, title: "Login con Google", state: "CLOSED", stateReason: "COMPLETED",
        closedAt: "2026-10-15T10:00:00Z", labels: [{ name: "plan" }], milestone: { title: "v2" }, url: "u2" },
        { number: 3, title: "PDF", state: "OPEN", stateReason: null, closedAt: null, labels: [{ name: "plan" }], milestone: null, url: "u3" }]);
    }
    return "[]";
  });
  const items = await new GitHubPlanSource("/r", gh).fetch({ from: "2026-10-01", to: "2026-10-31", plan: { label: "plan" } });

  assert.ok(calls.some((c) => c.join(" ").includes("pr list --state merged --limit 1000 --search merged:2026-10-01..2026-10-31")));
  assert.ok(calls.some((c) => c.join(" ").includes("issue list --state all --limit 1000 --label plan")));
  const por = new Map(items.map((i) => [`${i.kind}:${i.number}`, i]));
  assert.equal(items.length, 4, "la issue 2 sale en dos listas y se queda una vez");
  const pr10 = por.get("pr:10")!;
  assert.deepEqual([pr10.state, pr10.completed, pr10.branch, pr10.closes], ["merged", true, "feat/2-login", ["github:2"]]);
  assert.equal(por.get("issue:7")!.completed, false, "cerrada como no planificada no es entregada");
  assert.equal(por.get("issue:3")!.state, "open");
});

test("fetch por milestone busca issues y PRs de ese milestone", async () => {
  const { gh, calls } = falso(() => "[]");
  await new GitHubPlanSource("/r", gh).fetch({ from: "2026-10-01", to: "2026-10-31", plan: { milestone: "Sprint 4" } });
  assert.ok(calls.some((c) => c.includes("--milestone") && c.includes("Sprint 4")));
  assert.ok(calls.some((c) => c.includes('milestone:"Sprint 4"')));
});
