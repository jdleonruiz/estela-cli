import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { localDate } from "@estela/shared";

import type { Availability, FetchQuery, PlanSource, TrackerItem } from "./source.js";

/**
 * GitLab, a través de la CLI `glab` que ya tienes instalada y con sesión.
 *
 * Como con GitHub: sin token propio, y en la carpeta del repo, así que `glab`
 * deduce el proyecto y el servidor (también uno autoalojado) por el remoto.
 * Se usa `glab api` y no `glab mr list`: la API devuelve siempre el mismo JSON
 * y la paginación queda en manos de Estela.
 *
 * Dos diferencias con GitHub que se notan en las cifras:
 *  - Las issues (`#12`) y las merge requests (`!12`) se numeran aparte, así
 *    que una MR es `gitlab:!12` y una issue `gitlab:12`.
 *  - GitLab no dice si una issue se cerró hecha o sin hacer. Cerrada cuenta
 *    como entregada, salvo que se moviera a otro proyecto.
 *  - Qué issues cierra una MR se lee de su descripción ("Closes #12"), con las
 *    mismas palabras con las que GitLab las cierra. No se pregunta MR a MR.
 */

/** Ejecuta `glab` con esos argumentos en esa carpeta y devuelve su salida. Inyectable en los tests. */
export type GlabRunner = (args: readonly string[], cwd: string) => Promise<string>;

const run = promisify(execFile);

export const runGlab: GlabRunner = async (args, cwd) => {
  const { stdout } = await run("glab", [...args], { cwd, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
};

/** Las URL de los remotos de git de esa carpeta, una por línea. Inyectable en los tests. */
export type RemotesReader = (cwd: string) => Promise<string>;

const readRemotes: RemotesReader = async (cwd) => {
  const { stdout } = await run("git", ["remote", "-v"], { cwd, timeout: 10_000 });
  return stdout;
};

const PER_PAGE = 100;
/** Tope de páginas por lista: 10.000 elementos. Más es otro tipo de proyecto. */
const MAX_PAGES = 100;

export class GitLabPlanSource implements PlanSource {
  readonly system = "gitlab" as const;

  constructor(
    private readonly cwd: string,
    private readonly glab: GlabRunner = runGlab,
    private readonly remotes: RemotesReader = readRemotes,
  ) {}

  async availability(): Promise<Availability> {
    try {
      await this.glab(["--version"], this.cwd);
    } catch (error) {
      return { ok: false, reason: "missing", detail: errorText(error) };
    }
    try {
      await this.glab(["auth", "status"], this.cwd);
    } catch (error) {
      return { ok: false, reason: "auth", detail: errorText(error) };
    }
    try {
      await this.glab(["api", "projects/:fullpath"], this.cwd);
    } catch (error) {
      const detail = errorText(error);
      // Con sesión en gitlab.com y el repo en un GitLab propio, glab no conoce
      // el servidor del remoto. Eso es falta de sesión en ESE servidor, y se
      // dice cuál para que el comando que se propone funcione tal cual.
      if (/known GitLab\s+host/i.test(detail)) {
        const host = await this.remoteHost();
        return { ok: false, reason: "auth", detail, ...(host ? { host } : {}) };
      }
      return { ok: false, reason: "repo", detail };
    }
    return { ok: true };
  }

  /** El servidor del primer remoto que no es GitHub, o null si no se sabe. */
  private async remoteHost(): Promise<string | null> {
    let out: string;
    try { out = await this.remotes(this.cwd); } catch { return null; }
    for (const line of out.split("\n")) {
      const host = hostOf(line.split(/\s+/)[1] ?? "");
      if (host && host !== "github.com") return host;
    }
    return null;
  }

  async fetch(query: FetchQuery): Promise<TrackerItem[]> {
    // GitLab no filtra por fecha de merge o de cierre: se piden las tocadas
    // desde el día antes (cerrar o fusionar también es tocar) y se filtra aquí.
    const since = new Date(new Date(`${query.from}T00:00:00Z`).getTime() - 86_400_000).toISOString();
    const inPeriod = (i: TrackerItem) => !!i.closedAt && localDate(i.closedAt) >= query.from && localDate(i.closedAt) <= query.to;

    const lists: Promise<TrackerItem[]>[] = [
      this.list("merge_requests", { state: "merged", updated_after: since }).then((l) => l.filter(inPeriod)),
      this.list("issues", { state: "closed", updated_after: since }).then((l) => l.filter(inPeriod)),
    ];
    const plan = query.plan;
    if (plan?.label) {
      lists.push(this.list("issues", { labels: plan.label }));
      lists.push(this.list("merge_requests", { labels: plan.label }));
    } else if (plan?.milestone) {
      lists.push(this.list("issues", { milestone: plan.milestone }));
      lists.push(this.list("merge_requests", { milestone: plan.milestone }));
    }

    const prefix = query.clientLabelPrefix?.toLowerCase();
    if (prefix) {
      // Las MR en curso: una sin etiqueta que cierra la issue de un cliente
      // también es trabajo para ese cliente.
      lists.push(this.list("merge_requests", { state: "opened" }));
      // GitLab no busca etiquetas por prefijo: primero cuáles existen.
      const labels = (await this.pages<{ name: string }>("labels", {}))
        .map((l) => l.name).filter((n) => n.toLowerCase().startsWith(prefix));
      for (const label of labels) {
        lists.push(this.list("issues", { labels: label }));
        lists.push(this.list("merge_requests", { labels: label }));
      }
    }

    // Una issue o una MR puede salir en dos listas: se queda una vez.
    const items = new Map<string, TrackerItem>();
    for (const list of await Promise.all(lists)) for (const item of list) items.set(`${item.kind}:${item.key}`, item);
    return [...items.values()];
  }

  private async list(kind: "issues" | "merge_requests", params: Record<string, string>): Promise<TrackerItem[]> {
    const rows = await this.pages<GlabItem>(kind, params);
    return rows.map((r) => (kind === "issues" ? normalizeIssue(r) : normalizeMr(r)));
  }

  /** Todas las páginas de `projects/:fullpath/<path>`. */
  private async pages<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const qs = new URLSearchParams({ ...params, per_page: String(PER_PAGE), page: String(page) });
      const rows = JSON.parse((await this.glab(["api", `projects/:fullpath/${path}?${qs}`], this.cwd)) || "[]") as T[];
      out.push(...rows);
      if (rows.length < PER_PAGE) break;
    }
    return out;
  }
}

interface GlabItem {
  iid: number;
  title: string;
  state: string;
  closed_at?: string | null;
  merged_at?: string | null;
  source_branch?: string;
  labels?: (string | { name: string })[];
  milestone?: { title: string } | null;
  description?: string | null;
  moved_to_id?: number | null;
  web_url: string;
}

const date = (s: string | null | undefined) => (s ? new Date(s) : null);
const labelsOf = (raw: GlabItem) => (raw.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));

function normalizeMr(raw: GlabItem): TrackerItem {
  const merged = raw.state === "merged" || !!raw.merged_at;
  return {
    key: `gitlab:!${raw.iid}`, kind: "pr", number: raw.iid, title: raw.title,
    state: merged ? "merged" : raw.state === "opened" ? "open" : "closed",
    completed: merged, closedAt: date(raw.merged_at) ?? date(raw.closed_at),
    branch: raw.source_branch || null,
    closes: closingIssues(raw.description ?? "").map((n) => `gitlab:${n}`),
    labels: labelsOf(raw), milestone: raw.milestone?.title ?? null, url: raw.web_url,
  };
}

function normalizeIssue(raw: GlabItem): TrackerItem {
  const closed = raw.state === "closed";
  return {
    key: `gitlab:${raw.iid}`, kind: "issue", number: raw.iid, title: raw.title,
    state: closed ? "closed" : "open",
    // GitLab no distingue hecha de "no se hará". Movida a otro proyecto, no es de aquí.
    completed: closed && !raw.moved_to_id,
    closedAt: date(raw.closed_at), branch: null, closes: [],
    labels: labelsOf(raw), milestone: raw.milestone?.title ?? null, url: raw.web_url,
  };
}

/**
 * Las issues de este proyecto que cierra una descripción, con el patrón por
 * defecto de GitLab: "Closes #12", "Fixes #12, #13", "Resolves issue #12 and #14",
 * "Implements #12". Las de otro proyecto (`grupo/otro#12`) no.
 */
export function closingIssues(description: string): number[] {
  const out = new Set<number>();
  const verbs = /\b(?:clos(?:e[sd]?|ing)|fix(?:e[sd]|ing)?|resolv(?:e[sd]?|ing)|implement(?:s|ed|ing)?):?((?:\s*,?\s*(?:and\s+)?(?:issues?\s+)?#\d+\b)+)/gi;
  for (const m of description.matchAll(verbs)) {
    for (const n of m[1]!.matchAll(/(?<![\w/])#(\d+)/g)) out.add(Number(n[1]));
  }
  return [...out];
}

/** `https://host/grupo/repo.git`, `ssh://git@host:2222/...` o `git@host:grupo/repo.git` → host. */
export function hostOf(url: string): string | null {
  const m = /^[a-z+]+:\/\/(?:[^@/]+@)?([^:/]+)/i.exec(url) ?? /^[^@/\s]+@([^:/]+):/.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Lo que dijo glab, en una línea. glab escribe una cabecera "ERROR" suelta, con
 * colores, y parte el mensaje en varias líneas: quedarse con la primera dejaba
 * un "(ERROR  )" que no dice nada.
 */
export function errorText(error: unknown): string {
  const e = error as { code?: string; stderr?: string; message?: string };
  if (e.code === "ENOENT") return "glab no está instalado";
  const text = (e.stderr || e.message || String(error)).replace(/\x1b\[[0-9;]*m/g, "");
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !/^error:?$/i.test(l)).join(" ")
    .replace(/\s+/g, " ").trim();
}
