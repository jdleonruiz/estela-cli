import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import type {
  AgentTurn, AiConsentDecision, AiConsentRecord, Client, CloudAccount, CommitRecord, Currency,
  Invoice, InvoiceLine, ParseReport, Project, ProjectSync, RatePeriod, Subscription, TimeEntry,
} from "@estela/shared";
import type { ConsumptionRow } from "../billing/amortize.js";
import { localDate } from "@estela/shared";
import { costOfTurn } from "../pricing/cost.js";

const iso = (d: Date) => d.toISOString();

// ---------------------------------------------------------------------------
// Clientes y proyectos
// ---------------------------------------------------------------------------

export function upsertClient(db: DatabaseSync, client: Client): void {
  db.prepare(`
    INSERT INTO clients (id, name, currency, tax_id, email, address)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, currency = excluded.currency,
      tax_id = excluded.tax_id, email = excluded.email, address = excluded.address
  `).run(client.id, client.name, client.currency,
         client.taxId ?? null, client.email ?? null, client.address ?? null);
}

// closedAt no entra aquí a propósito: cerrar y reabrir son closeProject() y
// reopenProject(), no un campo más que "estela project add" pueda pisar sin
// querer si alguien vuelve a ejecutarlo sobre un proyecto ya cerrado.
export function upsertProject(db: DatabaseSync, project: Omit<Project, "closedAt">): void {
  db.prepare(`
    INSERT INTO projects (id, client_id, name, billable, rounding_minutes, ai_cost_policy, kind)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      client_id = excluded.client_id, name = excluded.name,
      billable = excluded.billable, rounding_minutes = excluded.rounding_minutes,
      ai_cost_policy = excluded.ai_cost_policy, kind = excluded.kind
  `).run(project.id, project.clientId, project.name,
         project.billable ? 1 : 0, project.roundingMinutes, project.aiCostPolicy,
         project.kind);

  const link = db.prepare(
    "INSERT OR IGNORE INTO project_repos (project_id, repo_path) VALUES (?, ?)");
  for (const repo of project.repoPaths) link.run(project.id, repo);
}

/**
 * Añade un repositorio a un proyecto que ya existe, sin tocar nada más.
 *
 * `estela team accept` crea el proyecto con `kind:'employment'` y
 * `billable:false`; volver a llamar a `upsertProject` (vía `estela project
 * add`) solo para enlazar el repositorio resetearía esos dos campos a sus
 * valores por defecto si no se repiten los flags a mano. Esta función solo
 * toca `project_repos`.
 */
export function addProjectRepo(db: DatabaseSync, projectId: string, repoPath: string): void {
  db.prepare("INSERT OR IGNORE INTO project_repos (project_id, repo_path) VALUES (?, ?)")
    .run(projectId, repoPath);
}

export function addRatePeriod(db: DatabaseSync, rate: RatePeriod): void {
  // Cerrar la tarifa abierta anterior en la fecha en que empieza la nueva.
  db.prepare(`
    UPDATE rate_periods SET effective_to = ?
    WHERE project_id = ? AND effective_to IS NULL AND effective_from < ?
  `).run(iso(rate.effectiveFrom), rate.projectId, iso(rate.effectiveFrom));

  db.prepare(`
    INSERT INTO rate_periods (project_id, hourly_minor, currency, effective_from, effective_to)
    VALUES (?, ?, ?, ?, ?)
  `).run(rate.projectId, rate.hourlyRate.amount, rate.hourlyRate.currency,
         iso(rate.effectiveFrom), rate.effectiveTo ? iso(rate.effectiveTo) : null);
}

export function getClient(db: DatabaseSync, id: string): Client | null {
  const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row["id"] as string,
    name: row["name"] as string,
    currency: row["currency"] as Currency,
    ...(row["tax_id"] ? { taxId: row["tax_id"] as string } : {}),
    ...(row["email"] ? { email: row["email"] as string } : {}),
    ...(row["address"] ? { address: row["address"] as string } : {}),
  };
}

export function getProject(db: DatabaseSync, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const repos = db.prepare("SELECT repo_path FROM project_repos WHERE project_id = ?")
    .all(id) as { repo_path: string }[];
  return {
    id: row["id"] as string,
    clientId: row["client_id"] as string,
    name: row["name"] as string,
    repoPaths: repos.map((r) => r.repo_path),
    billable: Boolean(row["billable"]),
    roundingMinutes: row["rounding_minutes"] as number,
    aiCostPolicy: row["ai_cost_policy"] as Project["aiCostPolicy"],
    kind: (row["kind"] as Project["kind"]) ?? "client",
    closedAt: row["closed_at"] ? new Date(row["closed_at"] as string) : null,
  };
}

/**
 * Cierra un proyecto. No borra nada y no bloquea el import si vuelve a haber
 * actividad — perder un bloque real capturado de verdad sería peor que
 * avisar de más; `estela doctor` es quien avisa. Es idempotente: cerrar un
 * proyecto ya cerrado no le cambia la fecha.
 */
export function closeProject(db: DatabaseSync, id: string, at: Date = new Date()): void {
  db.prepare("UPDATE projects SET closed_at = ? WHERE id = ? AND closed_at IS NULL")
    .run(iso(at), id);
}

/** Reabre un proyecto cerrado. Sin efecto si ya estaba abierto. */
export function reopenProject(db: DatabaseSync, id: string): void {
  db.prepare("UPDATE projects SET closed_at = NULL WHERE id = ?").run(id);
}

export function listProjects(db: DatabaseSync): Project[] {
  const rows = db.prepare("SELECT id FROM projects ORDER BY name").all() as { id: string }[];
  return rows.map((r) => getProject(db, r.id)!).filter(Boolean);
}

export function listClients(db: DatabaseSync): Client[] {
  const rows = db.prepare("SELECT id FROM clients ORDER BY name").all() as { id: string }[];
  return rows.map((r) => getClient(db, r.id)!).filter(Boolean);
}

export function getRates(db: DatabaseSync, projectId: string): RatePeriod[] {
  const rows = db.prepare(
    "SELECT * FROM rate_periods WHERE project_id = ? ORDER BY effective_from"
  ).all(projectId) as Record<string, unknown>[];

  return rows.map((r) => ({
    projectId: r["project_id"] as string,
    hourlyRate: { amount: r["hourly_minor"] as number, currency: r["currency"] as Currency },
    effectiveFrom: new Date(r["effective_from"] as string),
    effectiveTo: r["effective_to"] ? new Date(r["effective_to"] as string) : null,
  }));
}

/**
 * Correos con los que commiteas en un proyecto.
 *
 * Vacío significa "sin configurar", y entonces se cae a la configuración de
 * git. Es un mal apaño pero mejor que capturar los commits de todo el equipo:
 * imputarte el trabajo de un compañero es peor que no imputar nada.
 */
export function getProjectAuthors(db: DatabaseSync, projectId: string): string[] {
  return (db.prepare("SELECT author_email FROM project_authors WHERE project_id = ?")
    .all(projectId) as { author_email: string }[]).map((r) => r.author_email);
}

export function setProjectAuthors(
  db: DatabaseSync, projectId: string, emails: readonly string[],
): void {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM project_authors WHERE project_id = ?").run(projectId);
    const add = db.prepare(
      "INSERT OR IGNORE INTO project_authors (project_id, author_email) VALUES (?, ?)");
    for (const email of emails) {
      // Sin normalizar a minúsculas: aquí puede haber un nombre de autor, no
      // solo un correo, y git lo compara tal cual.
      const clean = email.trim();
      if (clean) add.run(projectId, clean);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export interface Publication {
  readonly projectId: string;
  readonly token: string;
  readonly publishedAt: Date;
  readonly baseUrl: string | null;
  /** Bloques con trabajo posterior a la publicación. */
  readonly staleBlocks: number;
  readonly lastWorkAt: Date | null;
}

/**
 * El token con el que este proyecto ya se publicó desde esta máquina, o
 * `null` si nunca se publicó. `project_id` es único en `publications` (el
 * `ON CONFLICT` de `recordPublication` lo exige), así que solo puede haber
 * un token vivo por proyecto — esta es esa fuente de verdad, la misma que
 * ya lee `listPublications`.
 */
export function getPublicationToken(db: DatabaseSync, projectId: string): string | null {
  const row = db.prepare("SELECT token FROM publications WHERE project_id = ?")
    .get(projectId) as { token: string } | undefined;
  return row?.token ?? null;
}

export function recordPublication(
  db: DatabaseSync, projectId: string, token: string, baseUrl: string | null,
  at: Date = new Date(),
): void {
  db.prepare(`
    INSERT INTO publications (project_id, token, published_at, base_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      token = excluded.token, published_at = excluded.published_at,
      base_url = COALESCE(excluded.base_url, publications.base_url)
  `).run(projectId, token, iso(at), baseUrl);
}

/**
 * Estado de las publicaciones.
 *
 * `staleBlocks` cuenta el trabajo posterior a la última publicación. Es lo que
 * de verdad envejece un panel: los días transcurridos no importan si en ese
 * tiempo no tocaste el proyecto.
 */
export function listPublications(db: DatabaseSync): Publication[] {
  const rows = db.prepare("SELECT * FROM publications").all() as Record<string, unknown>[];

  return rows.map((r) => {
    const projectId = r["project_id"] as string;
    const publishedAt = r["published_at"] as string;
    const stale = db.prepare(`
      SELECT COUNT(*) AS n, MAX(updated_at) AS last
      FROM time_entries WHERE project_id = ? AND updated_at > ?
    `).get(projectId, publishedAt) as { n: number; last: string | null };

    return {
      projectId,
      token: r["token"] as string,
      publishedAt: new Date(publishedAt),
      baseUrl: (r["base_url"] as string | null) ?? null,
      staleBlocks: stale.n,
      lastWorkAt: stale.last ? new Date(stale.last) : null,
    };
  });
}

/** Todos los correos configurados, por repositorio, para filtrar al importar. */
export function authorsByRepo(db: DatabaseSync): Map<string, string[]> {
  const rows = db.prepare(`
    SELECT r.repo_path, a.author_email
    FROM project_repos r JOIN project_authors a ON a.project_id = r.project_id
  `).all() as { repo_path: string; author_email: string }[];

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.repo_path);
    if (list) list.push(row.author_email);
    else map.set(row.repo_path, [row.author_email]);
  }
  return map;
}

/** Encuentra el proyecto al que pertenece una ruta de repositorio. */
export function projectForRepo(db: DatabaseSync, repoPath: string): string | null {
  const rows = db.prepare("SELECT project_id, repo_path FROM project_repos")
    .all() as { project_id: string; repo_path: string }[];
  // El prefijo más largo gana: permite anidar un subproyecto dentro de un monorepo.
  const match = rows
    .filter((r) => repoPath === r.repo_path || repoPath.startsWith(r.repo_path + "/"))
    .sort((a, b) => b.repo_path.length - a.repo_path.length)[0];
  return match?.project_id ?? null;
}

/**
 * Todos los repositorios que ya están vinculados a algún proyecto, sin
 * importar cómo llegaron ahí (un transcript de agente, `estela project add`,
 * o "Vincular" en el panel). `cmdImport` necesita esta lista para no
 * quedarse ciego a un repo que `setup` acaba de registrar por su cuenta —
 * antes solo miraba los repos que aparecían en los transcripts de Claude
 * Code, así que un proyecto sin ninguna sesión de agente detrás nunca
 * importaba sus commits, aunque ya estuviera dado de alta.
 */
export function allProjectRepoPaths(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT DISTINCT repo_path FROM project_repos").all() as { repo_path: string }[];
  return rows.map((r) => r.repo_path);
}

// ---------------------------------------------------------------------------
// Captura
// ---------------------------------------------------------------------------

/** Persiste turnos. `INSERT OR IGNORE` sobre la PK hace la dedup permanente. */
export function saveTurns(db: DatabaseSync, turns: readonly AgentTurn[]): number {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO agent_turns (
      turn_id, agent, session_id, at, model, repo_path, branch,
      tok_input, tok_output, tok_cache_read, tok_cache_w5m, tok_cache_w1h,
      cost_micro_usd, producer_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.exec("BEGIN");
  try {
    for (const t of turns) {
      const cost = costOfTurn(t.tokens, t.model, t.at);
      const result = stmt.run(
        t.turnId, t.agent, t.sessionId, iso(t.at), t.model, t.repoPath, t.branch,
        t.tokens.input, t.tokens.output, t.tokens.cacheRead,
        t.tokens.cacheWrite5m, t.tokens.cacheWrite1h,
        cost ? cost.microUsd : null, t.producerVersion);
      inserted += Number(result.changes);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return inserted;
}

/**
 * Guarda commits.
 *
 * El commit es inmutable, pero **nuestra lectura de él no lo es**: si un día se
 * corrige el parser, reimportar tiene que poder rehacer los campos derivados.
 * Con `INSERT OR IGNORE` los datos mal parseados se quedarían para siempre, sin
 * forma de arreglarlos salvo borrando la base entera.
 *
 * Por eso hash y fecha se conservan (son la identidad) y las estadísticas se
 * sobrescriben.
 */
export function saveCommits(db: DatabaseSync, commits: readonly CommitRecord[]): number {
  const stmt = db.prepare(`
    INSERT INTO commits
      (repo_path, hash, at, author_email, author_name, branch, subject,
       lines_added, lines_deleted, files)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_path, hash) DO UPDATE SET
      subject = excluded.subject,
      branch = excluded.branch,
      author_name = excluded.author_name,
      lines_added = excluded.lines_added,
      lines_deleted = excluded.lines_deleted,
      files = excluded.files
  `);

  let inserted = 0;
  db.exec("BEGIN");
  try {
    for (const c of commits) {
      const result = stmt.run(c.repoPath, c.hash, iso(c.at), c.authorEmail,
                              c.authorName, c.branch, c.subject,
                              c.linesAdded, c.linesDeleted, c.files.join("\n"));
      inserted += Number(result.changes);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return inserted;
}

export function logScan(db: DatabaseSync, source: string, report: ParseReport): void {
  db.prepare(`
    INSERT INTO scan_log (
      ran_at, source, files_read, records_seen, turns_accepted,
      duplicates_dropped, unknown_records, malformed_records,
      producer_versions, warnings
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(iso(new Date()), source, report.filesRead, report.recordsSeen,
         report.turnsAccepted, report.duplicatesDropped, report.unknownRecords,
         report.malformedRecords, report.producerVersions.join(","),
         report.warnings.join(" | "));
}

// ---------------------------------------------------------------------------
// Imputaciones y facturas
// ---------------------------------------------------------------------------

/**
 * Guarda una imputación.
 *
 * `at` es la hora de escritura, no la del trabajo. Se puede pasar para que los
 * tests no dependan del reloj: publicar y escribir en el mismo milisegundo hace
 * que la comparación de desfase falle por empate.
 */
export function saveTimeEntry(
  db: DatabaseSync,
  entry: Omit<TimeEntry, "id"> & { id?: string },
  at: Date = new Date(),
): string {
  const id = entry.id ?? `te_${randomUUID()}`;
  db.prepare(`
    INSERT INTO time_entries (
      id, project_id, started_at, local_date, ended_at, seconds, description,
      billable, approved, invoice_id, ai_micro_usd, agent_seconds,
      commit_hashes, agents, source, kind, branch, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      started_at = excluded.started_at, local_date = excluded.local_date,
      ended_at = excluded.ended_at,
      seconds = excluded.seconds, description = excluded.description,
      billable = excluded.billable, ai_micro_usd = excluded.ai_micro_usd,
      -- Los commits también se rehacen. Sin esto, un bloque creado cuando
      -- todavía no se capturaban los commits del proyecto se quedaba sin
      -- ellos para siempre: la descripción se corregía al reimportar, pero
      -- el respaldo que la justifica no aparecía nunca.
      commit_hashes = excluded.commit_hashes,
      agents = excluded.agents,
      agent_seconds = excluded.agent_seconds,
      -- La procedencia también se rehace: un bloque deducido de commits pasa a
      -- 'agent' en cuanto aparece el transcript que lo cubre, y al revés. Sin
      -- esto, una fila mal etiquetada lo seguiría estando para siempre.
      source = excluded.source,
      branch = excluded.branch,
      -- Solo se marca como tocada si algo cambió de verdad: un reimport que
      -- reescribe los mismos valores no debería envejecer un panel publicado.
      updated_at = CASE
        WHEN time_entries.seconds <> excluded.seconds
          OR time_entries.description <> excluded.description
          OR time_entries.commit_hashes <> excluded.commit_hashes
        THEN excluded.updated_at ELSE time_entries.updated_at END
    -- Reimportar rehace lo deducido de los agentes. Lo escrito a mano es tuyo:
    -- un import no puede borrarte una reunión de dos horas que apuntaste ayer.
    WHERE time_entries.source IN ('agent', 'commit')
  `).run(id, entry.projectId, iso(entry.startedAt), localDate(entry.startedAt),
         iso(entry.endedAt), entry.seconds,
         entry.description, entry.billable ? 1 : 0, entry.invoiceId,
         entry.aiCost.microUsd, entry.agentSeconds,
         entry.commitHashes.join(","), entry.agents.join(","),
         entry.source, entry.kind, entry.branch, iso(at));
  return id;
}

export function getTimeEntries(db: DatabaseSync, projectId: string): TimeEntry[] {
  const rows = db.prepare(
    "SELECT * FROM time_entries WHERE project_id = ? ORDER BY started_at"
  ).all(projectId) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

/**
 * Total de segundos de un proyecto, sin filtrar por facturable: es lo que
 * `estela sync` empuja como horas medidas de un proyecto de equipo, y ahí
 * lo que importa es cuánto se trabajó, no a quién se le cobra — igual que
 * la estimación por commits de un compañero tampoco distingue eso.
 */
export function sumEntrySeconds(db: DatabaseSync, projectId: string): number {
  const row = db.prepare("SELECT COALESCE(SUM(seconds), 0) AS s FROM time_entries WHERE project_id = ?")
    .get(projectId) as { s: number };
  return row.s;
}

/**
 * El mismo total, abierto por día. Es lo que permite a quien te invitó ver un
 * ritmo en vez de una cifra suelta.
 *
 * Va por `local_date` y no por `started_at`: el día que trabajaste es el de tu
 * reloj, no el de Greenwich. Y no lleva coste de IA a propósito — eso es tuyo
 * y no sale de esta máquina.
 */
export function entrySecondsByDay(
  db: DatabaseSync, projectId: string,
): { date: string; seconds: number }[] {
  return (db.prepare(`
    SELECT local_date AS d, SUM(seconds) AS s FROM time_entries
    WHERE project_id = ? GROUP BY local_date ORDER BY local_date
  `).all(projectId) as { d: string; s: number }[]).map((r) => ({ date: r.d, seconds: r.s }));
}

/**
 * Imputaciones de un rango de fechas.
 *
 * Filtra por `local_date` y no por `started_at`: la fecha en que trabajaste es
 * la de tu reloj, no la de Greenwich. Un bloque de las 23:20 pertenece a hoy
 * aunque en UTC ya sea mañana.
 */
export function listEntriesBetween(
  db: DatabaseSync, from: string, to: string,
): TimeEntry[] {
  const rows = db.prepare(
    "SELECT * FROM time_entries WHERE local_date >= ? AND local_date <= ? ORDER BY started_at"
  ).all(from, to) as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

function rowToEntry(r: Record<string, unknown>): TimeEntry {
  return ({
    id: r["id"] as string,
    projectId: r["project_id"] as string,
    startedAt: new Date(r["started_at"] as string),
    endedAt: new Date(r["ended_at"] as string),
    seconds: r["seconds"] as number,
    description: r["description"] as string,
    billable: Boolean(r["billable"]),
    invoiceId: (r["invoice_id"] as string | null) ?? null,
    aiCost: { microUsd: r["ai_micro_usd"] as number },
    agentSeconds: r["agent_seconds"] as number,
    commitHashes: String(r["commit_hashes"] || "").split(",").filter(Boolean),
    agents: String(r["agents"] || "").split(",").filter(Boolean) as TimeEntry["agents"],
    source: (r["source"] as TimeEntry["source"]) ?? "agent",
    kind: (r["kind"] as TimeEntry["kind"]) ?? "development",
    branch: (r["branch"] as string | null) ?? null,
  });
}

/** Guarda la factura y marca sus imputaciones. Todo o nada. */
export function saveInvoice(db: DatabaseSync, invoice: Invoice, entryIds: readonly string[]): void {
  db.exec("BEGIN");
  try {
    db.prepare(`
      INSERT INTO invoices (
        id, number, client_id, project_id, issued_at, cutoff_at, period_start,
        currency, subtotal_minor, total_minor, total_seconds, ai_micro_usd,
        usd_fx_rate, ai_billed_minor, ai_amort_minor, ai_amort_cur, notes, lines_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoice.id, invoice.number, invoice.clientId, invoice.projectId,
           iso(invoice.issuedAt), iso(invoice.cutoffAt), iso(invoice.periodStart),
           invoice.currency, invoice.subtotal.amount, invoice.total.amount,
           invoice.totalSeconds, invoice.aiCost.microUsd, invoice.usdFxRate,
           invoice.aiCostBilled?.amount ?? null,
           invoice.aiAmortized?.amount ?? null, invoice.aiAmortized?.currency ?? null,
           invoice.notes ?? null, JSON.stringify(invoice.lines));

    const mark = db.prepare("UPDATE time_entries SET invoice_id = ? WHERE id = ?");
    for (const id of entryIds) mark.run(invoice.id, id);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function nextInvoiceNumber(db: DatabaseSync, prefix: string): string {
  const year = new Date().getFullYear();
  const row = db.prepare(
    "SELECT COUNT(*) AS n FROM invoices WHERE number LIKE ?"
  ).get(`${prefix}-${year}-%`) as { n: number };
  return `${prefix}-${year}-${String(row.n + 1).padStart(3, "0")}`;
}

export function readInvoiceLines(json: string): InvoiceLine[] {
  return JSON.parse(json) as InvoiceLine[];
}

// ---------------------------------------------------------------------------
// Suscripciones
// ---------------------------------------------------------------------------

export function upsertSubscription(db: DatabaseSync, sub: Subscription): void {
  db.prepare(`
    INSERT INTO subscriptions (id, name, fee_minor, currency, effective_from, effective_to)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, fee_minor = excluded.fee_minor,
      currency = excluded.currency, effective_from = excluded.effective_from,
      effective_to = excluded.effective_to
  `).run(sub.id, sub.name, sub.monthlyFee.amount, sub.monthlyFee.currency,
         iso(sub.effectiveFrom), sub.effectiveTo ? iso(sub.effectiveTo) : null);
}

export function listSubscriptions(db: DatabaseSync): Subscription[] {
  const rows = db.prepare("SELECT * FROM subscriptions ORDER BY effective_from")
    .all() as Record<string, unknown>[];

  return rows.map((r) => ({
    id: r["id"] as string,
    name: r["name"] as string,
    monthlyFee: { amount: r["fee_minor"] as number, currency: r["currency"] as Currency },
    effectiveFrom: new Date(r["effective_from"] as string),
    effectiveTo: r["effective_to"] ? new Date(r["effective_to"] as string) : null,
  }));
}

/**
 * Consumo total del mes en toda la máquina, esté asignado a un proyecto o no.
 *
 * Es el denominador correcto para repartir una cuota fija: la pagaste entera,
 * la usaras donde la usaras. Se lee de `agent_turns` y no de `time_entries`
 * porque ahí está *todo* tu consumo, incluidos los repos que aún no configuraste.
 */
export function totalConsumptionByMonth(db: DatabaseSync): Map<string, { microUsd: number }> {
  const rows = db.prepare(`
    SELECT substr(at, 1, 7) AS month, SUM(COALESCE(cost_micro_usd, 0)) AS micro
    FROM agent_turns
    GROUP BY month
  `).all() as { month: string; micro: number }[];

  return new Map(rows.map((r) => [r.month, { microUsd: r.micro ?? 0 }]));
}

/** Consumo por proyecto y mes, sobre las imputaciones ya asignadas. */
export function consumptionByProjectMonth(db: DatabaseSync): ConsumptionRow[] {
  const rows = db.prepare(`
    SELECT project_id, substr(started_at, 1, 7) AS month, SUM(ai_micro_usd) AS micro
    FROM time_entries
    GROUP BY project_id, month
  `).all() as { project_id: string; month: string; micro: number }[];

  return rows.map((r) => ({
    projectId: r.project_id,
    month: r.month,
    consumption: { microUsd: r.micro ?? 0 },
  }));
}

// ---------------------------------------------------------------------------
// Cuenta cloud, alcance de sincronización y consentimiento de IA
// ---------------------------------------------------------------------------

/** La cuenta cloud vinculada a esta máquina, o null si todo sigue local. */
export function getCloudAccount(db: DatabaseSync): CloudAccount | null {
  const row = db.prepare("SELECT * FROM cloud_account WHERE id = 'local'")
    .get() as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    accountId: row["account_id"] as string,
    email: row["email"] as string,
    plan: row["plan"] as CloudAccount["plan"],
    deviceToken: row["device_token"] as string,
    apiBaseUrl: row["api_base_url"] as string,
    linkedAt: new Date(row["linked_at"] as string),
  };
}

export function setCloudAccount(db: DatabaseSync, account: CloudAccount): void {
  db.prepare(`
    INSERT INTO cloud_account (id, account_id, email, plan, device_token, api_base_url, linked_at)
    VALUES ('local', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      account_id = excluded.account_id, email = excluded.email, plan = excluded.plan,
      device_token = excluded.device_token, api_base_url = excluded.api_base_url,
      linked_at = excluded.linked_at
  `).run(account.accountId, account.email, account.plan,
         account.deviceToken, account.apiBaseUrl, iso(account.linkedAt));
}

/** `estela logout`. Borra el vínculo cloud; los datos locales no se tocan. */
export function clearCloudAccount(db: DatabaseSync): void {
  db.prepare("DELETE FROM cloud_account WHERE id = 'local'").run();
}

export function getProjectSync(db: DatabaseSync, projectId: string): ProjectSync | null {
  const row = db.prepare("SELECT * FROM project_sync WHERE project_id = ?")
    .get(projectId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    projectId: row["project_id"] as string,
    scope: row["scope"] as ProjectSync["scope"],
    remoteProjectId: row["remote_project_id"] as string,
    remoteOrgId: (row["remote_org_id"] as string | null) ?? null,
    inviteToken: (row["invite_token"] as string | null) ?? null,
  };
}

export function setProjectSync(db: DatabaseSync, sync: ProjectSync): void {
  db.prepare(`
    INSERT INTO project_sync (project_id, scope, remote_project_id, remote_org_id, invite_token)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      scope = excluded.scope, remote_project_id = excluded.remote_project_id,
      remote_org_id = excluded.remote_org_id, invite_token = excluded.invite_token
  `).run(sync.projectId, sync.scope, sync.remoteProjectId, sync.remoteOrgId, sync.inviteToken);
}

/** Todos los proyectos con fila en `project_sync`, de cualquier alcance. */
export function listProjectSyncs(db: DatabaseSync): ProjectSync[] {
  const rows = db.prepare("SELECT project_id FROM project_sync").all() as { project_id: string }[];
  return rows.map((r) => getProjectSync(db, r.project_id)!).filter(Boolean);
}

/**
 * Cursor de sync de un proyecto — fuera del tipo `ProjectSync` a propósito:
 * ese tipo es identidad y alcance, esto es contabilidad interna del sync.
 */
export function getSyncCursor(db: DatabaseSync, projectId: string): string {
  const row = db.prepare("SELECT synced_up_to FROM project_sync WHERE project_id = ?")
    .get(projectId) as { synced_up_to: string } | undefined;
  return row?.synced_up_to ?? "";
}

/** Cursor de sync de un proyecto, tras un push/pull hecho con éxito. */
export function recordSyncCursor(
  db: DatabaseSync, projectId: string, syncedUpTo: string, at: Date = new Date(),
): void {
  db.prepare("UPDATE project_sync SET synced_up_to = ?, last_synced_at = ? WHERE project_id = ?")
    .run(syncedUpTo, iso(at), projectId);
}

/** Forma de una entrada tal y como viaja por la red — con `updatedAt`, que `TimeEntry` no lleva. */
export interface SyncableEntry {
  readonly id: string;
  readonly startedAt: string;
  readonly localDate: string;
  readonly endedAt: string;
  readonly seconds: number;
  readonly description: string;
  readonly billable: boolean;
  readonly aiMicroUsd: number;
  readonly agentSeconds: number;
  readonly commitHashes: string;
  readonly agents: string;
  readonly source: string;
  readonly kind: string;
  readonly branch: string | null;
  readonly updatedAt: string;
}

/** Imputaciones de un proyecto cambiadas después de `since` — lo que hay que empujar. */
export function listEntriesUpdatedSince(
  db: DatabaseSync, projectId: string, since: string,
): SyncableEntry[] {
  const rows = db.prepare(
    "SELECT * FROM time_entries WHERE project_id = ? AND updated_at > ? ORDER BY updated_at"
  ).all(projectId, since) as Record<string, unknown>[];
  return rows.map(rowToSyncableEntry);
}

function rowToSyncableEntry(r: Record<string, unknown>): SyncableEntry {
  return {
    id: r["id"] as string,
    startedAt: r["started_at"] as string,
    localDate: r["local_date"] as string,
    endedAt: r["ended_at"] as string,
    seconds: r["seconds"] as number,
    description: r["description"] as string,
    billable: Boolean(r["billable"]),
    aiMicroUsd: r["ai_micro_usd"] as number,
    agentSeconds: r["agent_seconds"] as number,
    commitHashes: String(r["commit_hashes"] || ""),
    agents: String(r["agents"] || ""),
    source: r["source"] as string,
    kind: r["kind"] as string,
    branch: (r["branch"] as string | null) ?? null,
    updatedAt: r["updated_at"] as string,
  };
}

/**
 * Aplica en local una entrada que llega de otra máquina de la misma cuenta.
 *
 * A propósito NO reutiliza `saveTimeEntry`: esa función protege una edición
 * manual de que un *reimport en la misma máquina* la pise (`WHERE source IN
 * ('agent','commit')`), que es un contrato distinto al de aquí — una fila que
 * llega de otra de tus máquinas gana si es más reciente, sea cual sea su
 * `source`, punto.
 */
export function applySyncedEntry(db: DatabaseSync, entry: SyncableEntry, projectId: string): void {
  db.prepare(`
    INSERT INTO time_entries (
      id, project_id, started_at, local_date, ended_at, seconds, description,
      billable, approved, invoice_id, ai_micro_usd, agent_seconds,
      commit_hashes, agents, source, kind, branch, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      started_at = excluded.started_at, local_date = excluded.local_date,
      ended_at = excluded.ended_at, seconds = excluded.seconds,
      description = excluded.description, billable = excluded.billable,
      ai_micro_usd = excluded.ai_micro_usd, agent_seconds = excluded.agent_seconds,
      commit_hashes = excluded.commit_hashes, agents = excluded.agents,
      source = excluded.source, kind = excluded.kind, branch = excluded.branch,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at > time_entries.updated_at
  `).run(
    entry.id, projectId, entry.startedAt, entry.localDate, entry.endedAt, entry.seconds,
    entry.description, entry.billable ? 1 : 0, entry.aiMicroUsd, entry.agentSeconds,
    entry.commitHashes, entry.agents, entry.source, entry.kind, entry.branch, entry.updatedAt);
}

/** Proyectos de equipo enlazados en esta máquina — lo único que sube `sync/team.ts`. */
export function listTeamSyncedProjects(db: DatabaseSync): ProjectSync[] {
  const rows = db.prepare("SELECT project_id FROM project_sync WHERE scope = 'team'")
    .all() as { project_id: string }[];
  return rows.map((r) => getProjectSync(db, r.project_id)!).filter(Boolean);
}

/**
 * Proyectos candidatos al sync personal (Pro): todos menos los que ya están
 * enlazados a un equipo. Es la guardia anti-fuga: un proyecto de equipo nunca
 * puede colarse también como sync personal, porque `project_sync.project_id`
 * es su clave primaria — un proyecto tiene un único alcance.
 */
export function listPersonalSyncCandidates(db: DatabaseSync): string[] {
  const rows = db.prepare(`
    SELECT id FROM projects
    WHERE id NOT IN (SELECT project_id FROM project_sync WHERE scope = 'team')
  `).all() as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Las horas por día CON su coste de IA. Solo se llama cuando el consentimiento
 * está concedido — es la única diferencia con `entrySecondsByDay`, y está
 * separada a propósito para que se vea en la llamada si el dato sale o no.
 */
export function entryAiByDay(
  db: DatabaseSync, projectId: string,
): { date: string; seconds: number; aiMicroUsd: number }[] {
  return (db.prepare(`
    SELECT local_date AS d, SUM(seconds) AS s, SUM(ai_micro_usd) AS ai
    FROM time_entries WHERE project_id = ? GROUP BY local_date ORDER BY local_date
  `).all(projectId) as { d: string; s: number; ai: number }[])
    .map((r) => ({ date: r.d, seconds: r.s, aiMicroUsd: r.ai ?? 0 }));
}

/**
 * El detalle del trabajo de un proyecto, para mandárselo a quien te invitó.
 *
 * Va la rama, la descripción y los commits — que son cosas que quien paga ya
 * tiene en su propio repositorio. NO va el coste de IA: eso solo viaja con
 * consentimiento explícito y por otro camino.
 */
export function entryDetailForTeam(
  db: DatabaseSync, projectId: string,
): { id: string; date: string; seconds: number; description: string;
     branch: string | null; commitHashes: string }[] {
  return (db.prepare(`
    SELECT id, local_date, seconds, description, branch, commit_hashes
    FROM time_entries WHERE project_id = ? ORDER BY local_date DESC, started_at DESC
  `).all(projectId) as Record<string, unknown>[]).map((r) => ({
    id: r["id"] as string,
    date: r["local_date"] as string,
    seconds: r["seconds"] as number,
    description: r["description"] as string,
    branch: (r["branch"] as string | null) ?? null,
    commitHashes: (r["commit_hashes"] as string) ?? "",
  }));
}

export function getAiConsent(db: DatabaseSync, projectId: string): AiConsentRecord | null {
  const row = db.prepare("SELECT * FROM ai_consent WHERE project_id = ?")
    .get(projectId) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    projectId: row["project_id"] as string,
    requested: Boolean(row["requested"]),
    decision: row["decision"] as AiConsentRecord["decision"],
    decidedAt: row["decided_at"] ? new Date(row["decided_at"] as string) : null,
  };
}

export function setAiConsent(
  db: DatabaseSync, projectId: string, requested: boolean, decision: AiConsentDecision,
): void {
  db.prepare(`
    INSERT INTO ai_consent (project_id, requested, decision, decided_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      requested = excluded.requested, decision = excluded.decision, decided_at = excluded.decided_at
  `).run(projectId, requested ? 1 : 0, decision, decision === "pending" ? null : iso(new Date()));
}
