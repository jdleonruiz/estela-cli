import type { AgentTurn, AiCost, CommitRecord } from "@estela/shared";
import { localDate } from "@estela/shared";
import { costOfTurn } from "../pricing/cost.js";
import { tr } from "../i18n/index.js";

/**
 * Agrupa turnos sueltos en bloques de trabajo continuo.
 *
 * Un turno de agente es un instante, no una duración: el transcript dice cuándo
 * respondió el modelo, no cuánto tiempo estuviste tú trabajando. La duración se
 * infiere del hueco entre turnos consecutivos.
 *
 * Dos parámetros gobiernan la inferencia y ambos son conservadores a propósito,
 * porque estas horas acaban en una factura:
 *
 *  - `gapMinutes`: hueco a partir del cual se considera que te fuiste. Por
 *    debajo se cuenta como trabajo continuo (estabas leyendo la respuesta o
 *    probando la app, que es trabajo real aunque no haya tecleo).
 *  - `tailMinutes`: cuánto se imputa después del último turno del bloque. Sin
 *    esto, un bloque de un solo turno duraría cero.
 *
 * Redondear a tu favor aquí es facturarle de más a un cliente. Ante la duda,
 * estos valores subestiman.
 */
export interface SessionizeOptions {
  readonly gapMinutes?: number;
  readonly tailMinutes?: number;
}

export interface WorkBlock {
  readonly startedAt: Date;
  readonly endedAt: Date;
  readonly seconds: number;
  readonly repoPath: string | null;
  readonly branch: string | null;
  readonly turnCount: number;
  readonly aiCost: AiCost;
  readonly models: readonly string[];
  readonly sessionIds: readonly string[];
  /** Commits que caen dentro del bloque. Se rellena con `attachCommits`. */
  readonly commits: readonly CommitRecord[];
  /** Modelos sin precio en el catálogo. Si no está vacío, el coste es parcial. */
  readonly unpricedModels: readonly string[];
}

const DEFAULT_GAP_MINUTES = 30;
const DEFAULT_TAIL_MINUTES = 2;

export function sessionize(
  turns: readonly AgentTurn[],
  options: SessionizeOptions = {},
): WorkBlock[] {
  const gapMs = (options.gapMinutes ?? DEFAULT_GAP_MINUTES) * 60_000;
  const tailMs = (options.tailMinutes ?? DEFAULT_TAIL_MINUTES) * 60_000;

  // Un bloque no puede cruzar de repositorio: son trabajos distintos aunque
  // ocurran seguidos.
  const byRepo = new Map<string, AgentTurn[]>();
  for (const turn of turns) {
    const key = turn.repoPath ?? "";
    const bucket = byRepo.get(key);
    if (bucket) bucket.push(turn);
    else byRepo.set(key, [turn]);
  }

  const blocks: WorkBlock[] = [];

  for (const bucket of byRepo.values()) {
    bucket.sort((a, b) => a.at.getTime() - b.at.getTime());

    let current: AgentTurn[] = [];
    const flush = () => {
      if (current.length) blocks.push(buildBlock(current, tailMs));
      current = [];
    };

    for (const turn of bucket) {
      const previous = current[current.length - 1];
      if (previous && turn.at.getTime() - previous.at.getTime() > gapMs) flush();
      current.push(turn);
    }
    flush();
  }

  return blocks.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

function buildBlock(turns: readonly AgentTurn[], tailMs: number): WorkBlock {
  const first = turns[0]!;
  const last = turns[turns.length - 1]!;

  const startedAt = first.at;
  const endedAt = new Date(last.at.getTime() + tailMs);

  let microUsd = 0;
  const models = new Set<string>();
  const unpriced = new Set<string>();
  const sessionIds = new Set<string>();

  for (const turn of turns) {
    models.add(turn.model);
    sessionIds.add(turn.sessionId);
    const cost = costOfTurn(turn.tokens, turn.model, turn.at);
    if (cost) microUsd += cost.microUsd;
    else unpriced.add(turn.model);
  }

  return {
    startedAt,
    endedAt,
    seconds: Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
    repoPath: first.repoPath,
    branch: last.branch ?? first.branch,
    turnCount: turns.length,
    aiCost: { microUsd },
    models: [...models].sort(),
    sessionIds: [...sessionIds],
    commits: [],
    unpricedModels: [...unpriced].sort(),
  };
}

/**
 * Fusiona bloques del mismo día y la misma rama en un solo concepto.
 *
 * Sin esto, una jornada normal produce veinte líneas de "3m", "2m", "1h 11m"
 * porque cada pausa para pensar parte el bloque. Eso es ruido para quien recibe
 * la factura y para ti al revisarla: lo que hiciste ese día en esa rama es *una*
 * cosa, aunque la hicieras en tandas.
 *
 * El detalle no se pierde: los bloques originales siguen siendo la fuente y esta
 * agrupación solo cambia cómo se presentan.
 *
 * `ambito` decide qué cuenta como "el mismo sitio", y quien llama tiene que
 * pasar el PROYECTO, no dejar la ruta por defecto. Abrir el agente en
 * `repo/src/UI` y en `repo/` son dos rutas y un solo proyecto: agrupando por
 * ruta salen dos bloques que después se guardan con el mismo identificador
 * —proyecto, día y rama— y se pisan el uno al otro, así que solo sobrevive el
 * último. Ahí se perdían horas de verdad, en silencio: un día con 1h 10m
 * medidas quedó guardado como 3m porque el agente se había abierto desde tres
 * carpetas distintas del mismo repositorio.
 */
export function groupByBranchAndDay(
  blocks: readonly WorkBlock[],
  ambito: (block: WorkBlock) => string = (b) => b.repoPath ?? "",
): WorkBlock[] {
  const groups = new Map<string, WorkBlock[]>();

  for (const block of blocks) {
    const day = localDate(block.startedAt);
    // El separador va escapado, no como byte crudo: un NUL de verdad en el
    // fuente vuelve el fichero binario para grep, los diffs y las
    // herramientas de edicion.
    const key = `${ambito(block)}\0${day}\0${block.branch ?? ""}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(block);
    else groups.set(key, [block]);
  }

  const merged: WorkBlock[] = [];

  for (const bucket of groups.values()) {
    bucket.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    const first = bucket[0]!;
    const last = bucket[bucket.length - 1]!;

    // Ni el lapso de principio a fin —entre bloques hubo huecos en los que no
    // estabas trabajando, y facturarlos sería cobrar de más— ni la suma de
    // duraciones: los segundos de un bloque SON su intervalo de reloj, y dos
    // sesiones abiertas a la vez en dos carpetas del mismo repositorio se
    // solapan. Sumarlas cobraría dos veces el mismo rato. Se unen los
    // intervalos: cuando no se solapan, la unión y la suma dan lo mismo.
    const intervalos = bucket
      .map((b) => [b.startedAt.getTime(), b.endedAt.getTime()] as const)
      .sort((a, b) => a[0] - b[0]);
    let ms = 0;
    let hasta = -Infinity;
    for (const [ini, fin] of intervalos) {
      const desde = Math.max(ini, hasta);
      if (fin > desde) ms += fin - desde;
      hasta = Math.max(hasta, fin);
    }
    const seconds = Math.round(ms / 1000);

    const commits = bucket.flatMap((b) => b.commits);
    const models = new Set<string>();
    const sessionIds = new Set<string>();
    const unpriced = new Set<string>();
    for (const b of bucket) {
      for (const m of b.models) models.add(m);
      for (const s of b.sessionIds) sessionIds.add(s);
      for (const u of b.unpricedModels) unpriced.add(u);
    }

    merged.push({
      startedAt: first.startedAt,
      endedAt: last.endedAt,
      seconds,
      repoPath: first.repoPath,
      branch: first.branch,
      turnCount: bucket.reduce((sum, b) => sum + b.turnCount, 0),
      aiCost: { microUsd: bucket.reduce((sum, b) => sum + b.aiCost.microUsd, 0) },
      models: [...models].sort(),
      sessionIds: [...sessionIds],
      commits,
      unpricedModels: [...unpriced].sort(),
    });
  }

  return merged.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/**
 * Título de un bloque para la línea de factura.
 *
 * Los commits mandan: son lo único que describe el trabajo con palabras que
 * escribiste tú. Sin commits se cae a la rama, que al menos nombra la tarea.
 */
export function describeBlock(block: WorkBlock): string {
  const subjects = [...new Set(block.commits.map((c) => c.subject).filter(Boolean))];

  if (subjects.length === 1) return subjects[0]!;
  if (subjects.length > 1) {
    return tr`${subjects[0]} (+${subjects.length - 1} commits más)`;
  }

  const branch = block.branch?.replace(/^(feature|feat|fix|chore)\//, "") ?? null;
  return branch ? tr`Desarrollo en ${branch}` : "Desarrollo";
}

/**
 * Asocia commits a bloques por solapamiento temporal.
 *
 * La correlación es por tiempo, autor y repositorio. No se toca el mensaje del
 * commit ni se instala ningún hook: un identificador inyectado en el historial
 * de git es irreversible una vez subido, y el solapamiento temporal basta.
 *
 * Un commit puede caer justo después del último turno (cierras el bloque y
 * commiteas), así que se admite un margen posterior.
 */
export function attachCommits(
  blocks: readonly WorkBlock[],
  commits: readonly CommitRecord[],
  graceMinutes = 10,
): WorkBlock[] {
  const graceMs = graceMinutes * 60_000;

  return blocks.map((block) => {
    const matched = commits.filter((commit) => {
      if (block.repoPath && !commit.repoPath.startsWith(block.repoPath) &&
          !block.repoPath.startsWith(commit.repoPath)) {
        return false;
      }
      const t = commit.at.getTime();
      return t >= block.startedAt.getTime() && t <= block.endedAt.getTime() + graceMs;
    });
    return matched.length ? { ...block, commits: matched } : block;
  });
}

/**
 * Bloques de trabajo deducidos solo de los commits.
 *
 * Para quien programa sin agente de IA, los commits son el único rastro que
 * queda. Pero el modelo es distinto al de los turnos: un turno marca un
 * instante *dentro* del trabajo, así que el tiempo se infiere del hueco entre
 * turnos consecutivos. Un commit marca el *final* de un tramo, y lo trabajado
 * está antes de él.
 *
 * De ahí las dos reglas:
 *
 *  - Los commits próximos entre sí forman una tanda. Dentro de la tanda, el
 *    tiempo entre commits sí es trabajo.
 *  - Antes del primer commit de la tanda se imputa `leadInMinutes`. Cuánto se
 *    trabajó realmente antes de ese commit es indeducible, así que el valor por
 *    defecto es corto a propósito: estas horas acaban en una factura y
 *    quedarse corto es preferible a cobrar de más.
 *
 * El resultado es menos preciso que el deducido de un agente, y conviene que
 * quien lo use lo sepa.
 */
export function sessionizeCommits(
  commits: readonly CommitRecord[],
  options: { gapMinutes?: number; leadInMinutes?: number } = {},
): WorkBlock[] {
  const gapMs = (options.gapMinutes ?? 90) * 60_000;
  const leadInMs = (options.leadInMinutes ?? 25) * 60_000;

  const byRepo = new Map<string, CommitRecord[]>();
  for (const commit of commits) {
    const bucket = byRepo.get(commit.repoPath);
    if (bucket) bucket.push(commit);
    else byRepo.set(commit.repoPath, [commit]);
  }

  const blocks: WorkBlock[] = [];

  for (const [repoPath, bucket] of byRepo) {
    bucket.sort((a, b) => a.at.getTime() - b.at.getTime());

    let run: CommitRecord[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const first = run[0]!;
      const last = run[run.length - 1]!;
      const startedAt = new Date(first.at.getTime() - leadInMs);

      blocks.push({
        startedAt,
        endedAt: last.at,
        seconds: Math.round((last.at.getTime() - startedAt.getTime()) / 1000),
        repoPath,
        branch: last.branch ?? first.branch,
        turnCount: 0,
        aiCost: { microUsd: 0 },
        models: [],
        sessionIds: [],
        commits: [...run],
        unpricedModels: [],
      });
      run = [];
    };

    for (const commit of bucket) {
      const previous = run[run.length - 1];
      if (previous && commit.at.getTime() - previous.at.getTime() > gapMs) flush();
      run.push(commit);
    }
    flush();
  }

  return blocks.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}

/**
 * Quita los bloques de commits que se solapan con trabajo ya deducido de un
 * agente.
 *
 * Sin esto se contaría dos veces el mismo rato: el agente ya cubrió esas horas
 * y el commit que las cerró generaría otro bloque encima.
 */
export function withoutOverlap(
  commitBlocks: readonly WorkBlock[],
  agentBlocks: readonly WorkBlock[],
): WorkBlock[] {
  return commitBlocks.filter((c) => !agentBlocks.some((a) =>
    a.repoPath === c.repoPath &&
    a.startedAt.getTime() < c.endedAt.getTime() &&
    c.startedAt.getTime() < a.endedAt.getTime()));
}
