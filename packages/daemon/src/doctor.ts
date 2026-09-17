import type { DatabaseSync } from "node:sqlite";

import { formatDuration } from "@estela/shared";

import * as store from "./db/store.js";
import { tr } from "./i18n/index.js";

/**
 * Revisión de los datos antes de publicar.
 *
 * Existe porque el fallo que arruina una demo no es una gráfica fea: es una
 * cifra que no cuadra delante del cliente. Cada comprobación de aquí
 * corresponde a un fallo que ya ocurrió de verdad — un proyecto sin autor
 * configurado capturando 3 commits de 1697, filas duplicadas por mezclar UTC
 * con hora local, modelos sin precio sumando cero en silencio.
 *
 * Todo lo que avisa tiene arreglo y dice cuál. Un diagnóstico sin remedio solo
 * genera ansiedad.
 */

export type Severity = "error" | "warning" | "info";

export interface Finding {
  readonly severity: Severity;
  readonly title: string;
  readonly detail: string;
  /** Qué hacer. Sin esto, avisar solo preocupa. */
  readonly fix: string;
}

export function diagnose(db: DatabaseSync): Finding[] {
  const findings: Finding[] = [];
  const projects = store.listProjects(db);

  if (projects.length === 0) {
    findings.push({
      severity: "error",
      title: tr`No hay ningún proyecto configurado`,
      detail: tr`Sin proyectos no se imputa nada, aunque se esté capturando trabajo.`,
      fix: tr`Abre la pestaña Proyectos y registra el primero.`,
    });
    return findings;
  }

  for (const project of projects) {
    // 1. Identidad de commit. El fallo real: 3 commits capturados de 1697.
    if (project.repoPaths.length > 0 && store.getProjectAuthors(db, project.id).length === 0) {
      findings.push({
        severity: "error",
        title: tr`"${project.name}" no sabe con qué correo commiteas`,
        detail: tr`Se filtra por la configuración global de git, que en el repositorio de ` +
          tr`un cliente casi nunca es la que usas. Estarás perdiendo casi todos tus commits.`,
        fix: `estela author --project ${project.id}`,
      });
    }

    // 2. Sin repositorio no se imputa nada automáticamente.
    if (project.repoPaths.length === 0) {
      findings.push({
        severity: "warning",
        title: tr`"${project.name}" no tiene repositorio asignado`,
        detail: tr`Solo recibirá las horas que anotes a mano.`,
        fix: tr`Asígnale uno en la pestaña Proyectos.`,
      });
    }

    // 3. Sin tarifa no hay importes. Solo aplica a clientes: en un empleo por
    //    nómina el importe no falta, es que no existe.
    if (project.kind === "client" && project.billable
        && store.getRates(db, project.id).length === 0) {
      findings.push({
        severity: "warning",
        title: tr`"${project.name}" es facturable pero no tiene tarifa`,
        detail: tr`Las horas se registran, pero no se puede calcular su valor.`,
        fix: tr`estela rate set --project ${project.id} --rate <importe>`,
      });
    }

    // 3b. Horas deducidas solo de commits en un proyecto que se factura.
    //     No son un error: es la única forma de registrar trabajo hecho sin
    //     agente. Pero el rato anterior al primer commit de cada tanda es una
    //     estimación, y estas horas van a acabar en un informe que alguien va a
    //     pagar. Quien firma ese informe tiene que saber cuáles son.
    if (project.kind === "client" && project.billable) {
      const row = db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(SUM(seconds), 0) AS secs
        FROM time_entries WHERE project_id = ? AND source = 'commit'
      `).get(project.id) as { n: number; secs: number };

      if (row.n > 0) {
        findings.push({
          severity: "warning",
          title: tr`"${project.name}" tiene ${formatDuration(row.secs)} deducidas solo de commits`,
          detail: (row.n === 1 ? tr`1 bloque sin sesión de agente que lo respalde.`
                               : tr`${row.n} bloques sin sesión de agente que los respalde.`) +
            tr` El tiempo se estima a partir de la separación entre commits, así que es ` +
            tr`menos exacto que el resto del informe.`,
          fix: tr`Revísalos en Mi día y corrige los minutos antes de emitir el informe.`,
        });
      }
    }

    // 3c. Un proyecto cerrado que ha vuelto a captar trabajo. Cerrar no
    //     bloquea el import: perder un bloque real capturado de verdad sería
    //     peor que avisar de más. Este es el aviso — sin él, esas horas
    //     nunca llegan a facturarse ni tampoco se sabe que hay que reabrirlo.
    if (project.closedAt) {
      const row = db.prepare(`
        SELECT COUNT(*) AS n, COALESCE(SUM(seconds), 0) AS secs
        FROM time_entries WHERE project_id = ? AND started_at > ?
      `).get(project.id, project.closedAt.toISOString()) as { n: number; secs: number };

      if (row.n > 0) {
        const fecha = project.closedAt.toISOString().slice(0, 10);
        findings.push({
          severity: "warning",
          title: tr`"${project.name}" está cerrado pero volvió a captar trabajo`,
          detail: (row.n === 1 ? tr`1 bloque nuevo` : tr`${row.n} bloques nuevos`) +
            tr` (${formatDuration(row.secs)}) desde que se cerró, el ${fecha}.`,
          fix: tr`Factúralo y ciérralo otra vez, o si sigues trabajando en él: ` +
            tr`estela project reopen --project ${project.id}`,
        });
      }
    }
  }

  // 4. La invariante de las fechas. El fallo real: el día contado dos veces
  //    porque la CLI generaba el id en UTC y el servidor en hora local.
  const mismatched = db.prepare(`
    SELECT COUNT(*) AS n FROM time_entries
    WHERE source = 'agent' AND id NOT LIKE '%_' || local_date || '_%'
  `).get() as { n: number };

  if (mismatched.n > 0) {
    findings.push({
      severity: "error",
      title: tr`${mismatched.n} imputaciones con la fecha descuadrada`,
      detail: tr`Su identificador lleva una fecha distinta a la del día al que están ` +
        tr`asignadas. Suele significar que un día está contado dos veces.`,
      fix: "Bórralas y reimporta: DELETE FROM time_entries WHERE source='agent' " +
        "AND invoice_id IS NULL AND id NOT LIKE '%_'||local_date||'_%';",
    });
  }

  // 5. Modelos sin precio: suman cero en silencio, que es justo lo que la
  //    regla del proyecto prohíbe para un número de facturación.
  const unpriced = db.prepare(`
    SELECT model, COUNT(*) AS n FROM agent_turns
    WHERE cost_micro_usd IS NULL GROUP BY model ORDER BY n DESC
  `).all() as { model: string; n: number }[];

  for (const row of unpriced) {
    const internal = row.model.startsWith("<");
    findings.push({
      severity: internal ? "info" : "warning",
      title: tr`${row.n} turnos con el modelo "${row.model}" sin precio`,
      detail: internal
        ? tr`Es un valor interno de la herramienta, no un modelo real. Suman cero al coste.`
        : tr`No está en el catálogo de precios, así que su coste no se cuenta.`,
      fix: internal
        ? tr`No hace falta nada: no representa consumo facturable.`
        : tr`Añádelo a PRICE_CATALOG en packages/daemon/src/pricing/catalog.ts`,
    });
  }

  // 6. Trabajo capturado que no llega a ningún proyecto.
  const orphans = db.prepare(`
    SELECT COUNT(DISTINCT repo_path) AS repos, COUNT(*) AS turns
    FROM agent_turns WHERE repo_path IS NOT NULL
  `).get() as { repos: number; turns: number };

  const configured = new Set(
    (db.prepare("SELECT repo_path FROM project_repos").all() as { repo_path: string }[])
      .map((r) => r.repo_path));

  const unassigned = (db.prepare(
    "SELECT DISTINCT repo_path FROM agent_turns WHERE repo_path IS NOT NULL"
  ).all() as { repo_path: string }[])
    .filter((r) => ![...configured].some((c) => r.repo_path.startsWith(c)));

  if (unassigned.length > 0) {
    findings.push({
      severity: "warning",
      title: tr`${unassigned.length} repositorios con trabajo sin proyecto`,
      detail: tr`De ${orphans.repos} repositorios con actividad capturada, ${unassigned.length} ` +
        tr`no pertenecen a ningún proyecto. Son horas que ya tienes y no puedes informar.`,
      fix: tr`Asígnalos en la pestaña Proyectos.`,
    });
  }

  // 7. Bloques sospechosamente largos: delante de un cliente, una jornada de
  //    catorce horas es una pregunta que conviene haberse hecho antes.
  const long = db.prepare(`
    SELECT COUNT(*) AS n, MAX(seconds) AS max_seconds
    FROM time_entries WHERE seconds > 10 * 3600
  `).get() as { n: number; max_seconds: number | null };

  if (long.n > 0) {
    findings.push({
      severity: "warning",
      title: tr`${long.n} bloques de más de 10 horas`,
      detail: tr`El mayor es de ${formatDuration(long.max_seconds ?? 0)}. Puede ser real, ` +
        tr`pero también una sesión que quedó abierta.`,
      fix: tr`Revísalos en Mi día y corrige los minutos si no cuadran.`,
    });
  }

  // 8. Paneles publicados que se han quedado atrás.
  //
  //    Enseñarle a un cliente datos de hace días da impresión de herramienta
  //    desatendida, y esa impresión pesa más que cualquier métrica bonita.
  for (const pub of store.listPublications(db)) {
    if (pub.staleBlocks === 0) continue;
    const project = projects.find((p) => p.id === pub.projectId);
    findings.push({
      severity: "warning",
      title: tr`El panel de "${project?.name ?? pub.projectId}" se ha quedado atrás`,
      detail: pub.staleBlocks === 1
        ? tr`Hay 1 bloque de trabajo posterior a la última publicación ` +
          tr`(${pub.publishedAt.toISOString().slice(0, 10)}). Tu cliente está viendo datos viejos.`
        : tr`Hay ${pub.staleBlocks} bloques de trabajo posteriores a la última publicación ` +
          tr`(${pub.publishedAt.toISOString().slice(0, 10)}). Tu cliente está viendo datos viejos.`,
      fix: `estela publish --project ${pub.projectId} --token ${pub.token}`,
    });
  }

  // 9. El canario del parser.
  const scan = db.prepare("SELECT warnings FROM scan_log ORDER BY id DESC LIMIT 1")
    .get() as { warnings: string } | undefined;

  if (scan?.warnings) {
    findings.push({
      severity: "error",
      title: tr`El lector de transcripts avisó de algo`,
      detail: scan.warnings,
      fix: tr`Revisa los totales antes de publicar nada.`,
    });
  }

  const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function renderFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) {
    return tr`\n  Todo en orden. Puedes publicar con tranquilidad.\n`;
  }

  const icon: Record<Severity, string> = { error: "✗", warning: "!", info: "·" };
  const out: string[] = [""];

  for (const f of findings) {
    out.push(`  ${icon[f.severity]} ${f.title}`);
    out.push(`      ${f.detail}`);
    out.push(`      → ${f.fix}`);
    out.push("");
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;

  // Frases enteras por plural: "problema/problemas" suelto dentro de la frase
  // no se puede traducir bien, porque en inglés no siempre va en ese sitio.
  out.push(errors > 0
    ? (errors === 1
        ? tr`  1 problema que conviene arreglar antes de enseñar esto.`
        : tr`  ${errors} problemas que conviene arreglar antes de enseñar esto.`)
    : warnings > 0
      ? (warnings === 1 ? tr`  Nada grave: 1 aviso.` : tr`  Nada grave: ${warnings} avisos.`)
      : tr`  Solo notas informativas.`);

  return out.join("\n") + "\n";
}
