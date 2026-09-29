import type { AiCost, TimeEntry } from "@estela/shared";
import { formatDuration } from "@estela/shared";

import { getLang, tr } from "../i18n/index.js";
import { resolvePrice } from "../pricing/catalog.js";
import { ADVANCE, drawText, GLYPH_H, textWidth } from "./pixelfont.js";
import { Lienzo } from "./png.js";

/**
 * `estela receipt`: un ticket en PNG con lo que dejó tu trabajo.
 *
 * Todo se calcula y se pinta en esta máquina, y el fichero se queda en disco:
 * compartirlo es decisión de quien lo tiene. Por eso lleva lo que ya enseña el
 * panel local (horas medidas frente a estimadas, lo que costó la IA) y nada
 * que no se pueda ver ahí.
 */

/** Lo que hace falta de un turno de agente para saber cuánto ahorró la caché. */
export interface ReceiptTurn {
  readonly at: Date;
  readonly model: string;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

export interface ReceiptInput {
  readonly entries: readonly TimeEntry[];
  readonly projectNames: ReadonlyMap<string, string>;
  readonly turns: readonly ReceiptTurn[];
  /** Desde cuándo; null = desde el primer bloque. */
  readonly from: Date | null;
  /** Hasta cuándo, sin incluir. */
  readonly to: Date;
}

export interface ReceiptData {
  readonly from: Date;
  /** Último día incluido. */
  readonly to: Date;
  readonly measuredSeconds: number;
  readonly estimatedSeconds: number;
  readonly manualSeconds: number;
  /** Consumo de IA a tarifa API. */
  readonly aiCost: AiCost;
  readonly topProject: { readonly name: string; readonly cost: AiCost } | null;
  readonly topFeature: { readonly name: string; readonly project: string; readonly cost: AiCost } | null;
  /** Lo que se habría pagado sin caché, menos lo que se pagó con ella. Nunca negativo. */
  readonly cacheSavings: AiCost;
}

export function receiptData(input: ReceiptInput): ReceiptData {
  const dentro = input.entries.filter((e) =>
    (!input.from || e.startedAt >= input.from) && e.startedAt < input.to);
  const from = input.from ?? (dentro.length
    ? new Date(Math.min(...dentro.map((e) => e.startedAt.getTime()))) : input.to);

  const suma = (fuente: TimeEntry["source"]) =>
    dentro.filter((e) => e.source === fuente).reduce((n, e) => n + e.seconds, 0);

  const porProyecto = new Map<string, number>();
  const porRama = new Map<string, { project: string; micro: number }>();
  for (const e of dentro) {
    porProyecto.set(e.projectId, (porProyecto.get(e.projectId) ?? 0) + e.aiCost.microUsd);
    if (!e.branch) continue;
    const clave = `${e.projectId}\u0000${e.branch}`;
    const previo = porRama.get(clave);
    porRama.set(clave, { project: e.projectId, micro: (previo?.micro ?? 0) + e.aiCost.microUsd });
  }
  const nombre = (id: string) => input.projectNames.get(id) ?? id;

  const [pId, pMicro] = [...porProyecto].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const [rClave, r] = [...porRama].sort((a, b) => b[1].micro - a[1].micro)[0] ?? [null, null];

  let ahorro = 0;
  for (const t of input.turns) {
    if ((input.from && t.at < input.from) || t.at >= input.to) continue;
    const precio = resolvePrice(t.model, t.at);
    if (!precio) continue;
    const porToken = precio.inputPerMTok / 1_000_000;
    // Leer de caché cuesta una fracción del precio de entrada; escribir en
    // ella, algo más. El ahorro es lo primero menos lo segundo.
    ahorro += t.cacheRead * porToken * (1 - precio.cacheReadMultiplier)
      - t.cacheWrite5m * porToken * (precio.cacheWrite5mMultiplier - 1)
      - t.cacheWrite1h * porToken * (precio.cacheWrite1hMultiplier - 1);
  }

  return {
    from,
    to: new Date(input.to.getTime() - 1),
    measuredSeconds: suma("agent"),
    estimatedSeconds: suma("commit"),
    manualSeconds: suma("manual"),
    aiCost: { microUsd: dentro.reduce((n, e) => n + e.aiCost.microUsd, 0) },
    topProject: pId && pMicro > 0 ? { name: nombre(pId), cost: { microUsd: pMicro } } : null,
    topFeature: rClave && r && r.micro > 0
      ? { name: rClave.split("\u0000")[1]!, project: nombre(r.project), cost: { microUsd: r.micro } }
      : null,
    cacheSavings: { microUsd: Math.max(0, Math.round(ahorro * 1_000_000)) },
  };
}

// ── Pintarlo ────────────────────────────────────────────────────────────

type Color = readonly [number, number, number];
const FONDO: Color = [0xE6, 0xEA, 0xE5];
const PAPEL: Color = [0xFF, 0xFD, 0xF8];
const TINTA: Color = [0x1E, 0x24, 0x21];
const TENUE: Color = [0x9A, 0xA2, 0x9D];
const JADE: Color = [0x0E, 0x7C, 0x6B];

const S = 3;            // escala del texto normal
const COLS = 34;        // caracteres por línea, como un ticket de 80 mm
const PAD = 44;         // margen interior del papel
const MARGEN = 28;      // fondo alrededor del papel
const DIENTE = 12;      // el borde dentado de arriba y abajo
const LINEA = GLYPH_H * S + 14;

type Fila =
  | { t: "titulo"; texto: string }
  | { t: "centro"; texto: string; color?: Color }
  | { t: "par"; izq: string; der: string; negrita?: boolean; sangria?: boolean }
  | { t: "texto"; texto: string; color?: Color }
  | { t: "barra"; parte: number; etiqueta: string }
  | { t: "corte" }
  | { t: "hueco" };

function fecha(d: Date): string {
  const lang = getLang();
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es-ES", { day: "numeric", month: "short" })
    .replace(".", "").toUpperCase();
}

/** Dólares con dos decimales y separador de miles: "$42,999.71" se lee; "$42999.71" no. */
function dolares(cost: AiCost): string {
  return "$" + (cost.microUsd / 1_000_000).toLocaleString("en-US",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function recortar(texto: string, max: number): string {
  const letras = [...texto];
  // Sin "…": la fuente no lo tiene, y un punto se entiende igual en un ticket.
  return letras.length <= max ? texto : letras.slice(0, Math.max(1, max - 1)).join("") + ".";
}

function filas(d: ReceiptData, semana: boolean, nombres: boolean): Fila[] {
  const total = d.measuredSeconds + d.estimatedSeconds + d.manualSeconds;
  const rango = `${fecha(d.from)} – ${fecha(d.to)} ${d.to.getFullYear()}`;
  const f: Fila[] = [
    { t: "titulo", texto: "ESTELA" },
    { t: "centro", texto: semana ? tr`RECIBO DE LA SEMANA` : tr`RECIBO DE TU HISTORIAL` },
    { t: "centro", texto: rango, color: TENUE },
    { t: "corte" },
    { t: "par", izq: tr`HORAS MEDIDAS`, der: formatDuration(d.measuredSeconds) },
    { t: "par", izq: tr`HORAS ESTIMADAS`, der: formatDuration(d.estimatedSeconds) },
  ];
  if (d.manualSeconds > 0) f.push({ t: "par", izq: tr`AÑADIDAS A MANO`, der: formatDuration(d.manualSeconds) });
  f.push({ t: "par", izq: tr`TOTAL`, der: formatDuration(total), negrita: true });
  if (total > 0) {
    const parte = d.measuredSeconds / total;
    f.push({ t: "barra", parte, etiqueta: tr`${`${Math.round(parte * 100)}%`} MEDIDO` });
  }
  f.push({ t: "corte" });

  if (d.aiCost.microUsd > 0) {
    // La aclaración va en su línea: al lado del importe no cabe cuando pasa de mil.
    f.push({ t: "par", izq: tr`COSTE DE IA`, der: dolares(d.aiCost), negrita: true });
    f.push({ t: "texto", texto: tr`(A TARIFA API)`, color: TENUE });
    if (d.cacheSavings.microUsd > 0) {
      f.push({ t: "par", izq: tr`AHORRO POR CACHÉ`, der: dolares(d.cacheSavings) });
    }
    // Sin nombres salvo que se pidan: un recibo está hecho para enseñarse, y
    // el nombre de un proyecto suele ser el de un cliente. Publicarlo diría
    // para quién trabaja quien lo comparte.
    if (d.topProject) {
      f.push({ t: "hueco" });
      if (nombres) {
        f.push({ t: "texto", texto: tr`PROYECTO MÁS CARO`, color: TENUE });
        f.push({ t: "par", izq: d.topProject.name, der: dolares(d.topProject.cost), sangria: true });
      } else {
        f.push({ t: "par", izq: tr`PROYECTO MÁS CARO`, der: dolares(d.topProject.cost) });
      }
    }
    if (d.topFeature) {
      if (nombres) {
        f.push({ t: "texto", texto: tr`RAMA MÁS CARA`, color: TENUE });
        f.push({ t: "par", izq: d.topFeature.name, der: dolares(d.topFeature.cost), sangria: true });
      } else {
        f.push({ t: "par", izq: tr`RAMA MÁS CARA`, der: dolares(d.topFeature.cost) });
      }
    }
  } else {
    f.push({ t: "centro", texto: tr`SIN CONSUMO DE IA`, color: TENUE });
  }

  f.push({ t: "corte" },
    { t: "centro", texto: tr`HORAS QUE NO TUVISTE QUE RELLENAR`, color: TENUE },
    { t: "hueco" },
    { t: "centro", texto: "getestela.dev", color: JADE });
  return f;
}

function alto(f: Fila): number {
  switch (f.t) {
    case "titulo": return GLYPH_H * 7 + 22;
    case "corte": return 34;
    case "hueco": return 12;
    case "barra": return LINEA + 10;
    default: return LINEA;
  }
}

/** El texto de cada línea del recibo, tal como se pinta. Para los tests. */
export function receiptText(d: ReceiptData, options: { week: boolean; names?: boolean }): string[] {
  return filas(d, options.week, options.names === true).flatMap((f) =>
    f.t === "par" ? [`${f.izq} ${f.der}`] : "texto" in f ? [f.texto] : []);
}

export function renderReceipt(d: ReceiptData, options: { week: boolean; names?: boolean }): Buffer {
  const lista = filas(d, options.week, options.names === true);
  const anchoTexto = COLS * ADVANCE * S;
  const anchoPapel = anchoTexto + PAD * 2;
  const altoPapel = PAD + DIENTE + lista.reduce((n, f) => n + alto(f), 0) + PAD;
  const lienzo = new Lienzo(anchoPapel + MARGEN * 2, altoPapel + MARGEN * 2, FONDO);

  // El papel, con los bordes de arriba y abajo en dientes de sierra: el corte
  // de la impresora.
  const x0 = MARGEN, y0 = MARGEN;
  lienzo.rect(x0, y0, anchoPapel, altoPapel, PAPEL);
  for (let x = 0; x < anchoPapel; x++) {
    const h = Math.abs((x % (DIENTE * 2)) - DIENTE);
    lienzo.rect(x0 + x, y0, 1, h, FONDO);
    lienzo.rect(x0 + x, y0 + altoPapel - h, 1, h, FONDO);
  }

  const izq = x0 + PAD;
  let y = y0 + PAD + DIENTE;
  const centrado = (texto: string, escala: number) => x0 + Math.round((anchoPapel - textWidth(texto, escala)) / 2);

  for (const f of lista) {
    switch (f.t) {
      case "titulo":
        drawText(lienzo, f.texto, centrado(f.texto, 7), y, 7, JADE, true);
        break;
      case "centro": {
        const texto = recortar(f.texto, COLS);
        drawText(lienzo, texto, centrado(texto, S), y, S, f.color ?? TINTA);
        break;
      }
      case "texto":
        drawText(lienzo, recortar(f.texto, COLS), izq, y, S, f.color ?? TINTA);
        break;
      case "par": {
        const sangria = f.sangria ? 2 : 0;
        const der = f.der;
        const max = COLS - sangria - [...der].length - 2;
        const etiqueta = recortar(f.izq, max);
        drawText(lienzo, etiqueta, izq + sangria * ADVANCE * S, y, S, TINTA, f.negrita);
        drawText(lienzo, der, izq + anchoTexto - textWidth(der, S), y, S, TINTA, f.negrita);
        // Puntos de relleno entre la etiqueta y el importe, como en un ticket.
        const desde = sangria + [...etiqueta].length + 1;
        const hasta = COLS - [...der].length - 1;
        for (let c = desde; c < hasta; c++) {
          lienzo.rect(izq + c * ADVANCE * S + 2 * S, y + 8 * S, S, S, TENUE);
        }
        break;
      }
      case "barra": {
        const ancho = anchoTexto - textWidth(f.etiqueta, S) - ADVANCE * S;
        const lleno = Math.round(ancho * Math.min(1, Math.max(0, f.parte)));
        const by = y + 3 * S;
        lienzo.rect(izq, by, ancho, 5 * S, [0xE4, 0xE8, 0xE3]);
        lienzo.rect(izq, by, lleno, 5 * S, JADE);
        drawText(lienzo, f.etiqueta, izq + anchoTexto - textWidth(f.etiqueta, S), y, S, JADE);
        break;
      }
      case "corte":
        for (let x = 0; x < anchoTexto; x += 12) lienzo.rect(izq + x, y + 15, 6, 2, TENUE);
        break;
      case "hueco":
        break;
    }
    y += alto(f);
  }
  return lienzo.png();
}
