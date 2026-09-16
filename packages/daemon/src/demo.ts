import type { AgentTurn, CommitRecord, TimeEntry } from "@estela/shared";
import { localDate, money } from "@estela/shared";

import { attachCommits, describeBlock, groupByBranchAndDay, sessionize,
         sessionizeCommits, withoutOverlap } from "./billing/sessionize.js";
import type { openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { tr } from "./i18n/index.js";

/**
 * Datos de ejemplo para `estela demo`.
 *
 * Quien instala esto sin historial de Claude Code —o con dos días— termina el
 * `setup` y ve una pantalla casi vacía: ha hecho todo lo que se le pidió y no
 * ha visto el producto. Ahí se pierde la mayoría de la gente que llega desde
 * un enlace.
 *
 * Esto no dibuja una pantalla de mentira: fabrica los mismos turnos de agente
 * y commits que habría en una máquina real y los pasa por el pipeline de
 * verdad (sesionar, pegar commits, agrupar por rama y día). Si el cálculo de
 * horas cambia, la demo cambia con él, y nunca puede enseñar algo que el
 * producto no haría.
 *
 * Nada de esto toca la base real: `estela demo` escribe en un fichero aparte.
 */

/** Azar con semilla: dos ejecuciones dan exactamente la misma demo. */
function azar(semillaInicial: number) {
  let s = semillaInicial;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RepoDemo {
  readonly id: string;
  readonly peso: number;
  readonly cliente: { id: string; name: string; currency: "USD" | "EUR" };
  readonly tarifaMinor: number | null;
  readonly kind: "client" | "internal";
  readonly companeros: readonly { name: string; email: string }[];
  readonly ramas: readonly string[];
  readonly asuntos: readonly string[];
}

const YO = { name: "Sam Rivera", email: "sam@riveradev.io" };

const REPOS: readonly RepoDemo[] = [
  {
    id: "northwind-app", peso: 5, kind: "client",
    cliente: { id: "northwind", name: "Northwind Labs", currency: "USD" }, tarifaMinor: 8500,
    companeros: [
      { name: "Lena Hofmann", email: "lena@northwindlabs.com" },
      { name: "Marco Ruiz", email: "marco@northwindlabs.com" },
      { name: "Priya Nair", email: "priya@northwindlabs.com" },
    ],
    ramas: ["feature/bulk-export", "fix/token-refresh", "feature/revenue-chart",
            "feature/customer-search", "main"],
    asuntos: [
      "feat(orders): add bulk export to CSV", "fix(auth): refresh token race on slow networks",
      "refactor(api): split invoices service", "feat(dashboard): weekly revenue chart",
      "test(orders): cover partial refunds", "fix(ui): table overflow on mobile",
      "feat(search): typeahead for customers", "perf(api): cache product catalog",
    ],
  },
  {
    id: "brightside-portal", peso: 3, kind: "client",
    cliente: { id: "brightside", name: "Brightside Health", currency: "EUR" }, tarifaMinor: 7000,
    companeros: [{ name: "Tom Becker", email: "tom@brightside.health" }],
    ramas: ["feature/reschedule", "fix/insurance-validation", "main"],
    asuntos: [
      "feat(appointments): reschedule flow", "fix(forms): insurance number validation",
      "feat(i18n): add Portuguese", "fix(a11y): focus trap in modal",
      "feat(reports): PDF summary for clinicians",
    ],
  },
  {
    id: "ledger-cli", peso: 2, kind: "internal",
    cliente: { id: "personal", name: "Personal", currency: "USD" }, tarifaMinor: null,
    companeros: [],
    ramas: ["feature/ofx-import", "main"],
    asuntos: [
      "feat: import OFX statements", "fix: parse negative amounts in CSV",
      "docs: usage examples", "feat: monthly budget report",
    ],
  },
];

const RUTA = (id: string) => `~/code/${id}`;

export interface DemoOptions {
  /** Para los tests: fija el "hoy" de la demo. */
  readonly now?: Date;
  readonly semanas?: number;
}

/** Rellena una base vacía con seis semanas de trabajo inventado. */
export function seedDemo(db: ReturnType<typeof openDatabase>, options: DemoOptions = {}): void {
  const rnd = azar(20260915);
  const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const uno = <T>(lista: readonly T[]): T => lista[Math.floor(rnd() * lista.length)]!;

  const ahora = options.now ?? new Date();
  const hoy = new Date(ahora);
  hoy.setHours(0, 0, 0, 0);
  const dias = (options.semanas ?? 6) * 7;

  for (const repo of REPOS) {
    store.upsertClient(db, repo.cliente);
    store.upsertProject(db, {
      id: repo.id, clientId: repo.cliente.id, name: repo.id, repoPaths: [RUTA(repo.id)],
      billable: repo.kind === "client", roundingMinutes: 0, aiCostPolicy: "absorbed", kind: repo.kind,
    });
    if (repo.tarifaMinor !== null) {
      store.addRatePeriod(db, {
        projectId: repo.id, hourlyRate: money(repo.tarifaMinor, repo.cliente.currency),
        effectiveFrom: new Date(hoy.getTime() - 86_400_000 * 365), effectiveTo: null,
      });
    }
  }
  store.upsertSubscription(db, {
    id: "claude-max", name: "Claude Max", monthlyFee: money(20000, "USD"),
    effectiveFrom: new Date(hoy.getTime() - 86_400_000 * 365), effectiveTo: null,
  });
  db.prepare("UPDATE projects SET ai_budget_micro_usd = ? WHERE id = ?")
    .run(150 * 1e6, "northwind-app");

  const turnos: AgentTurn[] = [];
  const commits: CommitRecord[] = [];
  let n = 0;

  const hora = (dia: Date, minutos: number): Date => {
    const d = new Date(dia);
    d.setHours(0, minutos, entre(0, 59), 0);
    return d;
  };

  for (let i = 0; i <= dias; i++) {
    const dia = new Date(hoy);
    dia.setDate(dia.getDate() - dias + i);
    if (dia.getDay() === 0 || dia.getDay() === 6) continue;

    const sesiones: [number, number][] = [[entre(540, 600), entre(100, 200)]];
    if (rnd() < 0.75) sesiones.push([entre(840, 900), entre(70, 180)]);

    for (const [empieza, dura] of sesiones) {
      const repo = uno(REPOS.flatMap((r) => Array<RepoDemo>(r.peso).fill(r)));
      const rama = uno(repo.ramas);
      const sessionId = `demo-${repo.id}-${i}-${empieza}`;
      let siguienteCommit = empieza + entre(35, 70);

      for (let m = empieza; m < empieza + dura; m += entre(2, 7)) {
        const at = hora(dia, m);
        if (at > ahora) break;
        turnos.push({
          agent: "claude-code", turnId: `demo_turn_${n}`, sessionId, at,
          model: rnd() < 0.25 ? "claude-opus-4-8" : "claude-sonnet-4-6",
          repoPath: RUTA(repo.id), branch: rama,
          tokens: {
            input: entre(2, 40), output: entre(200, 3200),
            cacheRead: entre(30_000, 180_000), cacheWrite5m: entre(1500, 12_000), cacheWrite1h: 0,
          },
          producerVersion: "2.1.4",
        });
        n++;
        if (m >= siguienteCommit) {
          commits.push(commitDemo(repo, rama, at, YO, uno(repo.asuntos), n, entre));
          siguienteCommit = m + entre(35, 75);
        }
      }
    }

    // Los compañeros no usan Estela: solo dejan commits, y sus horas salen
    // estimadas en la vista de equipo. Es justo lo que hay que poder enseñar.
    for (const repo of REPOS) {
      for (const persona of repo.companeros) {
        for (let k = 0, veces = rnd() < 0.8 ? entre(0, 3) : 0; k < veces; k++) {
          const at = hora(dia, entre(540, 1080));
          if (at > ahora) continue;
          commits.push(commitDemo(repo, uno(repo.ramas), at, persona, uno(repo.asuntos), ++n, entre));
        }
      }
    }
  }

  store.saveTurns(db, turnos);
  store.saveCommits(db, commits);
  for (const repo of REPOS) {
    store.setProjectAuthors(db, repo.id, [YO.email]);
  }

  // El pipeline de verdad, el mismo que usa `estela import`.
  const mios = commits.filter((c) => c.authorEmail === YO.email);
  const conAgente = attachCommits(sessionize(turnos), mios);
  const soloCommits = withoutOverlap(sessionizeCommits(mios), conAgente);
  const bloques = groupByBranchAndDay([...conAgente, ...soloCommits],
    (b) => (b.repoPath ? store.projectForRepo(db, b.repoPath) ?? b.repoPath : ""));

  for (const bloque of bloques) {
    const projectId = bloque.repoPath ? store.projectForRepo(db, bloque.repoPath) : null;
    if (!projectId) continue;
    const proyecto = store.getProject(db, projectId)!;
    const dia = localDate(bloque.startedAt);
    const entrada: Omit<TimeEntry, "id"> = {
      projectId, startedAt: bloque.startedAt, endedAt: bloque.endedAt, seconds: bloque.seconds,
      description: describeBlock(bloque), billable: proyecto.billable, invoiceId: null,
      aiCost: bloque.aiCost, agentSeconds: bloque.turnCount > 0 ? bloque.seconds : 0,
      commitHashes: bloque.commits.map((c) => c.hash),
      agents: bloque.turnCount > 0 ? ["claude-code"] : [],
      source: bloque.turnCount > 0 ? "agent" : "commit",
      kind: "development", branch: bloque.branch,
    };
    const slug = (bloque.branch ?? "sin-rama").replace(/[^a-zA-Z0-9]+/g, "-");
    store.saveTimeEntry(db, { ...entrada, id: `te_${projectId}_${dia}_${slug}` });
  }

  // Horas que ningún import deduce: las reuniones de los lunes.
  for (const hace of [7, 14, 21, 28]) {
    const d = new Date(hoy.getTime() - 86_400_000 * hace);
    while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
    if (d > ahora) continue;
    d.setHours(10, 0, 0, 0);
    store.saveTimeEntry(db, {
      id: `te_demo_meeting_${hace}`, projectId: "northwind-app", startedAt: d,
      endedAt: new Date(d.getTime() + 3_600_000), seconds: 3600,
      description: tr`Seguimiento semanal con Northwind`, billable: true, invoiceId: null,
      aiCost: { microUsd: 0 }, agentSeconds: 0, commitHashes: [], agents: [],
      source: "manual", kind: "meeting", branch: null,
    });
  }

  // Lo de hace más de tres días, ya revisado: es como está una instalación
  // después de unas semanas de uso, no recién importada.
  const corte = localDate(new Date(hoy.getTime() - 86_400_000 * 3));
  db.prepare("UPDATE time_entries SET approved = 1 WHERE local_date < ?").run(corte);
}

function commitDemo(
  repo: RepoDemo, rama: string, at: Date, autor: { name: string; email: string },
  asunto: string, n: number, entre: (a: number, b: number) => number,
): CommitRecord {
  return {
    repoPath: RUTA(repo.id), hash: `d${String(n).padStart(6, "0")}${repo.id.slice(0, 2)}`,
    at, authorEmail: autor.email, authorName: autor.name, branch: rama, subject: asunto,
    linesAdded: entre(3, 180), linesDeleted: entre(0, 90), files: [],
  };
}
