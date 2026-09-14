import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

import type { WorkKind } from "@estela/shared";
import { billableAmount, localDate, roundSeconds, WORK_KIND_LABELS } from "@estela/shared";

import { amortize, shareForProject } from "./billing/amortize.js";
import { rateAt } from "./billing/invoice.js";
import { attachCommits, describeBlock, groupByBranchAndDay, sessionize,
         sessionizeCommits, withoutOverlap } from "./billing/sessionize.js";
import { DEFAULT_DB_PATH, openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { buildShareReport } from "./export/share.js";
import { openWork } from "./metrics/index.js";
import { NoAccountError, publishPanel } from "./publish.js";
import { syncProject } from "./sync.js";
import { syncTeamProject } from "./sync/team.js";
import { openBillingPortal, upgradeCheckout } from "./billing.js";
import { cloudGet, cloudPost } from "./cloud/client.js";
import { teamView } from "./metrics/team.js";
import { resolveScratchpads, scanClaudeCode } from "./watchers/claude.js";
import { gitUserEmail, mergedBranches, readCommits, repoAuthors, repoRoot } from "./watchers/git.js";
import { myEmailsByRepo, onlyMine } from "./watchers/identity.js";

/**
 * Servidor local del dashboard.
 *
 * Escucha solo en 127.0.0.1. No es un servicio: es tu propia máquina
 * enseñándote tus propios datos, y nada de esto debe ser alcanzable desde fuera.
 */

/**
 * Dónde están los ficheros del panel.
 *
 * Cambia de sitio según cómo se ejecute esto. En el monorepo son
 * `packages/web`, dos niveles por encima de `packages/daemon/dist`. Instalado
 * desde npm no hay monorepo: la carpeta viaja dentro del propio paquete.
 *
 * Se prueban las dos y se comprueba que exista el `index.html`, en vez de
 * confiar en una ruta relativa. Sin esto, `estela web` instalado desde npm
 * servía 404 a todo sin decir por qué.
 */
const WEB_ROOT = resolveWebRoot();

function resolveWebRoot(): string {
  const candidates = [
    join(__dirname, "..", "web"),          // publicado: estela/web
    join(__dirname, "..", "..", "web"),    // monorepo: packages/web
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, "index.html"))) return dir;
  }
  return candidates[candidates.length - 1]!;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

export interface ServerOptions {
  readonly port?: number;
  readonly dbPath?: string;
  /** Cada cuánto reimportar. 0 lo desactiva. */
  readonly autoImportMinutes?: number;
}

/**
 * Una pasada de importación. Devuelve cuántos bloques quedaron imputados.
 *
 * Es la misma lógica que `estela import`, extraída para que el panel pueda
 * mantenerse al día solo.
 */
async function importOnce(dbPath: string): Promise<number> {
  const db = openDatabase(dbPath);
  try {
    const scan = await scanClaudeCode({});
    const turns = resolveScratchpads(scan.turns);
    store.saveTurns(db, turns);
    store.logScan(db, "claude-code", scan.report);

    const repos = new Set<string>();
    for (const turn of turns) if (turn.repoPath) repos.add(turn.repoPath);
    // Todos los autores, para la vista de equipo. Filtrar es cosa de más abajo.
    for (const repo of repos) {
      const root = await repoRoot(repo);
      if (!root) continue;
      store.saveCommits(db, await readCommits(root, {}));
    }
    const mine = await myEmailsByRepo(db, repos);

    const allRepoCommits = (db.prepare("SELECT * FROM commits").all() as Record<string, unknown>[])
      .map((r) => ({
        repoPath: r["repo_path"] as string, hash: r["hash"] as string,
        at: new Date(r["at"] as string), authorEmail: r["author_email"] as string,
        authorName: (r["author_name"] as string) ?? "",
        branch: (r["branch"] as string | null) ?? null, subject: r["subject"] as string,
        linesAdded: r["lines_added"] as number, linesDeleted: r["lines_deleted"] as number,
        files: String(r["files"] ?? "").split("\n").filter(Boolean),
      }));

    let imputed = 0;
    // Solo tus commits producen horas tuyas.
    const commits = onlyMine(allRepoCommits, mine);
    const fromAgents = attachCommits(sessionize(turns), commits);
    const fromCommits = withoutOverlap(sessionizeCommits(commits), fromAgents);

    // Se agrupa por PROYECTO, no por ruta: el agente abierto en `repo/` y en
    // `repo/src/UI` son dos rutas del mismo proyecto, y agrupar por ruta
    // producía dos bloques que luego se pisaban al guardarse con el mismo id.
    const porProyecto = (b: { repoPath: string | null }) =>
      (b.repoPath ? store.projectForRepo(db, b.repoPath) ?? b.repoPath : "");

    for (const block of groupByBranchAndDay([...fromAgents, ...fromCommits], porProyecto)) {
      const projectId = block.repoPath ? store.projectForRepo(db, block.repoPath) : null;
      if (!projectId) continue;
      const project = store.getProject(db, projectId)!;

      const day = localDate(block.startedAt);
      const slug = (block.branch ?? "sin-rama").replace(/[^a-zA-Z0-9]+/g, "-");
      store.saveTimeEntry(db, {
        id: `te_${projectId}_${day}_${slug}`,
        projectId,
        startedAt: block.startedAt, endedAt: block.endedAt, seconds: block.seconds,
        description: describeBlock(block),
        billable: project.billable, invoiceId: null,
        aiCost: block.aiCost,
        // Sin agente no hay segundos de agente que atribuir.
        agentSeconds: block.turnCount > 0 ? block.seconds : 0,
        commitHashes: block.commits.map((c) => c.hash),
        agents: block.turnCount > 0 ? ["claude-code"] : [],
        source: block.turnCount > 0 ? "agent" : "commit", kind: "development",
        branch: block.branch,
      });
      imputed++;
    }
    return imputed;
  } finally {
    db.close();
  }
}

export interface ImportStatus {
  readonly at: string;
  readonly ok: boolean;
  readonly blocks: number;
  readonly error: string | null;
  /** Había otro import en curso: el número de bloques aún no es el definitivo. */
  readonly pending?: boolean;
}

/**
 * Resultado del último import.
 *
 * Existe porque un fallo aquí era invisible: el aviso iba al stdout del
 * servidor, que nadie mira, y la web seguía enseñando datos viejos sin decir
 * que llevaba horas sin poder actualizarse. Un error silencioso en una
 * herramienta de tiempo es peor que un error ruidoso: te hace confiar en un
 * número que ya no es cierto.
 */
let lastImport: ImportStatus | null = null;
let importing = false;

export function getImportStatus(): ImportStatus | null {
  return lastImport;
}

/** Una pasada, sin solaparse con otra en curso. Devuelve el resultado. */
async function runImport(dbPath: string): Promise<ImportStatus> {
  // Ya hay uno en marcha (el del arranque, o el periódico). Devolver el
  // último resultado con blocks: 0 hacía que quien acababa de vincular un
  // repositorio leyera "0 bloques" y creyera que no había servido de nada,
  // cuando el import en curso sí lo estaba imputando. `pending` lo dice.
  if (importing) {
    return lastImport ?? { at: new Date().toISOString(), ok: true, blocks: 0, error: null, pending: true };
  }
  importing = true;
  try {
    const blocks = await importOnce(dbPath);
    if (blocks > 0) console.log(`  · ${blocks} bloques actualizados`);
    lastImport = { at: new Date().toISOString(), ok: true, blocks, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("  ⚠ no se pudo importar:", message);
    lastImport = { at: new Date().toISOString(), ok: false, blocks: 0, error: message };
  } finally {
    importing = false;
  }
  return lastImport;
}

/**
 * Importa periódicamente mientras el panel está abierto.
 *
 * Sin esto, abrir el panel y no ver el trabajo de hoy es lo normal, porque el
 * import era manual. Nadie se acuerda de ejecutar un comando antes de mirar sus
 * propias horas, y una herramienta de tiempo que enseña datos viejos no sirve.
 *
 * Se ejecuta al arrancar y cada `intervalMinutes`. Un fallo no tumba el
 * servidor: preferimos datos algo atrasados a un panel caído. Pero queda
 * registrado en `lastImport` para que la web pueda decirlo.
 */
function startAutoImport(dbPath: string, intervalMinutes: number): void {
  void runImport(dbPath);
  const timer = setInterval(() => void runImport(dbPath), intervalMinutes * 60_000);
  timer.unref();
}

export function startServer(options: ServerOptions = {}): Promise<string> {
  const port = options.port ?? 4319;
  const dbPath = options.dbPath ?? DEFAULT_DB_PATH;
  const autoMinutes = options.autoImportMinutes ?? 5;
  if (autoMinutes > 0) startAutoImport(dbPath, autoMinutes);

  const server = createServer((req, res) => {
    handle(req, res, dbPath).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { error: message });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(`http://127.0.0.1:${port}`));
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, dbPath: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  // Import bajo demanda: acabas de commitear y quieres verlo ahora, no dentro de
  // cinco minutos. Va antes que api() porque importOnce abre su propia conexión
  // y no hace falta una segunda sobre el mismo fichero.
  if (path === "/api/import" && req.method === "POST") {
    return json(res, 200, await runImport(dbPath));
  }
  if (path === "/api/import-status" && req.method === "GET") {
    return json(res, 200, getImportStatus() ?? { at: null, ok: true, blocks: 0, error: null });
  }

  if (path.startsWith("/api/")) return api(req, res, url, dbPath);
  return serveStatic(res, path);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function api(
  req: IncomingMessage, res: ServerResponse, url: URL, dbPath: string,
): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const path = url.pathname;

    if (path === "/api/overview" && req.method === "GET") {
      return json(res, 200, buildOverview(db,
        url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? ""));
    }

    if (path === "/api/team" && req.method === "GET") {
      return json(res, 200, await buildTeam(db,
        url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "",
        url.searchParams.get("project") || null));
    }

    if (path === "/api/summary" && req.method === "GET") {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      return json(res, 200, buildSummary(db, from, to));
    }

    if (path === "/api/day" && req.method === "GET") {
      const date = url.searchParams.get("date") ?? todayIso();
      return json(res, 200, buildDay(db, date));
    }

    // Los días que tienen bloques sin revisar, para poder ir a ellos desde el
    // resumen. Decir "tienes 7 sin revisar" y no dar forma de llegar hasta
    // ellos obliga a ir día por día a ciegas.
    if (path === "/api/pending-days" && req.method === "GET") {
      const projectId = url.searchParams.get("project");
      const rows = db.prepare(`
        SELECT local_date AS d, COUNT(*) AS n FROM time_entries
        WHERE approved = 0 AND invoice_id IS NULL
          ${projectId ? "AND project_id = ?" : ""}
        GROUP BY local_date ORDER BY local_date DESC
      `).all(...(projectId ? [projectId] : [])) as { d: string; n: number }[];
      return json(res, 200, { days: rows.map((r) => ({ date: r.d, blocks: r.n })) });
    }

    if (path.startsWith("/api/entry/") && req.method === "PATCH") {
      const id = decodeURIComponent(path.slice("/api/entry/".length));
      const patch = await readJson(req);
      applyEntryPatch(db, id, patch);
      return json(res, 200, { ok: true });
    }

    if (path === "/api/projects" && req.method === "GET") {
      return json(res, 200, buildProjects(db));
    }

    if (path === "/api/projects" && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 200, { id: createProject(db, body) });
    }

    /* Con quién está compartido cada panel. El panel local no habla con la
       base de la nube: pregunta a la API con el token de este dispositivo,
       igual que hace para publicar. Sin cuenta vinculada no hay nada que
       listar, y eso no es un error — es que todavía no has publicado. */
    if (path === "/api/panel-clients" && req.method === "GET") {
      const cuenta = store.getCloudAccount(db);
      if (!cuenta) return json(res, 200, { panels: [] });
      try {
        const r = await cloudGet<{ panels: unknown[] }>(cuenta.apiBaseUrl, "/panels",
          { deviceToken: cuenta.deviceToken });
        return json(res, 200, r);
      } catch { return json(res, 200, { panels: [] }); }
    }

    if (path === "/api/panel-clients" && req.method === "POST") {
      const cuenta = store.getCloudAccount(db);
      if (!cuenta) {
        return json(res, 401, {
          error: "Vincula una cuenta para compartir.", needsLogin: true,
        });
      }
      const body = await readJson(req);
      const token = String(body["token"] ?? "");
      const clients = Array.isArray(body["clients"])
        ? (body["clients"] as unknown[]).filter((e): e is string => typeof e === "string")
        : [];
      try {
        await cloudPost(cuenta.apiBaseUrl, `/panels/${token}/clients`,
          { clients }, { deviceToken: cuenta.deviceToken });
        return json(res, 200, { ok: true });
      } catch (error) {
        return json(res, 400, {
          error: error instanceof Error ? error.message : "No se pudo guardar.",
        });
      }
    }

    if (path === "/api/publish" && req.method === "POST") {
      const body = await readJson(req);
      try {
        const result = await publishPanel(db, {
          projectId: String(body["projectId"] ?? ""),
          ...(body["token"] ? { token: String(body["token"]) } : {}),
          ...(body["author"] ? { authorName: String(body["author"]) } : {}),
          withAmounts: body["withAmounts"] === true,
        });
        return json(res, 200, result);
      } catch (error) {
        // "Sin cuenta" no es un fallo del servidor: es el mismo aviso que ya
        // da la CLI, y el panel necesita poder distinguirlo para enseñar
        // "vincula tu cuenta" en vez de un error genérico.
        if (error instanceof NoAccountError) {
          return json(res, 401, { error: error.message, needsLogin: true });
        }
        throw error;
      }
    }

    if (path === "/api/account" && req.method === "GET") {
      const account = store.getCloudAccount(db);
      if (!account) return json(res, 200, { plan: "free", email: null });
      // Se lee en vivo, no el `plan` guardado localmente: ese campo se fija
      // en "free" al hacer login y nunca se refresca solo, así que un alta
      // real por Stripe nunca se notaría aquí si nos fiáramos del caché.
      try {
        const info = await cloudGet<{ plan: string; email: string }>(
          account.apiBaseUrl, "/account", { deviceToken: account.deviceToken });
        return json(res, 200, { plan: info.plan, email: info.email });
      } catch {
        return json(res, 200, { plan: account.plan, email: account.email });
      }
    }

    if (path === "/api/billing/checkout" && req.method === "POST") {
      const body = await readJson(req);
      const plan = String(body["plan"] ?? "");
      if (plan !== "pro" && plan !== "teams") return json(res, 400, { error: "plan debe ser \"pro\" o \"teams\"." });
      const interval = String(body["interval"] ?? "monthly") === "yearly" ? "yearly" : "monthly";
      try {
        return json(res, 200, await upgradeCheckout(db, plan, interval));
      } catch (error) {
        if (error instanceof NoAccountError) {
          return json(res, 401, { error: error.message, needsLogin: true });
        }
        throw error;
      }
    }

    if (path === "/api/billing/portal" && req.method === "POST") {
      try {
        return json(res, 200, await openBillingPortal(db));
      } catch (error) {
        if (error instanceof NoAccountError) {
          return json(res, 401, { error: error.message, needsLogin: true });
        }
        throw error;
      }
    }

    // Sin autenticar y sin lanzar nunca: cualquier fallo de red (sin
    // internet, getestela.dev caído) hace que el banner simplemente no
    // aparezca, nunca un error visible en el panel.
    if (path === "/api/banner" && req.method === "GET") {
      const account = store.getCloudAccount(db);
      const base = (account?.apiBaseUrl ?? "https://getestela.dev").replace(/\/$/, "");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const bannerRes = await fetch(`${base}/public/banner`, { signal: controller.signal });
        if (!bannerRes.ok) return json(res, 200, { enabled: false });
        return json(res, 200, await bannerRes.json());
      } catch {
        return json(res, 200, { enabled: false });
      } finally {
        clearTimeout(timeout);
      }
    }

    if (path === "/api/authors" && req.method === "GET") {
      const repo = url.searchParams.get("repo") ?? "";
      return json(res, 200, { authors: await repoAuthors(repo) });
    }

    if (path === "/api/authors" && req.method === "POST") {
      const body = await readJson(req);
      store.setProjectAuthors(db, String(body["projectId"] ?? ""),
        String(body["emails"] ?? "").split(",").map((e) => e.trim()).filter(Boolean));
      return json(res, 200, { ok: true });
    }

    if (path === "/api/rate" && req.method === "POST") {
      const body = await readJson(req);
      setRate(db, body);
      return json(res, 200, { ok: true });
    }

    /* Vincular un repositorio a un proyecto que ya existe, y sincronizar,
       sin abrir la terminal. Esto SOLO puede hacerlo el panel local: corre en
       tu máquina y ve tu disco. El de getestela.dev no puede ni podrá — un
       navegador no lee rutas del sistema, y no es una limitación que se
       arregle, es cómo funciona un navegador. */
    if (path === "/api/project-repo" && req.method === "POST") {
      const body = await readJson(req);
      const projectId = String(body["projectId"] ?? "");
      const repoPath = String(body["repoPath"] ?? "");
      if (!store.getProject(db, projectId)) {
        return json(res, 404, { error: `No existe el proyecto "${projectId}".` });
      }
      if (!repoPath) return json(res, 400, { error: "Falta la ruta del repositorio." });
      store.addProjectRepo(db, projectId, repoPath);
      // Importar en el acto: vincular sin imputar deja el proyecto igual de
      // vacío que antes, y quien lo hizo se queda pensando que no funcionó.
      const status = await runImport(dbPath);
      return json(res, 200, {
        ok: true,
        blocks: status.pending ? null : status.blocks,
        importing: status.pending === true,
      });
    }

    if (path === "/api/sync" && req.method === "POST") {
      const cuenta = store.getCloudAccount(db);
      if (!cuenta) {
        return json(res, 401, { error: "Vincula una cuenta para sincronizar.", needsLogin: true });
      }
      const ids = store.listProjectSyncs(db).map((x) => x.projectId);
      const hechos: { projectId: string; ok: boolean; detalle: string }[] = [];
      for (const projectId of ids) {
        const scope = store.getProjectSync(db, projectId)?.scope;
        try {
          if (scope === "team") {
            const r = await syncTeamProject(db, projectId);
            hechos.push({ projectId, ok: true, detalle: `${Math.round(r.seconds / 3600)}h enviadas` });
          } else {
            const r = await syncProject(db, projectId);
            hechos.push({ projectId, ok: true, detalle: `${r.pushed} subidas, ${r.pulled} bajadas` });
          }
        } catch (error) {
          hechos.push({
            projectId, ok: false,
            detalle: error instanceof Error ? error.message : "falló",
          });
        }
      }
      return json(res, 200, { projects: hechos });
    }

    if (path === "/api/unassigned" && req.method === "GET") {
      return json(res, 200, { repos: unassignedRepos(db) });
    }

    if (path === "/api/report" && req.method === "GET") {
      const projectId = url.searchParams.get("project") ?? "";
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? todayIso();
      const withAmounts = url.searchParams.get("amounts") === "1";
      return sendReport(db, res, projectId, from, to, withAmounts,
        url.searchParams.get("author") ?? "");
    }

    if (path === "/api/entry" && req.method === "POST") {
      const body = await readJson(req);
      const id = createManualEntry(db, body);
      return json(res, 200, { id });
    }

    if (path === "/api/approve-range" && req.method === "POST") {
      const body = await readJson(req);
      const n = approveRange(db, String(body["from"] ?? ""), String(body["to"] ?? ""));
      return json(res, 200, { approved: n });
    }

    if (path === "/api/approve-day" && req.method === "POST") {
      const { date } = await readJson(req) as { date?: string };
      const n = approveDay(db, date ?? todayIso());
      return json(res, 200, { approved: n });
    }

    return json(res, 404, { error: `Ruta desconocida: ${path}` });
  } finally {
    db.close();
  }
}

type Db = ReturnType<typeof openDatabase>;

/**
 * Datos de la pantalla principal.
 *
 * `from`/`to` acotan lo pendiente al mismo periodo que el resumen. Sin ese
 * acotado, las dos pantallas enseñaban cifras distintas para lo que el lector
 * entiende como lo mismo, y dos números que no cuadran destruyen la confianza
 * en la herramienta aunque los dos sean correctos.
 *
 * Vacío significa "todo lo pendiente, sin importar la fecha".
 */
function buildOverview(db: Db, from = "", to = "") {
  const days = db.prepare(`
    SELECT local_date AS date,
           COUNT(*) AS blocks,
           SUM(seconds) AS seconds,
           SUM(ai_micro_usd) AS micro,
           SUM(approved) AS approved
    FROM time_entries
    GROUP BY date
    ORDER BY date DESC
    LIMIT 30
  `).all() as { date: string; blocks: number; seconds: number; micro: number; approved: number }[];

  const projects = store.listProjects(db).map((p) => {
    const client = store.getClient(db, p.clientId);
    const rate = rateAt(store.getRates(db, p.id), p.id, new Date());
    return {
      id: p.id, name: p.name, billable: p.billable,
      clientName: client?.name ?? "—",
      currency: client?.currency ?? "EUR",
      hourlyMinor: rate?.amount ?? null,
    };
  });

  // Lo pendiente no tiene periodo: es todo lo que aún no se ha informado. Se
  // devuelve su rango real para poder decirlo en pantalla — un total sin fechas
  // al lado de otro que sí las tiene se lee como una contradicción.
  const ranged = from !== "" && to !== "";
  const pending = db.prepare(`
    SELECT project_id, SUM(seconds) AS seconds, SUM(ai_micro_usd) AS micro, COUNT(*) AS blocks,
           MIN(local_date) AS first_day, MAX(local_date) AS last_day
    FROM time_entries
    WHERE billable = 1 AND invoice_id IS NULL
      ${ranged ? "AND local_date >= ? AND local_date <= ?" : ""}
    GROUP BY project_id
  `).all(...(ranged ? [from, to] : [])) as { project_id: string; seconds: number; micro: number; blocks: number;
                first_day: string; last_day: string }[];

  const byProject = new Map(projects.map((p) => [p.id, p]));
  const unbilled = pending.map((row) => {
    const p = byProject.get(row.project_id);
    const amountMinor = p?.hourlyMinor
      ? Math.round((p.hourlyMinor * row.seconds) / 3600)
      : null;
    return {
      projectId: row.project_id,
      projectName: p?.name ?? row.project_id,
      clientName: p?.clientName ?? "—",
      currency: p?.currency ?? "EUR",
      seconds: row.seconds,
      blocks: row.blocks,
      amountMinor,
      aiMicroUsd: row.micro,
      firstDay: row.first_day,
      lastDay: row.last_day,
    };
  }).sort((a, b) => (b.amountMinor ?? 0) - (a.amountMinor ?? 0));

  const scan = db.prepare("SELECT * FROM scan_log ORDER BY id DESC LIMIT 1")
    .get() as Record<string, unknown> | undefined;

  const outside = ranged
    ? (db.prepare(`
        SELECT COALESCE(SUM(seconds),0) AS seconds, COUNT(*) AS blocks
        FROM time_entries
        WHERE billable = 1 AND invoice_id IS NULL
          AND (local_date < ? OR local_date > ?)
      `).get(from, to) as { seconds: number; blocks: number })
    : { seconds: 0, blocks: 0 };

  return {
    range: ranged ? { from, to } : null,
    outsideRange: outside,
    days: days.map((d) => ({
      date: d.date, blocks: d.blocks, seconds: d.seconds,
      aiMicroUsd: d.micro, fullyApproved: d.approved === d.blocks,
    })),
    projects,
    unbilled,
    hasSubscription: store.listSubscriptions(db).length > 0,
    warning: scan && String(scan["warnings"]) ? String(scan["warnings"]) : null,
  };
}

/**
 * Resumen de gestión: todos los proyectos a la vez, en un periodo.
 *
 * Es la vista de quien lleva varios proyectos y necesita ver el conjunto. El
 * detalle diario vive en otra pantalla: son dos preguntas distintas y mezclarlas
 * produce un panel que no sirve para ninguna de las dos.
 */
function buildSummary(db: Db, from: string, to: string) {
  const rows = db.prepare(`
    SELECT project_id,
           SUM(seconds)      AS seconds,
           SUM(ai_micro_usd) AS micro,
           COUNT(*)          AS blocks,
           SUM(approved)     AS approved,
           MIN(local_date)   AS first_day,
           MAX(local_date)   AS last_day,
           COUNT(DISTINCT local_date) AS days
    FROM time_entries
    WHERE local_date >= ? AND local_date <= ?
    GROUP BY project_id
  `).all(from, to) as {
    project_id: string; seconds: number; micro: number; blocks: number;
    approved: number; first_day: string; last_day: string; days: number;
  }[];

  const projects = new Map(store.listProjects(db).map((p) => [p.id, p]));
  const clients = new Map(store.listClients(db).map((c) => [c.id, c]));

  const items = rows.map((r) => {
    const project = projects.get(r.project_id);
    const client = project ? clients.get(project.clientId) : undefined;
    const rate = project ? rateAt(store.getRates(db, r.project_id), r.project_id, new Date()) : null;

    return {
      projectId: r.project_id,
      projectName: project?.name ?? r.project_id,
      clientName: client?.name ?? "—",
      currency: client?.currency ?? "EUR",
      billable: project?.billable ?? false,
      kind: project?.kind ?? "client",
      seconds: r.seconds,
      days: r.days,
      blocks: r.blocks,
      pendingApproval: r.blocks - r.approved,
      lastDay: r.last_day,
      aiMicroUsd: r.micro,
      amountMinor: rate ? Math.round((rate.amount * r.seconds) / 3600) : null,
      hourlyMinor: rate?.amount ?? null,
    };
  }).sort((a, b) => b.seconds - a.seconds);

  // Actividad reciente entre todos los proyectos, para ver el pulso del conjunto.
  // El rango llega en fechas locales, pero `at` está en UTC. Comparar el
  // recorte del UTC deja fuera todo lo que hiciste a partir de las 19:00: un
  // commit de las 23:20 aquí es de las 04:20 del día siguiente en Greenwich.
  const activity = db.prepare(`
    SELECT c.hash, c.subject, c.at, c.repo_path, c.lines_added, c.lines_deleted
    FROM commits c
    WHERE date(c.at, 'localtime') >= ? AND date(c.at, 'localtime') <= ?
    ORDER BY c.at DESC
    LIMIT 12
  `).all(from, to) as {
    hash: string; subject: string; at: string; repo_path: string;
    lines_added: number; lines_deleted: number;
  }[];

  const byDay = db.prepare(`
    SELECT local_date AS date, SUM(seconds) AS seconds
    FROM time_entries
    WHERE local_date >= ? AND local_date <= ?
    GROUP BY local_date ORDER BY local_date
  `).all(from, to) as { date: string; seconds: number }[];

  const totalSeconds = items.reduce((s, i) => s + i.seconds, 0);
  const billableSeconds = items.filter((i) => i.kind === "client")
    .reduce((s, i) => s + i.seconds, 0);

  // Con clientes en varias monedas no hay un total único, y enseñar un guion
  // parece que el panel está roto. Se devuelve un subtotal por moneda: sumar
  // euros con dólares exigiría un tipo de cambio que nadie ha declarado.
  const perCurrency = new Map<string, number>();
  for (const item of items) {
    if (!item.billable || item.amountMinor === null) continue;
    perCurrency.set(item.currency, (perCurrency.get(item.currency) ?? 0) + item.amountMinor);
  }
  const totals = [...perCurrency.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const currency = totals.length === 1 ? totals[0]!.currency : null;

  return {
    from, to,
    projects: items,
    totalSeconds,
    billableSeconds,
    totalAmountMinor: currency ? totals[0]!.amountMinor : null,
    currency,
    totals,
    aiMicroUsd: items.reduce((s, i) => s + i.aiMicroUsd, 0),
    activeProjects: items.filter((i) => i.seconds > 0).length,
    activeDays: byDay.length,
    pendingApproval: items.reduce((s, i) => s + i.pendingApproval, 0),
    byDay,
    activity: activity.map((c) => ({
      hash: c.hash.slice(0, 7),
      subject: c.subject,
      at: c.at,
      repo: c.repo_path.split("/").pop() ?? c.repo_path,
      linesAdded: c.lines_added,
      linesDeleted: c.lines_deleted,
    })),
    unassignedBlocks: (db.prepare(
      "SELECT COUNT(*) AS n FROM agent_turns WHERE repo_path IS NOT NULL"
    ).get() as { n: number }).n,
  };
}

/** Los bloques de un día, listos para revisar y aprobar. */
/**
 * La vista de equipo.
 *
 * Reúne en una sola llamada lo que la pantalla necesita, porque son cifras que
 * solo significan algo juntas: 138h no dice nada sin saber si son más o menos
 * que el mes pasado, ni $137 sin saber cuántas horas costaron.
 *
 * Es la corrección al Resumen actual, donde cada número vive solo en su tarjeta
 * y hay que hacer la cuenta de cabeza.
 */
async function buildTeam(db: Db, from: string, to: string, projectId: string | null) {
  const summary = buildSummary(db, from, to);

  // Periodo anterior de la misma duración, para poder comparar. Sin esto, un
  // número suelto no dice si la cosa va mejor o peor.
  const days = Math.max(1, Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1);
  const prevTo = shiftIso(from, -1);
  const prevFrom = shiftIso(prevTo, -(days - 1));
  const previous = buildSummary(db, prevFrom, prevTo);

  // Composición por procedencia: cuánto de cada proyecto está medido con un
  // agente y cuánto estimado desde commits. Es lo que permite al lector saber
  // de qué fiarse, y ninguna otra cifra de la pantalla lo dice.
  const composition = db.prepare(`
    SELECT project_id, source, SUM(seconds) AS seconds
    FROM time_entries WHERE local_date >= ? AND local_date <= ?
    GROUP BY project_id, source
  `).all(from, to) as { project_id: string; source: string; seconds: number }[];

  const byProject = new Map<string, Record<string, number>>();
  for (const row of composition) {
    const bucket = byProject.get(row.project_id) ?? {};
    bucket[row.source] = row.seconds;
    byProject.set(row.project_id, bucket);
  }

  const budgets = db.prepare(
    "SELECT id, ai_budget_micro_usd AS budget FROM projects WHERE ai_budget_micro_usd IS NOT NULL"
  ).all() as { id: string; budget: number }[];
  const budgetOf = new Map(budgets.map((b) => [b.id, b.budget]));

  const projects = summary.projects
    .filter((p) => !projectId || p.projectId === projectId)
    .map((p) => {
      const parts = byProject.get(p.projectId) ?? {};
      const budget = budgetOf.get(p.projectId) ?? null;
      return {
        ...p,
        composition: {
          agent: parts["agent"] ?? 0,
          commit: parts["commit"] ?? 0,
          manual: parts["manual"] ?? 0,
        },
        budgetMicroUsd: budget,
        budgetPct: budget && budget > 0
          ? Math.round((p.aiMicroUsd / budget) * 100) : null,
      };
    });

  // Personas y riesgo, calculados al vuelo desde los commits. Nada de esto se
  // persiste: las horas de un compañero no son imputaciones tuyas.
  const repoRows = projectId
    ? db.prepare("SELECT repo_path FROM project_repos WHERE project_id = ?").all(projectId)
    : db.prepare("SELECT repo_path FROM project_repos").all();
  const repos = (repoRows as { repo_path: string }[]).map((r) => r.repo_path);

  const commits = repos.length
    ? (db.prepare(`
        SELECT * FROM commits
        WHERE date(at, 'localtime') >= ? AND date(at, 'localtime') <= ?
          AND repo_path IN (${repos.map(() => "?").join(",")})
      `).all(from, to, ...repos) as Record<string, unknown>[]).map(rowToCommit)
    : [];

  const mine = await myEmailsByRepo(db, repos);
  const myEmails = new Set<string>();
  for (const set of mine.values()) for (const email of set) myEmails.add(email);

  const myEntries = store.listEntriesBetween(db, from, to)
    .filter((e) => !projectId || e.projectId === projectId);

  const people = teamView(commits, { myEmails, myEntries });

  // Ramas sin integrar. Riesgo repartido, no culpa de nadie: una rama lleva
  // ocho días abierta tanto si va lenta como si el cliente no la revisa.
  const merged = new Set<string>();
  for (const repo of repos) {
    for (const branch of await mergedBranches(repo)) merged.add(branch);
  }
  const open = openWork(commits, merged);

  // Los totales salen de los proyectos ya filtrados. Tomarlos de `summary`
  // enseñaría las horas de toda tu cartera bajo el nombre de un solo cliente.
  const sum = (rows: readonly { seconds: number; aiMicroUsd: number }[]) =>
    rows.reduce((acc, r) => ({
      seconds: acc.seconds + r.seconds, ai: acc.ai + r.aiMicroUsd,
    }), { seconds: 0, ai: 0 });

  const now = sum(projects);
  const before = sum(previous.projects.filter((p) => !projectId || p.projectId === projectId));

  const totals = projectId
    ? projects.filter((p) => p.billable && p.amountMinor !== null)
        .reduce<{ currency: string; amountMinor: number }[]>((acc, p) => {
          const seen = acc.find((t) => t.currency === p.currency);
          if (seen) seen.amountMinor += p.amountMinor!;
          else acc.push({ currency: p.currency, amountMinor: p.amountMinor! });
          return acc;
        }, [])
    : summary.totals;

  return {
    from, to,
    totalSeconds: now.seconds,
    previousSeconds: before.seconds,
    billableSeconds: projects.filter((p) => p.kind === "client")
      .reduce((acc, p) => acc + p.seconds, 0),
    aiMicroUsd: now.ai,
    previousAiMicroUsd: before.ai,
    totals,
    pendingApproval: projects.reduce((acc, p) => acc + p.pendingApproval, 0),
    activeDays: summary.activeDays,
    byDay: summary.byDay,
    activity: summary.activity,
    projects,
    people,
    openWork: open,
  };
}

/** Suma días a una fecha ISO local sin pasar por husos horarios. */
function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rowToCommit(r: Record<string, unknown>) {
  return {
    repoPath: r["repo_path"] as string, hash: r["hash"] as string,
    at: new Date(r["at"] as string), authorEmail: r["author_email"] as string,
    authorName: (r["author_name"] as string) ?? "",
    branch: (r["branch"] as string | null) ?? null, subject: r["subject"] as string,
    linesAdded: r["lines_added"] as number, linesDeleted: r["lines_deleted"] as number,
    files: String(r["files"] ?? "").split("\n").filter(Boolean),
  };
}

function buildDay(db: Db, date: string) {
  const rows = db.prepare(`
    SELECT * FROM time_entries
    WHERE local_date = ?
    ORDER BY started_at
  `).all(date) as Record<string, unknown>[];

  const projects = new Map(store.listProjects(db).map((p) => [p.id, p]));
  const clients = new Map(store.listClients(db).map((c) => [c.id, c]));

  const entries = rows.map((r) => {
    const projectId = r["project_id"] as string;
    const project = projects.get(projectId);
    const client = project ? clients.get(project.clientId) : undefined;
    const seconds = r["seconds"] as number;
    const startedAt = r["started_at"] as string;

    const rate = project
      ? rateAt(store.getRates(db, projectId), projectId, new Date(startedAt))
      : null;

    const rounded = project ? roundSeconds(seconds, project.roundingMinutes) : seconds;
    const amount = rate ? billableAmount(rounded, rate) : null;

    const hashes = String(r["commit_hashes"] ?? "").split(",").filter(Boolean);
    const commits = hashes.length
      ? db.prepare(
          `SELECT hash, subject FROM commits WHERE hash IN (${hashes.map(() => "?").join(",")})`
        ).all(...hashes) as { hash: string; subject: string }[]
      : [];

    return {
      id: r["id"] as string,
      projectId,
      projectName: project?.name ?? projectId,
      clientName: client?.name ?? null,
      currency: client?.currency ?? "EUR",
      startedAt,
      endedAt: r["ended_at"] as string,
      seconds,
      description: r["description"] as string,
      billable: Boolean(r["billable"]),
      approved: Boolean(r["approved"]),
      invoiced: r["invoice_id"] !== null,
      aiMicroUsd: r["ai_micro_usd"] as number,
      amountMinor: amount?.amount ?? null,
      hourlyMinor: rate?.amount ?? null,
      source: (r["source"] as string) ?? "agent",
      kind: (r["kind"] as string) ?? "development",
      commits: commits.map((c) => ({ hash: c.hash.slice(0, 7), subject: c.subject })),
    };
  });

  const billable = entries.filter((e) => e.billable);
  const totalSeconds = entries.reduce((s, e) => s + e.seconds, 0);

  // Un subtotal por moneda, igual que en el resumen. Sumar euros con dólares
  // exigiría un tipo de cambio que nadie ha declarado, pero con monedas
  // mezcladas el total salía nulo y la pantalla decía "sin tarifa definida"
  // aunque todas las tarifas estuvieran puestas: una explicación falsa es peor
  // que no dar ninguna.
  const perCurrency = new Map<string, number>();
  for (const entry of billable) {
    if (entry.amountMinor === null) continue;
    perCurrency.set(entry.currency, (perCurrency.get(entry.currency) ?? 0) + entry.amountMinor);
  }
  const totals = [...perCurrency.entries()]
    .map(([currency, amountMinor]) => ({ currency, amountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const currency = totals.length === 1 ? totals[0]!.currency : null;
  const totalAmount = currency ? totals[0]!.amountMinor : null;

  // Sin tarifa de verdad: hay trabajo facturable y ni un solo importe.
  const missingRate = billable.length > 0 && totals.length === 0;

  return {
    date,
    entries,
    totalSeconds,
    totalAmountMinor: totalAmount,
    currency,
    totals,
    missingRate,
    aiMicroUsd: entries.reduce((s, e) => s + e.aiMicroUsd, 0),
    pendingApproval: entries.filter((e) => !e.approved && !e.invoiced).length,
    projects: [...projects.values()].map((p) => ({ id: p.id, name: p.name })),
    realAiCost: realAiCostFor(db, date),
  };
}

/**
 * Coste real de IA del día: la parte de tu cuota que le toca.
 *
 * Se calcula sobre el mes completo y se prorratea por el consumo del día, que
 * es lo más honesto que se puede decir de un día suelto: la cuota se paga por
 * meses, no por días.
 */
function realAiCostFor(db: Db, date: string): { minor: number; currency: string } | null {
  const subs = store.listSubscriptions(db);
  if (subs.length === 0) return null;

  const month = date.slice(0, 7);
  const shares = amortize(
    store.consumptionByProjectMonth(db), subs, store.totalConsumptionByMonth(db));

  const monthMicro = store.totalConsumptionByMonth(db).get(month)?.microUsd ?? 0;
  if (monthMicro === 0) return null;

  const dayMicro = (db.prepare(
    "SELECT SUM(cost_micro_usd) AS micro FROM agent_turns WHERE substr(at,1,10) = ?"
  ).get(date) as { micro: number | null }).micro ?? 0;

  const projectIds = store.listProjects(db).map((p) => p.id);
  let monthMinor = 0;
  let currency = "USD";
  for (const id of projectIds) {
    const share = shareForProject(shares, id, [month]);
    if (share) { monthMinor += share.amount; currency = share.currency; }
  }

  return { minor: Math.round(monthMinor * (dayMicro / monthMicro)), currency };
}

function applyEntryPatch(db: Db, id: string, patch: Record<string, unknown>): void {
  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (typeof patch["description"] === "string") {
    sets.push("description = ?"); values.push(patch["description"]);
  }
  if (typeof patch["projectId"] === "string") {
    sets.push("project_id = ?"); values.push(patch["projectId"]);
  }
  if (typeof patch["billable"] === "boolean") {
    sets.push("billable = ?"); values.push(patch["billable"] ? 1 : 0);
  }
  if (typeof patch["approved"] === "boolean") {
    sets.push("approved = ?"); values.push(patch["approved"] ? 1 : 0);
  }
  if (typeof patch["seconds"] === "number" && patch["seconds"] >= 0) {
    sets.push("seconds = ?"); values.push(Math.round(patch["seconds"]));
  }

  if (sets.length === 0) return;

  // Una imputación ya facturada es historia: la factura que la contiene ya
  // salió, y cambiarla la dejaría descuadrada.
  const row = db.prepare("SELECT invoice_id FROM time_entries WHERE id = ?")
    .get(id) as { invoice_id: string | null } | undefined;
  if (!row) throw new Error(`No existe la imputación ${id}`);
  if (row.invoice_id) throw new Error("Esta imputación ya está facturada y no se puede editar.");

  values.push(id);
  db.prepare(`UPDATE time_entries SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

/**
 * Crea una imputación a mano: reuniones, viajes, investigación.
 *
 * Queda marcada como `manual`, así que un reimport nunca la sobrescribe.
 */
function createManualEntry(db: Db, body: Record<string, unknown>): string {
  const projectId = String(body["projectId"] ?? "");
  if (!store.getProject(db, projectId)) throw new Error(`No existe el proyecto "${projectId}"`);

  const minutes = Number(body["minutes"]);
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("Indica cuántos minutos");

  const date = String(body["date"] ?? todayIso());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Fecha inválida: ${date}`);

  const kind = String(body["kind"] ?? "meeting") as WorkKind;
  if (!(kind in WORK_KIND_LABELS)) throw new Error(`Tipo de trabajo desconocido: ${kind}`);

  const seconds = Math.round(minutes * 60);
  const startedAt = new Date(`${date}T10:00:00`);
  const description = String(body["description"] ?? "").trim() || WORK_KIND_LABELS[kind];

  return store.saveTimeEntry(db, {
    projectId, startedAt,
    endedAt: new Date(startedAt.getTime() + seconds * 1000),
    seconds, description,
    billable: body["billable"] !== false,
    invoiceId: null,
    aiCost: { microUsd: 0 },
    agentSeconds: 0,
    commitHashes: [],
    agents: [],
    source: "manual",
    kind,
    branch: null,
  });
}

// ---------------------------------------------------------------------------
// Proyectos y tarifas
// ---------------------------------------------------------------------------

function buildProjects(db: Db) {
  const clients = new Map(store.listClients(db).map((c) => [c.id, c]));

  return {
    clients: [...clients.values()],
    publications: store.listPublications(db).map((pub) => ({
      projectId: pub.projectId,
      token: pub.token,
      publishedAt: pub.publishedAt.toISOString(),
      baseUrl: pub.baseUrl,
      staleBlocks: pub.staleBlocks,
      daysAgo: Math.floor((Date.now() - pub.publishedAt.getTime()) / 86_400_000),
    })),
    projects: store.listProjects(db).map((p) => {
      const client = clients.get(p.clientId);
      const rates = store.getRates(db, p.id);
      const current = rateAt(rates, p.id, new Date());
      const totals = db.prepare(
        "SELECT COUNT(*) AS blocks, SUM(seconds) AS seconds FROM time_entries WHERE project_id = ?"
      ).get(p.id) as { blocks: number; seconds: number | null };

      return {
        id: p.id, name: p.name, billable: p.billable,
        clientId: p.clientId,
        clientName: client?.name ?? "—",
        currency: client?.currency ?? "EUR",
        repoPaths: p.repoPaths,
        hourlyMinor: current?.amount ?? null,
        blocks: totals.blocks,
        seconds: totals.seconds ?? 0,
        // El historial completo: subir la tarifa no reescribe lo ya trabajado,
        // así que conviene poder verlo.
        rateHistory: rates.map((r) => ({
          minor: r.hourlyRate.amount,
          currency: r.hourlyRate.currency,
          from: r.effectiveFrom.toISOString().slice(0, 10),
          to: r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : null,
        })),
      };
    }),
  };
}

/** Repos con actividad capturada que aún no pertenecen a ningún proyecto. */
function unassignedRepos(db: Db) {
  const rows = db.prepare(`
    SELECT repo_path, COUNT(*) AS turns, MAX(at) AS last_at
    FROM agent_turns WHERE repo_path IS NOT NULL
    GROUP BY repo_path ORDER BY turns DESC
  `).all() as { repo_path: string; turns: number; last_at: string }[];

  return rows
    .filter((r) => store.projectForRepo(db, r.repo_path) === null)
    .slice(0, 40)
    .map((r) => ({
      path: r.repo_path,
      name: r.repo_path.split("/").pop() ?? r.repo_path,
      turns: r.turns,
      lastAt: r.last_at.slice(0, 10),
    }));
}

function createProject(db: Db, body: Record<string, unknown>): string {
  const name = String(body["name"] ?? "").trim();
  if (!name) throw new Error("El proyecto necesita un nombre");

  const clientName = String(body["clientName"] ?? "").trim();
  let clientId = String(body["clientId"] ?? "").trim();

  if (!clientId) {
    if (!clientName) throw new Error("Elige un cliente o escribe uno nuevo");
    clientId = slug(clientName);
    store.upsertClient(db, {
      id: clientId, name: clientName,
      currency: (String(body["currency"] ?? "EUR").toUpperCase()) as never,
    });
  }

  const id = String(body["id"] ?? "").trim() || slug(name);
  const repo = String(body["repoPath"] ?? "").trim();
  const kind = (String(body["kind"] ?? "client")) as "client" | "employment" | "internal";

  store.upsertProject(db, {
    id, clientId, name,
    repoPaths: repo ? [repo] : [],
    // Un empleo o un proyecto interno no son facturables por definición: no es
    // una casilla que puedas marcar por error.
    billable: kind === "client" && body["billable"] !== false,
    roundingMinutes: Number(body["roundingMinutes"] ?? 0),
    aiCostPolicy: "absorbed",
    kind,
  });

  const rate = body["hourlyMinor"];
  if (typeof rate === "number" && rate > 0) {
    const client = store.getClient(db, clientId)!;
    store.addRatePeriod(db, {
      projectId: id,
      hourlyRate: { amount: Math.round(rate), currency: client.currency },
      effectiveFrom: new Date(0),
      effectiveTo: null,
    });
  }

  // Reasignar lo ya capturado de ese repositorio, que si no queda huérfano.
  if (repo) reassignOrphans(db, id, repo);

  return id;
}

/**
 * Cambia la tarifa a partir de una fecha.
 *
 * Sin `from`, la nueva tarifa arranca hoy: lo ya trabajado conserva la suya y un
 * informe de agosto reimpreso en diciembre sigue dando lo que dio en agosto.
 */
function setRate(db: Db, body: Record<string, unknown>): void {
  const projectId = String(body["projectId"] ?? "");
  const project = store.getProject(db, projectId);
  if (!project) throw new Error(`No existe el proyecto "${projectId}"`);

  const minor = Number(body["hourlyMinor"]);
  if (!Number.isFinite(minor) || minor <= 0) throw new Error("Tarifa inválida");

  const fromRaw = String(body["from"] ?? "").trim();
  const client = store.getClient(db, project.clientId)!;

  store.addRatePeriod(db, {
    projectId,
    hourlyRate: { amount: Math.round(minor), currency: client.currency },
    effectiveFrom: fromRaw ? new Date(`${fromRaw}T00:00:00`) : new Date(),
    effectiveTo: null,
  });
}

/**
 * Genera el panel publicable de un proyecto.
 *
 * Deja los ficheros en `~/.estela/publicar/e/<token>/` y devuelve el enlace ya
 * montado más el comando para subirlo. No sube nada: enviar datos de un cliente
 * a un servidor es una acción con consecuencias, y la lanza una persona a
 * conciencia, no un botón de una página.
 *
 * El token se reutiliza si el proyecto ya se publicó: el cliente tiene ese
 * enlace guardado y cambiárselo sin avisar le rompe el marcador.
 */
/** Rehace las imputaciones de un repo que acaba de asignarse a un proyecto. */
function reassignOrphans(db: Db, projectId: string, repoPath: string): void {
  const turns = db.prepare(
    "SELECT COUNT(*) AS n FROM agent_turns WHERE repo_path = ? OR repo_path LIKE ?"
  ).get(repoPath, `${repoPath}/%`) as { n: number };
  if (turns.n === 0) return;
  // El import siguiente construye los bloques; aquí solo se deja constancia.
  db.prepare("INSERT INTO scan_log (ran_at, source, files_read, records_seen, turns_accepted, " +
    "duplicates_dropped, unknown_records, malformed_records, producer_versions, warnings) " +
    "VALUES (?,?,0,?,0,0,0,0,'','')")
    .run(new Date().toISOString(), `assign:${projectId}`, turns.n);
}

function slug(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "proyecto";
}

/** Devuelve el informe compartible como descarga. */
function sendReport(
  db: Db, res: ServerResponse, projectId: string,
  from: string, to: string, withAmounts: boolean, author: string,
): void {
  const project = store.getProject(db, projectId);
  if (!project) throw new Error(`No existe el proyecto "${projectId}"`);
  const client = store.getClient(db, project.clientId)!;
  const rates = store.getRates(db, projectId);

  const html = buildShareReport({
    project, client,
    entries: store.getTimeEntries(db, projectId),
    from: from || `${to.slice(0, 8)}01`,
    to,
    ...(author ? { authorName: author } : {}),
    withAmounts,
    rateAt: (at) => rateAt(rates, projectId, at),
    aiPayer: "self",
    commitsOf: (hashes) => hashes.length
      ? db.prepare(
          `SELECT hash, subject FROM commits WHERE hash IN (${hashes.map(() => "?").join(",")})`
        ).all(...hashes) as { hash: string; subject: string }[]
      : [],
  });

  const filename = `informe-${projectId}-${to}.html`;
  const body = Buffer.from(html, "utf8");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": body.length,
  });
  res.end(body);
}

/**
 * Aprueba todo lo pendiente de un periodo.
 *
 * Al configurar un proyecto entra de golpe todo su histórico sin revisar, y
 * repasarlo día a día no lo hace nadie. Lo ya facturado no se toca: esas horas
 * salieron en un documento y cambiarles el estado lo descuadraría.
 */
function approveRange(db: Db, from: string, to: string): number {
  const ranged = from !== "" && to !== "";
  const result = db.prepare(`
    UPDATE time_entries SET approved = 1
    WHERE approved = 0 AND invoice_id IS NULL
      ${ranged ? "AND local_date >= ? AND local_date <= ?" : ""}
  `).run(...(ranged ? [from, to] : []));
  return Number(result.changes);
}

function approveDay(db: Db, date: string): number {
  const result = db.prepare(`
    UPDATE time_entries SET approved = 1
    WHERE local_date = ? AND invoice_id IS NULL
  `).run(date);
  return Number(result.changes);
}

// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error("Cuerpo de petición demasiado grande");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

async function serveStatic(res: ServerResponse, path: string): Promise<void> {
  // normalize() colapsa los ".." antes de comprobar, así que una ruta como
  // /../../etc/passwd no puede escapar de WEB_ROOT.
  const relative = normalize(path === "/" ? "/index.html" : path).replace(/^(\.\.[/\\])+/, "");
  const file = join(WEB_ROOT, relative);

  if (!file.startsWith(WEB_ROOT)) {
    res.writeHead(403).end("Prohibido");
    return;
  }

  try {
    const content = await readFile(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
      "Content-Length": content.length,
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado");
  }
}

if (require.main === module) {
  const port = Number(process.env["ESTELA_PORT"] ?? 4319);
  const dbPath = process.env["ESTELA_DB"] ?? DEFAULT_DB_PATH;

  startServer({ port, dbPath }).then((address) => {
    console.log(`\n  Estela  ${address}`);
    console.log(`  Import automático cada 5 min.`);
    console.log(`  Datos:  ${dbPath}\n`);
    console.log("  Ctrl+C para parar.\n");
  });
}
