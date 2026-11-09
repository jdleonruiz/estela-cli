import assert from "node:assert/strict";
import { test } from "node:test";

import { closingIssues, GitLabPlanSource, hostOf, type GlabRunner } from "./gitlab.js";

/**
 * La fuente de GitLab con un `glab` falso: nunca se llama al de verdad. El JSON
 * tiene la forma de la API de GitLab (`iid`, `merged_at`, `source_branch`...).
 * Proyecto, issues y MR inventados.
 */

function falso(responder: (args: readonly string[]) => string | Error): { glab: GlabRunner; calls: string[][] } {
  const calls: string[][] = [];
  const glab: GlabRunner = async (args) => {
    calls.push([...args]);
    const r = responder(args);
    if (r instanceof Error) throw r;
    return r;
  };
  return { glab, calls };
}

const mr = (iid: number, branch: string, over: Record<string, unknown> = {}) => ({
  iid, title: `MR ${iid}`, state: "merged", merged_at: "2026-10-15T10:00:00Z", closed_at: null,
  source_branch: branch, labels: [], milestone: null, description: "", web_url: `https://gitlab.acme.test/web/-/merge_requests/${iid}`, ...over,
});
const issue = (iid: number, over: Record<string, unknown> = {}) => ({
  iid, title: `Issue ${iid}`, state: "opened", closed_at: null, labels: [], milestone: null,
  moved_to_id: null, web_url: `https://gitlab.acme.test/web/-/issues/${iid}`, ...over,
});

test("disponibilidad: sin glab, sin sesión, sin proyecto de GitLab, o lista", async () => {
  const enoent = Object.assign(new Error("spawn glab ENOENT"), { code: "ENOENT" });
  assert.deepEqual(await new GitLabPlanSource("/r", falso(() => enoent).glab).availability(),
    { ok: false, reason: "missing", detail: "glab no está instalado" });

  const sinSesion = new GitLabPlanSource("/r", falso((a) =>
    a[0] === "auth" ? Object.assign(new Error("x"), { stderr: "No token found for gitlab.com.\n" }) : "").glab);
  assert.deepEqual(await sinSesion.availability(), { ok: false, reason: "auth", detail: "No token found for gitlab.com." });

  const sinRepo = new GitLabPlanSource("/r", falso((a) => (a[0] === "api" ? new Error("404 Project Not Found") : "")).glab);
  assert.equal(((await sinRepo.availability()) as { reason: string }).reason, "repo");

  assert.deepEqual(await new GitLabPlanSource("/r", falso(() => "{}").glab).availability(), { ok: true });
});

test("GitLab propio sin sesión: dice en qué servidor, con el mensaje de glab limpio", async () => {
  // Así lo escribe glab 1.x: cabecera "ERROR" suelta, con colores, y el texto partido.
  const stderr = "\x1b[31m   ERROR  \x1b[0m\n          \n  unable to expand placeholder in path: none of the git remotes configured for this repository point to a known GitLab\n  host. Please use `glab auth login` to authenticate and configure a new host for glab.\n";
  const glab = falso((a) => (a[0] === "api" ? Object.assign(new Error("exit 1"), { stderr }) : "")).glab;
  const remotes = async () => "origin\thttps://gitlab.acme.test/fabrica/web.git (fetch)\norigin\thttps://gitlab.acme.test/fabrica/web.git (push)\n";
  const a = await new GitLabPlanSource("/r", glab, remotes).availability();
  assert.deepEqual(a, {
    ok: false, reason: "auth", host: "gitlab.acme.test",
    detail: "unable to expand placeholder in path: none of the git remotes configured for this repository point to a known GitLab host. Please use `glab auth login` to authenticate and configure a new host for glab.",
  });

  const sinRemoto = await new GitLabPlanSource("/r", glab, async () => { throw new Error("no git"); }).availability();
  assert.equal((sinRemoto as { host?: string }).host, undefined, "sin remoto no se inventa un servidor");
});

test("hostOf: https, ssh con puerto y la forma corta de git", () => {
  assert.equal(hostOf("https://gitlab.acme.test/fabrica/web.git"), "gitlab.acme.test");
  assert.equal(hostOf("https://usuario@GitLab.Acme.test/fabrica/web.git"), "gitlab.acme.test");
  assert.equal(hostOf("ssh://git@gitlab.acme.test:2222/fabrica/web.git"), "gitlab.acme.test");
  assert.equal(hostOf("git@gitlab.acme.test:fabrica/web.git"), "gitlab.acme.test");
  assert.equal(hostOf("/ruta/local/repo"), null);
});

test("una MR y una issue con el mismo número son dos cosas, y la MR cierra lo que dice su descripción", async () => {
  const { glab } = falso((a) => {
    const url = a[1]!;
    if (url.includes("merge_requests") && url.includes("state=merged")) {
      return JSON.stringify([
        mr(12, "feat/login", { description: "Login con Google.\n\nCloses #12, #14 and grupo/otro#99" }),
        mr(13, "fix/fuera", { merged_at: "2026-11-20T10:00:00Z" }), // fusionada después del periodo
      ]);
    }
    if (url.includes("issues") && url.includes("state=closed")) {
      return JSON.stringify([
        issue(12, { state: "closed", closed_at: "2026-10-15T10:00:00Z" }),
        issue(14, { state: "closed", closed_at: "2026-10-16T10:00:00Z", moved_to_id: 777 }),
      ]);
    }
    return "[]";
  });
  const items = await new GitLabPlanSource("/r", glab).fetch({ from: "2026-10-01", to: "2026-10-31", plan: null });
  const por = new Map(items.map((i) => [i.key, i]));

  assert.deepEqual([...por.keys()].sort(), ["gitlab:!12", "gitlab:12", "gitlab:14"], "la MR 13 se fusionó fuera del periodo");
  const m = por.get("gitlab:!12")!;
  assert.deepEqual([m.kind, m.number, m.state, m.completed, m.branch, m.closes],
    ["pr", 12, "merged", true, "feat/login", ["gitlab:12", "gitlab:14"]]);
  assert.equal(por.get("gitlab:12")!.completed, true, "GitLab no distingue: cerrada cuenta como hecha");
  assert.equal(por.get("gitlab:14")!.completed, false, "movida a otro proyecto no es entregada aquí");
});

test("pagina hasta la última página, y el plan va por etiqueta o milestone", async () => {
  const { glab, calls } = falso((a) => {
    const url = a[1]!;
    if (url.includes("labels=plan") && url.includes("issues")) {
      const page = Number(new URLSearchParams(url.split("?")[1]).get("page"));
      const base = (page - 1) * 100;
      return JSON.stringify(Array.from({ length: page === 1 ? 100 : 3 }, (_, i) => issue(base + i + 1, { labels: ["plan"] })));
    }
    return "[]";
  });
  const items = await new GitLabPlanSource("/r", glab).fetch({ from: "2026-10-01", to: "2026-10-31", plan: { label: "plan" } });
  assert.equal(items.length, 103);
  assert.ok(calls.every((c) => c[0] === "api" && c[1]!.startsWith("projects/:fullpath/")));
  assert.ok(calls.some((c) => c[1]!.includes("issues?labels=plan&per_page=100&page=2")));

  const m = falso(() => "[]");
  await new GitLabPlanSource("/r", m.glab).fetch({ from: "2026-10-01", to: "2026-10-31", plan: { milestone: "Sprint 4" } });
  assert.ok(m.calls.some((c) => c[1]!.includes("merge_requests?milestone=Sprint+4")));
});

test("etiquetas de cliente: se buscan por prefijo y se traen también las MR abiertas", async () => {
  const { glab, calls } = falso((a) => {
    const url = a[1]!;
    if (url.startsWith("projects/:fullpath/labels")) return JSON.stringify([{ name: "Cliente:Acme" }, { name: "bug" }]);
    if (url.includes("labels=Cliente%3AAcme") && url.includes("issues")) return JSON.stringify([issue(30, { labels: ["Cliente:Acme"] })]);
    if (url.includes("state=opened")) return JSON.stringify([mr(31, "feat/informe", { state: "opened", merged_at: null, description: "Fixes #30" })]);
    return "[]";
  });
  const items = await new GitLabPlanSource("/r", glab).fetch({ from: "2026-10-01", to: "2026-10-31", plan: null, clientLabelPrefix: "cliente:" });
  assert.deepEqual(items.map((i) => i.key).sort(), ["gitlab:!31", "gitlab:30"]);
  assert.ok(!calls.some((c) => c[1]!.includes("labels=bug")));
  assert.deepEqual(items.find((i) => i.kind === "pr")!.closes, ["gitlab:30"]);
});

test("palabras de cierre: las de GitLab, y nada más", () => {
  assert.deepEqual(closingIssues("Fixes #1"), [1]);
  assert.deepEqual(closingIssues("closing issue #2 and #3"), [2, 3]);
  assert.deepEqual(closingIssues("Resolves: #4, #5"), [4, 5]);
  assert.deepEqual(closingIssues("Implemented #6"), [6]);
  assert.deepEqual(closingIssues("Relacionado con #7. Ver #8"), [], "mencionar no es cerrar");
  assert.deepEqual(closingIssues("Closes grupo/otro#9"), [], "otro proyecto");
});
