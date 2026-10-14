import { tr } from "./i18n/index.js";

/**
 * `estela statusline`: la línea que Claude Code pinta bajo cada sesión.
 *
 * Funciones puras, sin disco ni base de datos: qué llega por stdin, qué se
 * enseña y cómo se recorta. Lo que lee datos vive en `statusline-run.ts`.
 *
 * La regla de siempre: nada de "te queda X" ni cuentas atrás. Los porcentajes
 * de límite son los que manda Claude Code (`rate_limits`), tal cual; si no
 * los manda, no se enseña nada de límites. Estela no estima ninguno.
 */

/** Lo que interesa del JSON que Claude Code pasa por stdin. Todo opcional. */
export interface StatusInput {
  readonly dir: string | null;
  readonly transcriptPath: string | null;
  /** 0–100, de `rate_limits.five_hour.used_percentage`. */
  readonly fiveHour: number | null;
  /** 0–100, de `rate_limits.seven_day.used_percentage`. */
  readonly sevenDay: number | null;
  /**
   * `rate_limits.five_hour.resets_at`. No se enseña nunca (nada de cuentas
   * atrás): se guarda para que `estela quota` sepa dónde empieza la ventana.
   */
  readonly fiveHourResetsAt?: Date | null;
}

/**
 * Lee la entrada. Lanza si no es un objeto JSON: quien llama imprime
 * "estela" y sale con 0, que es lo que hay que hacer con una entrada rota.
 */
export function parseStatusInput(text: string): StatusInput {
  const raw = JSON.parse(text) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("bad-input");
  const o = raw as Record<string, unknown>;
  const ws = obj(o["workspace"]);
  const limits = obj(o["rate_limits"]);
  return {
    dir: str(ws["project_dir"]) ?? str(ws["current_dir"]) ?? str(o["cwd"]),
    transcriptPath: str(o["transcript_path"]),
    fiveHour: pct(obj(limits["five_hour"])["used_percentage"]),
    sevenDay: pct(obj(limits["seven_day"])["used_percentage"]),
    fiveHourResetsAt: epoch(obj(limits["five_hour"])["resets_at"]),
  };
}

/** Segundos desde 1970 (lo que manda Claude Code); por si acaso, también milisegundos. */
function epoch(v: unknown): Date | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v > 1e12 ? v : v * 1000);
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
function pct(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(v, 100) : null;
}

/** Lo que se sabe del proyecto del directorio actual. */
export interface StatusData {
  /** null: el directorio no es de ningún proyecto de Estela. */
  readonly project: { readonly name: string; readonly client: string | null } | null;
  /**
   * Sin proyecto: el nombre de la raíz git de la carpeta, para decir cuál
   * es. null si está fuera de git.
   */
  readonly unassignedRoot?: string | null;
  /** Horas medidas hoy en este proyecto. */
  readonly todaySeconds: number;
  /** Parte de los tokens de Claude Code de esta semana que son de este proyecto (0–1), o null si no hubo consumo. */
  readonly projectShare: number | null;
  readonly fiveHour: number | null;
  readonly sevenDay: number | null;
}

export interface RenderOptions {
  /** Ancho del terminal (`COLUMNS`). Sin él, no se recorta. */
  readonly columns?: number | null;
  readonly color?: boolean;
  /** Ancho que ya ocupa otra status line encadenada con --append. */
  readonly reserved?: number;
}

/** Desde qué porcentaje la ventana de 5 h se pinta en ámbar. */
export const FIVE_HOUR_WARN = 80;

const SEP = " · ";
const ESC = "\x1b[";
const JADE = `${ESC}38;2;70;192;167m`;   // #46C0A7
const GRAY = `${ESC}90m`;
const AMBER = `${ESC}38;2;221;168;90m`;   // el ámbar del panel en modo oscuro
const RESET = `${ESC}0m`;

type Key = "today" | "project" | "week" | "fiveHour";
interface Segment { readonly key: Key; readonly text: string; readonly warn?: boolean }

/** "2h14", "3h", "45m": corto, que la línea es estrecha. */
export function compactDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60), m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * La línea, ya recortada al ancho.
 *
 * Orden visual: estela · nombre · hoy · este proyecto · semana · 5 h.
 * Lo que se quita si no cabe, en este orden: la 5 h, la semana, el nombre se
 * queda en el cliente y luego se acorta con "…", "este proyecto" y "hoy".
 * "estela" no se quita nunca: es lo que anuncia la herramienta en cada captura.
 */
export function renderStatus(data: StatusData, options: RenderOptions = {}): string {
  const color = options.color !== false;
  const paint = (c: string, t: string) => (color ? `${c}${t}${RESET}` : t);
  const width = options.columns && options.columns > 0
    ? Math.max(0, options.columns - (options.reserved ?? 0)) : Infinity;

  if (!data.project) {
    // Fuera de git no hay nombre que dar ni nada que configurar ahí.
    const root = data.unassignedRoot ?? null;
    if (!root) {
      const line = `${SEP}${tr`sin proyecto`}`;
      return "estela".length + line.length <= width ? paint(JADE, "estela") + paint(GRAY, line) : paint(JADE, "estela");
    }
    // Un repo sin proyecto: "estela · web sin proyecto · estela setup". Lo
    // primero que se va es la pista; luego se acorta el nombre de la raíz.
    const withHint = `${SEP}${tr`${root} (sin proyecto)`}${SEP}estela setup`;
    if ("estela".length + withHint.length <= width) return paint(JADE, "estela") + paint(GRAY, withHint);
    const sinRoot = tr`${""} (sin proyecto)`;
    const room = width - "estela".length - SEP.length - sinRoot.length;
    if (room >= 2) {
      const r = root.length <= room ? root : root.slice(0, room - 1).trimEnd() + "…";
      return paint(JADE, "estela") + paint(GRAY, `${SEP}${tr`${r} (sin proyecto)`}`);
    }
    return paint(JADE, "estela");
  }

  const segs: Segment[] = [{ key: "today", text: tr`hoy ${compactDuration(data.todaySeconds)}` }];
  if (data.projectShare !== null) segs.push({ key: "project", text: tr`este proyecto ${Math.round(data.projectShare * 100)} %` });
  if (data.sevenDay !== null) segs.push({ key: "week", text: tr`semana ${Math.round(data.sevenDay)} %` });
  if (data.fiveHour !== null) {
    segs.push({ key: "fiveHour", text: tr`5 h ${Math.round(data.fiveHour)} %`, warn: data.fiveHour >= FIVE_HOUR_WARN });
  }

  const { name, client } = data.project;
  const full = client ? `${client} › ${name}` : name;
  const short = client ?? name;

  // Cada paso es un intento: el primero que cabe, gana.
  type Step = { readonly drop: readonly Key[]; readonly name: "full" | "short" | "trunc"; readonly min?: number };
  const steps: Step[] = [
    { drop: [], name: "full" },
    { drop: ["fiveHour"], name: "full" },
    { drop: ["fiveHour", "week"], name: "full" },
    { drop: ["fiveHour", "week"], name: "short" },
    { drop: ["fiveHour", "week"], name: "trunc", min: 6 },
    { drop: ["fiveHour", "week", "project"], name: "trunc", min: 6 },
    { drop: ["fiveHour", "week", "project", "today"], name: "trunc", min: 2 },
  ];

  for (const step of steps) {
    const kept = segs.filter((s) => !step.drop.includes(s.key));
    const tail = kept.map((s) => SEP + s.text).join("");
    const fixed = "estela".length + SEP.length + tail.length;
    let shown: string;
    if (step.name === "full") shown = full;
    else if (step.name === "short") shown = short;
    else {
      const room = width - fixed;
      if (room < (step.min ?? 1)) continue;
      shown = short.length <= room ? short : short.slice(0, Math.max(0, room - 1)).trimEnd() + "…";
    }
    if (fixed + shown.length > width) continue;
    return paint(JADE, "estela") + paint(GRAY, SEP + shown) +
      kept.map((s) => paint(GRAY, SEP) + paint(s.warn ? AMBER : GRAY, s.text)).join("");
  }
  return paint(JADE, "estela");
}

/** Lo visible de una cadena con color: para medir y para los tests. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
