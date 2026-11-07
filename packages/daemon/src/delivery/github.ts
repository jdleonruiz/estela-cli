import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Availability, FetchQuery, PlanSource, TrackerItem } from "./source.js";

/**
 * GitHub, a través de la CLI `gh` que ya tienes instalada y con sesión.
 *
 * Sin token propio ni llamada directa a la API: `gh` ya sabe quién eres y a
 * qué repos tienes acceso, y quien no lo tenga instalado ve el informe sin
 * esta parte. Se ejecuta en la carpeta del repo, así que `gh` deduce el repo
 * de GitHub por su remoto.
 */

/** Ejecuta `gh` con esos argumentos en esa carpeta y devuelve su salida. Inyectable en los tests. */
export type GhRunner = (args: readonly string[], cwd: string) => Promise<string>;

const run = promisify(execFile);

export const runGh: GhRunner = async (args, cwd) => {
  const { stdout } = await run("gh", [...args], { cwd, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
};

// Los campos que se piden a gh. Cambiarlos cambia lo que se guarda.
const ISSUE_FIELDS = "number,title,state,stateReason,closedAt,labels,milestone,url";
const PR_FIELDS = "number,title,state,mergedAt,closedAt,headRefName,labels,milestone,closingIssuesReferences,url";
const LIMIT = "1000";

export class GitHubPlanSource implements PlanSource {
  readonly system = "github" as const;

  constructor(private readonly cwd: string, private readonly gh: GhRunner = runGh) {}

  async availability(): Promise<Availability> {
    try {
      await this.gh(["--version"], this.cwd);
    } catch (error) {
      return { ok: false, reason: "missing", detail: errorText(error) };
    }
    try {
      await this.gh(["auth", "status"], this.cwd);
    } catch (error) {
      return { ok: false, reason: "auth", detail: errorText(error) };
    }
    try {
      await this.gh(["repo", "view", "--json", "nameWithOwner"], this.cwd);
    } catch (error) {
      return { ok: false, reason: "repo", detail: errorText(error) };
    }
    return { ok: true };
  }

  async fetch(query: FetchQuery): Promise<TrackerItem[]> {
    const lists: Promise<string>[] = [
      this.gh(["pr", "list", "--state", "merged", "--limit", LIMIT, "--search", `merged:${query.from}..${query.to}`,
               "--json", PR_FIELDS], this.cwd),
      this.gh(["issue", "list", "--state", "closed", "--limit", LIMIT, "--search", `closed:${query.from}..${query.to}`,
               "--json", ISSUE_FIELDS], this.cwd),
    ];
    const plan = query.plan;
    if (plan?.label) {
      lists.push(this.gh(["issue", "list", "--state", "all", "--limit", LIMIT, "--label", plan.label,
                          "--json", ISSUE_FIELDS], this.cwd));
      lists.push(this.gh(["pr", "list", "--state", "all", "--limit", LIMIT, "--label", plan.label,
                          "--json", PR_FIELDS], this.cwd));
    } else if (plan?.milestone) {
      lists.push(this.gh(["issue", "list", "--state", "all", "--limit", LIMIT, "--milestone", plan.milestone,
                          "--json", ISSUE_FIELDS], this.cwd));
      lists.push(this.gh(["pr", "list", "--state", "all", "--limit", LIMIT, "--search", `milestone:"${plan.milestone}"`,
                          "--json", PR_FIELDS], this.cwd));
    }

    const prefix = query.clientLabelPrefix?.toLowerCase();
    if (prefix) {
      // Los PR en curso: uno sin etiqueta que cierra la issue de un cliente
      // también es trabajo para ese cliente.
      lists.push(this.gh(["pr", "list", "--state", "open", "--limit", LIMIT, "--json", PR_FIELDS], this.cwd));
      // GitHub no busca etiquetas por prefijo: primero cuáles existen.
      const labels = (JSON.parse(await this.gh(["label", "list", "--limit", LIMIT, "--json", "name"], this.cwd) || "[]") as
        { name: string }[]).map((l) => l.name).filter((n) => n.toLowerCase().startsWith(prefix));
      for (const label of labels) {
        lists.push(this.gh(["issue", "list", "--state", "all", "--limit", LIMIT, "--label", label,
                            "--json", ISSUE_FIELDS], this.cwd));
        lists.push(this.gh(["pr", "list", "--state", "all", "--limit", LIMIT, "--label", label,
                            "--json", PR_FIELDS], this.cwd));
      }
    }

    // Una issue o un PR puede salir en dos listas: se queda una vez.
    const items = new Map<string, TrackerItem>();
    for (const text of await Promise.all(lists)) {
      for (const raw of JSON.parse(text || "[]") as GhItem[]) {
        const item = normalize(raw);
        items.set(`${item.kind}:${item.key}`, item);
      }
    }
    return [...items.values()];
  }
}

interface GhItem {
  number: number;
  title: string;
  state: string;
  stateReason?: string | null;
  closedAt?: string | null;
  mergedAt?: string | null;
  headRefName?: string;
  labels?: { name: string }[];
  milestone?: { title: string } | null;
  closingIssuesReferences?: { number: number }[];
  url: string;
}

/** Un PR trae headRefName; una issue, no. */
function normalize(raw: GhItem): TrackerItem {
  const isPr = raw.headRefName !== undefined;
  const state = raw.state.toUpperCase();
  const date = (s: string | null | undefined) => (s ? new Date(s) : null);
  if (isPr) {
    const merged = state === "MERGED" || !!raw.mergedAt;
    return {
      key: `github:${raw.number}`, kind: "pr", number: raw.number, title: raw.title,
      state: merged ? "merged" : state === "OPEN" ? "open" : "closed",
      completed: merged, closedAt: date(raw.mergedAt) ?? date(raw.closedAt),
      branch: raw.headRefName || null,
      closes: (raw.closingIssuesReferences ?? []).map((i) => `github:${i.number}`),
      labels: (raw.labels ?? []).map((l) => l.name), milestone: raw.milestone?.title ?? null, url: raw.url,
    };
  }
  const closed = state === "CLOSED";
  return {
    key: `github:${raw.number}`, kind: "issue", number: raw.number, title: raw.title,
    state: closed ? "closed" : "open",
    // "NOT_PLANNED" o "DUPLICATE" es cerrar sin hacer. Sin motivo (issues antiguas), se da por hecha.
    completed: closed && (!raw.stateReason || raw.stateReason.toUpperCase() === "COMPLETED"),
    closedAt: date(raw.closedAt), branch: null, closes: [],
    labels: (raw.labels ?? []).map((l) => l.name), milestone: raw.milestone?.title ?? null, url: raw.url,
  };
}

function errorText(error: unknown): string {
  const e = error as { code?: string; stderr?: string; message?: string };
  if (e.code === "ENOENT") return "gh no está instalado";
  return (e.stderr || e.message || String(error)).trim().split("\n")[0] ?? "";
}
