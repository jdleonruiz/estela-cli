import { randomBytes } from "node:crypto";

import type { AiPayer, Client, CommitRecord, Project, TimeEntry } from "@estela/shared";
import {
  formatDuration, formatMoney, localDate, type Money,
} from "@estela/shared";
import { localizeDescription } from "../billing/localize.js";
import { getLang, moneyLocale, tr } from "../i18n/index.js";
import { kindLabel } from "../i18n/labels.js";
import { cadence, churn, effortByFeature, openWork } from "../metrics/index.js";
import { DAYS, MONTHS } from "./dates.js";

/**
 * Panel de solo lectura, publicable.
 *
 * A diferencia del informe —que es un documento— esto es **el producto**, en
 * modo lectura: se filtra por periodo, se despliegan los días y se ven los
 * commits. Quien lo abre no recibe un adjunto: usa la herramienta. Esa es la
 * diferencia entre "qué informe tan majo" y "esto lo quiero para mi equipo".
 *
 * Sigue siendo un único fichero sin recursos externos, así que se sirve como
 * estático desde cualquier sitio y no depende de ninguna máquina encendida.
 *
 * Reglas de lo que sale y lo que no, iguales que en el informe:
 *  - Nunca el consumo de IA cuando la paga quien publica (ver `AiPayer`).
 *  - Los importes solo si se piden expresamente.
 */

export interface PanelOptions {
  readonly project: Project;
  readonly client: Client;
  readonly entries: readonly TimeEntry[];
  readonly authorName?: string;
  readonly withAmounts?: boolean;
  readonly rateAt?: (at: Date) => Money | null;
  readonly aiPayer?: AiPayer;
  readonly commitsOf?: (hashes: readonly string[]) => readonly { hash: string; subject: string }[];
  /** Momento de generación. Se enseña para que se sepa cómo de fresco es. */
  readonly generatedAt?: Date;
  /** Commits del proyecto. Sin ellos no hay métricas, solo un listado de días. */
  readonly commits?: readonly CommitRecord[];
  /** Ramas ya integradas, para separar trabajo abierto de entregado. */
  readonly merged?: ReadonlySet<string>;
  /**
   * El equipo del proyecto, si se quiere enseñar.
   *
   * Quien recibe este panel es el líder técnico del cliente, y ese repositorio
   * es suyo: los nombres, ramas y commits de su gente ya los tiene con `git
   * log`. Enseñárselos no le regala nada, y demuestra que la herramienta
   * funciona sobre sus datos de verdad.
   *
   * Lo que sí produce Estela y él no puede sacar solo son las **horas**. Por eso
   * `seconds` solo viaja para quien publica el panel. Para los demás no es que
   * se oculte al pintar: **no entra en el fichero**. Un candado de CSS con el
   * dato debajo no es un candado, es una invitación a mirar el código fuente.
   */
  readonly team?: readonly PanelTeamMember[];
  /**
   * A dónde lleva el candado. Por defecto, getestela.dev.
   *
   * Sigue siendo configurable aunque el dominio ya esté comprado: un panel
   * publicado en un entorno de pruebas, o desde una máquina sin este valor
   * actualizado, no debe depender de tener que recordar pasarlo siempre.
   */
  readonly siteUrl?: string;
}

export interface PanelTeamMember {
  readonly name: string;
  readonly isMe: boolean;
  /** Solo si `measured`. Para el resto se omite, no se pone a cero. */
  readonly seconds?: number;
  /** Con Teams, un compañero que instaló Estela también puede llegar medido. */
  readonly measured?: boolean;
  readonly commits: number;
  readonly branches: number;
  readonly lastDay: string;
}

/**
 * Token de acceso.
 *
 * 128 bits en la ruta: una URL publicada es pública para quien la tenga, así
 * que lo único que la protege es que nadie pueda adivinarla. Revocar el acceso
 * es borrar el fichero del servidor — no hay caducidad falsa en el cliente,
 * porque una caducidad que comprueba el navegador no protege de nada.
 */
export function newPanelToken(): string {
  return randomBytes(16).toString("hex");
}

interface DayData {
  date: string;
  seconds: number;
  items: {
    what: string; seconds: number; kind: string;
    amount: string | null;
    commits: { hash: string; subject: string }[];
  }[];
}

/** Las dos últimas partes de la ruta: el fichero se reconoce, el árbol estorba. */
function shortPath(file: string): string {
  return file.split("/").slice(-2).join("/");
}

export function buildPanel(options: PanelOptions): string {
  const { project, client, entries } = options;
  const showAmounts = options.withAmounts === true && options.rateAt !== undefined;

  const included = entries
    .filter((e) => e.billable)
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  const byDay = new Map<string, DayData>();
  let totalSeconds = 0;
  let totalMinor = 0;

  for (const entry of included) {
    const date = localDate(entry.startedAt);
    let day = byDay.get(date);
    if (!day) { day = { date, seconds: 0, items: [] }; byDay.set(date, day); }

    let amount: string | null = null;
    if (showAmounts) {
      const rate = options.rateAt!(entry.startedAt);
      if (rate) {
        const minor = Math.round((rate.amount * entry.seconds) / 3600);
        totalMinor += minor;
        amount = formatMoney({ amount: minor, currency: rate.currency }, moneyLocale(getLang()));
      }
    }

    day.seconds += entry.seconds;
    totalSeconds += entry.seconds;
    day.items.push({
      what: localizeDescription(entry),
      seconds: entry.seconds,
      kind: entry.kind === "development" ? "" : kindLabel(entry.kind),
      amount,
      commits: [...(options.commitsOf?.(entry.commitHashes) ?? [])]
        .map((c) => ({ hash: c.hash.slice(0, 7), subject: c.subject })),
    });
  }

  const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Todo el estado viaja embebido. La página no hace una sola petición.
  // Las métricas se calculan sobre lo mismo que se enseña, para que un número
  // de arriba y el detalle de abajo no puedan contradecirse.
  const commits = options.commits ?? [];
  const merged = options.merged ?? null;

  const features = effortByFeature(included, commits, merged).map((f) => ({
    name: f.name,
    seconds: f.seconds,
    days: f.days,
    merged: f.merged,
    delivered: f.delivered.slice(0, 8),
    moreDelivered: Math.max(0, f.delivered.length - 8),
  }));

  const rhythm = cadence(included);
  const rework = churn(commits, { minTouches: 3, withinDays: 14 }).slice(0, 6)
    .map((f) => ({ file: shortPath(f.file), touches: f.touches, spanDays: f.spanDays }));
  const open = merged
    ? openWork(commits, merged, options.generatedAt ?? new Date()).slice(0, 6)
    : [];

  const data = {
    project: project.name,
    client: client.name,
    author: options.authorName ?? null,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    totalSeconds,
    totalAmount: showAmounts && totalMinor > 0
      ? formatMoney({ amount: totalMinor, currency: client.currency }, moneyLocale(getLang())) : null,
    days,
    features,
    rhythm: {
      activeDays: rhythm.activeDays,
      spanDays: rhythm.spanDays,
      medianSeconds: rhythm.medianSecondsPerActiveDay,
      longestGapDays: rhythm.longestGapDays,
    },
    rework,
    open,
    team: options.team ?? [],
    site: (options.siteUrl ?? "https://getestela.dev").replace(/\/$/, ""),
  };

  // El texto de interfaz va aparte de los datos, en su propio bloque: los datos
  // son lo único que hay que vigilar de cerca (aquí no entra nada de IA ni de
  // costes, y hay tests que lo comprueban), y mezclarlos con frases sueltas
  // haría esa comprobación imposible de hacer sin falsos positivos.
  const lang = getLang();
  const ui: PanelUi = { lang, L: panelLabels(), monthNames: MONTHS[lang], dayNames: DAYS[lang] };

  return render(data, ui);
}

/** Un texto con su singular y su plural, ya traducidos. `{n}` lleva el número. */
interface Pair { readonly one: string; readonly other: string }

/**
 * Todo el texto fijo del panel, en el idioma en curso (`getLang()`).
 *
 * El navegador del cliente no tiene catálogo de traducciones ni sabe qué idioma
 * es el suyo: el panel es un fichero estático, así que el texto viaja ya
 * traducido dentro del propio fichero. Los huecos que rellena el navegador
 * (`{n}`, `{x}`...) se pasan como texto literal y no como valor real, porque
 * cuando se genera el fichero aún no se sabe qué número saldrá.
 */
function panelLabels() {
  const n = "{n}";
  return {
    title: tr`Avance del proyecto`,
    readOnly: tr`Solo lectura`,
    effortTitle: tr`En qué se fue el esfuerzo`,
    detailTitle: tr`Detalle por día`,
    ctaTitle: tr`Esto es una foto del proyecto`,
    ctaBody: tr`Se genera de la actividad real de Git y del editor, y se actualiza cuando quien lo publica lo vuelve a publicar.`,
    ctaMore: tr`Verlo para un equipo`,
    backedByCommits: tr`Cada bloque está respaldado por sus commits.`,
    measuredWith: tr`Horas medidas con ${"{link}"}.`,
    leadTop: tr`El grueso del trabajo fue **${"{x}"}**`,
    leadDeliveries: { one: tr`con **${n} entrega**`, other: tr`con **${n} entregas**` } as Pair,
    leadOpen: { one: tr`y **${n} frente abierto**`, other: tr`y **${n} frentes abiertos**` } as Pair,
    hoursWorked: tr`horas trabajadas`,
    activeDays: { one: tr`día con actividad`, other: tr`días con actividad` } as Pair,
    range: tr`del ${"{a}"} al ${"{b}"}`,
    fronts: { one: tr`frente de trabajo`, other: tr`frentes de trabajo` } as Pair,
    workValue: tr`valor del trabajo`,
    merged: tr`integrado`,
    inProgress: tr`en curso`,
    moreDelivered: tr`y ${n} más`,
    daysNoCommits: {
      one: tr`${n} día de trabajo, sin commits asociados.`,
      other: tr`${n} días de trabajo, sin commits asociados.`,
    } as Pair,
    commits: { one: tr`${n} commit`, other: tr`${n} commits` } as Pair,
    branches: { one: tr`${n} rama`, other: tr`${n} ramas` } as Pair,
    until: tr`hasta ${"{d}"}`,
    measured: tr`medido`,
    measuredByTeams: tr`Se mide con Teams`,
    you: tr`tú`,
    lockTitle: tr`Horas medidas de tu equipo`,
    lockBody1: tr`Las de tu gente pueden estimarse desde sus commits, pero medirlas exige que instalen Estela. Con **Teams** se miden, y dejan de ser una suposición que alguien pueda discutir.`,
    lockBody2: tr`El coste de IA se informa **por proyecto**, nunca por persona, y solo la que paga la empresa. Lo que cada cual gasta de su bolsillo es suyo.`,
    lockCta: tr`Ver qué incluye Teams →`,
    teamTitle: tr`Equipo del proyecto`,
    teamSub: {
      one: tr`${n} persona con actividad. Salen de los commits del repositorio, con sus identidades de git ya unificadas.`,
      other: tr`${n} personas con actividad. Salen de los commits del repositorio, con sus identidades de git ya unificadas.`,
    } as Pair,
    rhythmTitle: tr`Ritmo`,
    typicalDay: tr`jornada típica`,
    longestGap: { one: tr`día la pausa más larga`, other: tr`días la pausa más larga` } as Pair,
    openTitle: tr`Pendiente de integrar`,
    openSub: tr`Trabajo terminado que aún no está en la rama principal.`,
    today: tr`hoy`,
    yesterday: tr`ayer`,
    daysAgo: tr`hace ${n} d`,
    reworkTitle: tr`Dónde costó más`,
    reworkSub: tr`Ficheros retocados varias veces en pocos días. Suele señalar requisitos que se afinaron sobre la marcha.`,
    inDays: tr`en ${n} d`,
    days: { one: tr`${n} día`, other: tr`${n} días` } as Pair,
    all: tr`Todo`,
    noActivity: tr`Sin actividad en este periodo.`,
  };
}

type PanelLabels = ReturnType<typeof panelLabels>;

interface PanelUi {
  readonly lang: string;
  readonly L: PanelLabels;
  readonly monthNames: readonly string[];
  readonly dayNames: readonly string[];
}

function render(data: unknown, ui: PanelUi): string {
  const L = ui.L;
  // JSON dentro de <script>: hay que romper cualquier "</script>" literal que
  // pudiera venir en un mensaje de commit, o cerraría la etiqueta.
  const inline = (value: unknown) => JSON.stringify(value)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const payload = inline(data);
  const uiPayload = inline(ui);

  return `<!doctype html>
<html lang="${ui.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- Publicado con enlace no listado: que ningún buscador lo indexe. -->
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${esc(L.title)}</title>
<style>
/* Panel de avance.
   Rejilla, no columna: quien lo abre quiere saber cómo va en treinta segundos,
   no leer un documento. El detalle diario vive plegado porque es lo único que
   se recorre entero, y solo cuando alguien busca un día concreto. */

:root{
  --paper:#F1F3F1; --card:#fff; --card2:#EAEDEA; --line:#DEE2DD; --line2:#C5CAC4;
  --ink:#161A18; --ink2:#4E5652; --ink3:#7E8781;
  --jade:#0E7C6B; --jade2:#0A5F52; --jadebg:#E1EEEA; --jadedim:#8FC4B8;
  --amber:#8F5C0D; --amberbg:#F6E9D0;
  --on-jade:#fff;
  --r:14px;
  --shadow:0 1px 2px rgba(20,26,24,.04), 0 12px 32px -20px rgba(20,26,24,.28);
}
@media(prefers-color-scheme:dark){:root{
  --paper:#0C100F; --card:#151A18; --card2:#1D2422; --line:#28302D; --line2:#3A4541;
  --ink:#E8EEEB; --ink2:#A4AFA9; --ink3:#76817B;
  --jade:#45C0A7; --jade2:#6FD8C2; --jadebg:#0F2F29; --jadedim:#1E5A4F;
  --amber:#DDA85A; --amberbg:#31270F;
  --on-jade:#07201C;
  --shadow:0 1px 2px rgba(0,0,0,.5), 0 12px 32px -20px rgba(0,0,0,.8);
}}

*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--paper);color:var(--ink);
  font:15px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}

/* ── Cabecera ─────────────────────────────────────────────────── */
/* Fondo blanco fijo, no var(--card): el logo lleva su propio fondo blanco
   horneado en el PNG, y var(--card) se oscurece en modo oscuro — se vería
   como una caja blanca flotando en la cabecera. La cabecera se adapta al
   logo, no al revés. */
.top{background:#fff;border-bottom:1px solid #DEE2DD;
  padding:14px 28px;position:sticky;top:0;z-index:5}
.top-in{max-width:1180px;margin:0 auto;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.brand-logo{height:28px;width:auto;display:block}
.top-sep{width:1px;height:18px;background:#C5CAC4}
/* Colores fijos, no var(--ink...): la cabecera es blanca siempre (ver arriba),
   pero esas variables cambian a tonos claros en modo oscuro — el título se
   volvía casi invisible sobre el blanco fijo en cuanto el sistema estaba en
   oscuro. Aquí no hay que adaptarse al tema, solo verse sobre blanco. */
.top-project{font-weight:660;letter-spacing:-.01em;font-size:1.02rem;color:#161A18}
.top-client{color:#7E8781;font-size:.88rem}
.ro{margin-left:auto;font-size:.75rem;color:#7E8781;
  border:1px solid #C5CAC4;border-radius:999px;padding:3px 11px;white-space:nowrap}

main{max-width:1180px;margin:0 auto;padding:30px 28px 70px}

/* ── Titular ──────────────────────────────────────────────────── */
.lead{font-size:1.35rem;line-height:1.4;font-weight:480;letter-spacing:-.018em;
  margin:0 0 24px;max-width:40ch;color:var(--ink2)}
.lead b{color:var(--ink);font-weight:660}

/* ── Fila de cifras ───────────────────────────────────────────── */
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));
  gap:12px;margin-bottom:26px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  padding:18px 20px}
.kpi.accent{background:var(--jadebg);border-color:transparent}
.kpi b{display:block;font-size:1.9rem;font-weight:640;letter-spacing:-.038em;line-height:1.05}
.kpi.accent b{color:var(--jade2)}
.kpi span{display:block;font-size:.8rem;color:var(--ink3);margin-top:5px;line-height:1.35}
.kpi.accent span{color:var(--jade2);opacity:.8}

/* ── Rejilla principal ────────────────────────────────────────── */
.grid{display:grid;grid-template-columns:1.55fr 1fr;gap:14px;align-items:start}
/* min-width:auto es el valor por defecto de un hijo de rejilla: no encoge por
   debajo de su contenido, y basta un nombre largo con nowrap para desbordar
   la pantalla en móvil. */
.grid>*{min-width:0}
@media(max-width:940px){.grid{grid-template-columns:1fr}}

.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  overflow:hidden;margin-bottom:14px}
.card-h{padding:15px 20px 0}
.card-t{font-size:.72rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink3)}
.card-s{font-size:.85rem;color:var(--ink3);margin:7px 0 0;line-height:1.5}

/* ── Barras de esfuerzo ───────────────────────────────────────── */
.feats{padding:14px 20px 18px;display:flex;flex-direction:column;gap:3px}
.feat{border:0;background:none;font:inherit;color:inherit;text-align:left;
  padding:10px 10px;margin:0 -10px;border-radius:10px;cursor:pointer;display:block;width:calc(100% + 20px)}
.feat:hover{background:var(--card2)}
.feat-top{display:flex;align-items:baseline;gap:12px;margin-bottom:7px}
.feat-body{display:none}
.feat-name{flex:1;min-width:0;font-weight:560;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;letter-spacing:-.01em}
.feat-h{font-weight:620;white-space:nowrap;font-size:.95rem}
.feat-pct{color:var(--ink3);font-size:.8rem;white-space:nowrap;min-width:34px;text-align:right}
.bar{display:block;height:7px;border-radius:4px;background:var(--card2);overflow:hidden}
.bar i{display:block;height:100%;border-radius:4px;background:var(--jade);
  width:0;transition:width .7s cubic-bezier(.2,.8,.25,1)}
.feat.kindwork .bar i{background:var(--jadedim)}
.pill{font-size:.66rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  padding:2px 8px;border-radius:999px;white-space:nowrap}
.pill.open{background:var(--amberbg);color:var(--amber)}
.pill.done{background:var(--jadebg);color:var(--jade2)}

/* ── Equipo ──────────────────────────────────────────────────── */
.mems{padding:6px 20px 16px;display:flex;flex-direction:column;gap:2px}
.mem{padding:11px 0;border-bottom:1px solid var(--line)}
.mem:last-child{border-bottom:none}
.mem-top{display:flex;align-items:center;gap:9px;margin-bottom:7px}
.mem-name{font-weight:580;letter-spacing:-.01em;flex:1;min-width:0;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mem-h{font-weight:620;white-space:nowrap;font-size:.95rem}
/* Un guion se leería como "no hay dato". Aquí SÍ hay dato, y es justo lo que
   se vende: la etiqueta tiene que decir que está cerrado, no que falta. */
.mem-lock{font-size:.66rem;font-weight:700;letter-spacing:.04em;
  text-transform:uppercase;padding:3px 9px 3px 7px;border-radius:999px;
  color:var(--ink3);border:1px dashed var(--line2);white-space:nowrap;cursor:help}
.mem-lock::before{content:"🔒";font-size:.9em;margin-right:4px;
  text-transform:none;letter-spacing:0}
.mem-meta{display:block;margin-top:7px;font-size:.79rem;color:var(--ink3)}
/* La fila propia es la única con horas, así que se distingue sin gritar. */
.mem.is-me .bar>i{background:var(--jade)}
.mem .bar>i{background:var(--jadedim)}

.lock{margin:0 20px 18px;padding:15px 17px;border-radius:12px;
  background:var(--jadebg);border:1px solid transparent}
.lock-t{font-weight:640;font-size:.93rem;color:var(--jade2);margin-bottom:4px}
.lock-t::before{content:"🔒 ";font-size:.85em}
.lock-d{font-size:.83rem;line-height:1.5;color:var(--jade2);opacity:.88;max-width:62ch}
.lock-cta{display:inline-block;margin-top:11px;font-size:.84rem;font-weight:600;
  color:var(--on-jade);background:var(--jade);text-decoration:none;
  padding:8px 15px;border-radius:9px}
.lock-cta:hover{background:var(--jade2)}

.feat-body{padding:2px 0 6px}
.feat.is-open .feat-body{display:block}
.commits{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}
.commits li{font-size:.86rem;color:var(--ink2);display:flex;gap:9px;align-items:baseline}
.commits code{font-family:ui-monospace,Menlo,monospace;font-size:.76rem;color:var(--jade2);
  background:var(--jadebg);padding:1px 6px;border-radius:5px;flex:none}
.commits span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Filas de la columna lateral ──────────────────────────────── */
.rows{padding:6px 20px 16px;display:flex;flex-direction:column}
.row{display:flex;align-items:baseline;gap:12px;padding:10px 0;
  border-bottom:1px solid var(--line);font-size:.88rem}
.row:last-child{border-bottom:0}
.row-a{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.row-a.mono{font-family:ui-monospace,Menlo,monospace;font-size:.78rem}
.row-b{font-weight:640;color:var(--amber);white-space:nowrap}
.row-c{color:var(--ink3);font-size:.8rem;white-space:nowrap}

/* ── Ritmo ────────────────────────────────────────────────────── */
.rhythm{padding:16px 20px 18px}
.rhythm-n{display:flex;gap:22px;flex-wrap:wrap;margin-bottom:16px}
.rhythm-n div b{display:block;font-size:1.2rem;font-weight:640;letter-spacing:-.03em}
.rhythm-n div span{display:block;font-size:.76rem;color:var(--ink3);margin-top:2px}
.bars{display:flex;align-items:flex-end;gap:2px;height:52px}
.bars i{flex:1;background:var(--jade);border-radius:2px 2px 0 0;min-height:2px;
  opacity:.8;height:0;transition:height .6s cubic-bezier(.2,.8,.25,1)}
.bars i:hover{opacity:1}
.axis{display:flex;justify-content:space-between;font-size:.7rem;color:var(--ink3);margin-top:8px}

/* ── Detalle plegado ──────────────────────────────────────────── */
.detail{margin-top:14px}
.detail-h{width:100%;border:0;background:var(--card);border:1px solid var(--line);
  border-radius:var(--r);padding:15px 20px;font:inherit;color:inherit;cursor:pointer;
  display:flex;align-items:center;gap:12px;text-align:left}
.detail-h:hover{border-color:var(--line2)}
.detail-h .card-t{flex:1}
.chev{color:var(--ink3);font-size:.8rem;transition:transform .2s}
.detail.is-open .chev{transform:rotate(90deg)}
.detail-body{display:none;margin-top:10px}
.detail.is-open .detail-body{display:block}
.filters{display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap}
.filters button{border:1px solid var(--line);background:var(--card);color:var(--ink2);
  border-radius:8px;padding:5px 12px;font:inherit;font-size:.83rem;cursor:pointer}
.filters button:hover{border-color:var(--line2);color:var(--ink)}
.filters button[aria-pressed=true]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.days{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}
.day{background:var(--card);border:1px solid var(--line);border-radius:11px;overflow:hidden}
.day-h{display:flex;align-items:center;gap:10px;width:100%;padding:12px 15px;
  background:none;border:0;font:inherit;color:inherit;text-align:left;cursor:pointer}
.day-h:hover{background:var(--card2)}
.day-d{flex:1;font-size:.88rem;font-weight:540}
.day-t{font-weight:620;white-space:nowrap;font-size:.88rem}
.day-body{padding:0 15px 13px;border-top:1px solid var(--line)}
.item{padding:10px 0;border-bottom:1px solid var(--line);font-size:.85rem}
.item:last-child{border-bottom:0}
.item-top{display:flex;gap:10px;align-items:baseline}
.item-w{flex:1;min-width:0}
.item-t{color:var(--ink2);white-space:nowrap}
.item-a{color:var(--jade2);font-weight:620;white-space:nowrap}
.kindtag{display:inline-block;font-size:.64rem;font-weight:700;letter-spacing:.04em;
  text-transform:uppercase;padding:2px 6px;border-radius:5px;margin-right:7px;
  background:var(--amberbg);color:var(--amber);vertical-align:1px}

.empty{color:var(--ink3);text-align:center;padding:38px 0;font-size:.9rem}

/* ── Pie ──────────────────────────────────────────────────────── */
.cta{background:var(--card);border:1px solid var(--line2);border-radius:var(--r);
  padding:18px 22px;margin-top:24px;display:flex;gap:20px;align-items:center;flex-wrap:wrap}
.cta div{flex:1;min-width:230px}
.cta b{display:block;font-size:.98rem;margin-bottom:4px;letter-spacing:-.01em}
.cta p{margin:0;font-size:.87rem;color:var(--ink2);line-height:1.5}
.cta a{color:var(--on-jade);background:var(--jade);text-decoration:none;
  padding:9px 18px;border-radius:9px;font-size:.88rem;font-weight:620;white-space:nowrap}
footer{margin-top:26px;font-size:.8rem;color:var(--ink3);line-height:1.6}
footer a{color:var(--jade2)}

/* Una sola entrada orquestada: las tarjetas suben al cargar y las barras
   crecen. Más movimiento que esto distrae de lo que hay que leer. */
.rise{opacity:0;transform:translateY(10px);
  transition:opacity .5s ease,transform .5s cubic-bezier(.2,.8,.25,1)}
.rise.in{opacity:1;transform:none}

@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{transition-duration:.01ms!important;animation-duration:.01ms!important}
  .rise{opacity:1;transform:none}
}
@media(max-width:560px){
  main{padding:22px 16px 56px}
  .top{padding:14px 16px}
  .lead{font-size:1.12rem}
  .kpi b{font-size:1.6rem}
  .days{grid-template-columns:1fr}
  .top-client{display:none}
}
@media print{
  .top{position:static}.filters,.cta,.detail-h{display:none}
  .detail-body{display:block!important}.rise{opacity:1;transform:none}
  .bar i,.bars i{transition:none}
}
</style>
</head>
<body>
<header class="top">
  <div class="top-in">
    <img class="brand-logo" src="data:image/png;base64,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sp2fdkl2ddXE1pysda+trTOsW1GP1ivqe3an7r64J2BPc4NDw7a9zL1l+8A+xb5nP6b9eG1/2P62A+wDDT9Z/rTxIONgaSPSOKexrymrqas5ubnzUOihthavloM/O/68q9W0teqw7uEVR6hHio8MHC082n9Meqz3eObxh23T226fmHziysmYkx2nwk6d+SXolxOnOaePnvE+03rW8+yhc+xzTefdzje2u7Yf/NX114Mdbh2NF9wvNF/0uNjSOanzyCXfS8cvB1z+5QrvyvmrkVc7ryVcu3E99XrXDeGNpzdzb768VXDrw+1Fdwh3Su9q3i2/Z3iv+jfb3/Z2uXUdvh9wv/1B3IPbDwUPnz+SP/rYXfyY9rj8icmT2qfOT1t7gnouPpvyrPu59PmH3pLftX7f+MLmxU9/+P3R3je5r/ul7OXAn8te6b/a9ZfLX2390f33Xue9/vCm9K3+25p37Hen3ye9f/Jh1kfSx4pPtp9aPod9vjOQNzAg5cv4g1sBDCiPNhkA/LkLAFoyAAx4bqROUZ0PBwuiOtMOIvCfsOoMOVjgzqUB7uljeuHu5joA+3YAYAX16akARNMAiPcA6MSJI3X4LDd47lQWIjwbbE3/lJ6XDv5NUZ1Jv/J7dAuUqi5gdPsvbwiDNKFxZ4wAAACQUExURXqTkCBtW6LFvZueoDs+QL2/wFteYN7f4Hx+gEmQfp7Hwf39/TmBcTR8awQIChEWGOfp6dLX17a4uJOWl8bHyGVnaFRWVxshJKapqhgeIIaJitbm43R2d0ZJSyYpK2ykmTM2N0SJeYm2rbPFwlSVh5eko7fTzs7h3WSckHutoxxpWU6NgZvCu15hYiRrWz1BQtOrHioAAAAwdFJOU////////////////////////////////////////////////////////////////0+nP/UAAA1TSURBVHja7ZwHd6O4FoCdMpndZ4pEr6bZjmOn/P9/93TVkGRwHIeZs3NGOrsTDELAp8vVLRKrtS2/uqwsAsvYMrbFMraMLWNbLGPL2BbL2DK2jG2xjC1jy9gWy9gytsUytoz/Zsblfrh/fX0dBlzO1bjv70tL80bG5X2zdVxSHAf+dM0Uy57W6C3OGxiXPeHrqAVgHwaj2gurYyF/nXEJ4jnSVTh3Gk3MpNzp3GcL9GuMCWGn0+AqsP+9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" alt="getestela.dev">
    <span class="top-sep"></span>
    <span class="top-project" id="h-project"></span>
    <span class="top-client" id="h-client"></span>
    <span class="ro">${esc(L.readOnly)}</span>
  </div>
</header>

<main>
  <p class="lead" id="lead"></p>
  <div class="kpis" id="kpis"></div>

  <div class="grid">
    <div>
      <section class="card rise">
        <div class="card-h"><div class="card-t">${esc(L.effortTitle)}</div></div>
        <div class="feats" id="feats"></div>
      </section>
      <div id="team"></div>
      <div id="main-extra"></div>
    </div>

    <div id="side"></div>
  </div>

  <div class="detail" id="detail">
    <button class="detail-h" id="detail-toggle" aria-expanded="false">
      <span class="card-t">${esc(L.detailTitle)}</span>
      <span class="card-s" id="detail-count" style="margin:0"></span>
      <span class="chev">›</span>
    </button>
    <div class="detail-body">
      <div class="filters" id="filters"></div>
      <div class="days" id="days"></div>
    </div>
  </div>

  <div class="cta">
    <div>
      <b>${esc(L.ctaTitle)}</b>
      <p>${esc(L.ctaBody)}</p>
    </div>
    <a id="cta-more" rel="noopener noreferrer">${esc(L.ctaMore)}</a>
  </div>

  <footer id="footer-text"></footer>
</main>

<script id="data" type="application/json">__DATA__</script>
<script id="ui" type="application/json">__UI__</script>
<script>
"use strict";
var D = JSON.parse(document.getElementById("data").textContent);
// Los textos llegan ya traducidos, en el idioma del cliente, y aparte de los
// datos. Con {n} para un número, {x}/{a}/{b}/{d} para otros huecos, y **así**
// para lo que va en negrita.
var UI = JSON.parse(document.getElementById("ui").textContent);
var L = UI.L;
var openDay = {}, openFeat = {}, filter = "all";

function dur(s){var t=Math.round(s/60),h=Math.floor(t/60),m=t%60;
  return h===0?m+"m":(m===0?h+"h":h+"h "+String(m).padStart(2,"0")+"m");}
function esc(t){return String(t).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
// Sin expresiones regulares con barra invertida: este JS vive dentro de una
// plantilla de TypeScript, y ahí "\*" pierde la barra sin avisar.
function fill(t,k,v){return t.split(k).join(String(v));}
function pl(pair,n){return fill(n===1?pair.one:pair.other,"{n}",n);}
function md(t){var p=esc(t).split("**"),o="";
  for(var i=0;i<p.length;i++){o+=(i%2?"<b>"+p[i]+"</b>":p[i]);}return o;}
function longDate(iso){var d=new Date(iso+"T12:00:00Z");
  var dia=UI.dayNames[d.getUTCDay()], mes=UI.monthNames[d.getUTCMonth()];
  return UI.lang==="en" ? dia+", "+mes+" "+d.getUTCDate() : dia+" "+d.getUTCDate()+" de "+mes;}
function shortDate(iso){var d=new Date(iso+"T12:00:00Z");
  var mes=UI.monthNames[d.getUTCMonth()].slice(0,3);
  return UI.lang==="en" ? mes+" "+d.getUTCDate() : d.getUTCDate()+" "+mes;}
function el(id){return document.getElementById(id);}

function shown(){
  return filter==="all" ? D.days : D.days.filter(function(d){return d.date.indexOf(filter)===0;});
}

/* ── Cabecera y titular ─────────────────────────────────────── */
function renderHead(){
  el("h-project").textContent = D.project;
  el("h-client").textContent = "· " + D.client;

  var top = D.features[0];
  var entregas = D.features.reduce(function(s,f){return s+f.delivered.length;},0);
  var frase = [];
  if (top) frase.push(fill(md(L.leadTop),"{x}",esc(top.name)));
  if (entregas) frase.push(md(pl(L.leadDeliveries,entregas)));
  if (D.open.length) frase.push(md(pl(L.leadOpen,D.open.length)));
  el("lead").innerHTML = frase.length ? frase.join(" ")+"." : "";

  // "30 de 51" se lee como una fracción contra un objetivo ("cumplió 30 de
  // 51 días"), y no lo es: 51 es solo la distancia en el calendario entre el
  // primer y el último bloque, no una meta ni un plazo. El número grande pasa
  // a ser solo los días con trabajo, y el rango de fechas explica el resto
  // sin necesitar pasar el ratón por encima.
  var rango = D.days.length
    ? " · "+fill(fill(L.range,"{a}",shortDate(D.days[0].date)),"{b}",shortDate(D.days[D.days.length-1].date))
    : "";
  var k = [["", dur(D.totalSeconds), L.hoursWorked],
           ["", String(D.rhythm.activeDays), pl(L.activeDays,D.rhythm.activeDays)+rango],
           ["", String(D.features.length), pl(L.fronts,D.features.length)]];
  if (D.totalAmount) k.push(["accent", D.totalAmount, L.workValue]);
  el("kpis").innerHTML = k.map(function(x){
    return '<div class="kpi '+x[0]+'"><b>'+esc(x[1])+'</b><span>'+esc(x[2])+'</span></div>';
  }).join("");

  // Mismo sitio configurable que el candado de "Equipo del proyecto": el
  // dominio final aún no está comprado, y un enlace roto es peor que no tener
  // enlace. Quien busca de dónde sale esto y encuentra un dominio muerto duda
  // más que si no hubiera buscado nada.
  var site = D.site || "https://getestela.dev";
  // El mismo "d" que ya lee el formulario de la landing (packages/server/public/index.html)
  // para saber de dónde vino cada alta — así un clic desde el pie, no solo
  // desde el CTA fuerte de arriba, también queda atribuido a este panel.
  var origen = "?d=" + encodeURIComponent(D.client || "");
  el("cta-more").setAttribute("href", site + "/teams" + origen);
  // El nombre de la herramienta va en un enlace, no el dominio a secas: quien
  // ve el panel no tiene por qué saber que un enlace suelto al pie es lo que
  // lo generó. El resto de la frase lo pone la traducción.
  el("footer-text").innerHTML = esc(L.backedByCommits)+" "+
    fill(esc(L.measuredWith),"{link}",'<a id="footer-site" rel="noopener noreferrer">Estela</a>');
  el("footer-site").setAttribute("href", site + "/" + origen);
}

/* ── Esfuerzo, con proporción visible ───────────────────────── */
function renderFeats(){
  var max = D.features.reduce(function(m,f){return Math.max(m,f.seconds);},0) || 1;
  var total = D.features.reduce(function(s,f){return s+f.seconds;},0) || 1;

  el("feats").innerHTML = D.features.map(function(f,i){
    var isOpen = !!openFeat[i];
    var pill = f.merged===null ? "" :
      '<span class="pill '+(f.merged?"done":"open")+'">'+esc(f.merged?L.merged:L.inProgress)+'</span>';
    return '<button class="feat'+(isOpen?" is-open":"")+(f.merged===null&&!f.delivered.length?" kindwork":"")+
      '" data-f="'+i+'" aria-expanded="'+isOpen+'">'+
      '<span class="feat-top">'+
        '<span class="feat-name">'+esc(f.name)+'</span>'+pill+
        '<span class="feat-h">'+dur(f.seconds)+'</span>'+
        '<span class="feat-pct">'+Math.round(f.seconds/total*100)+'%</span></span>'+
      '<span class="bar"><i data-w="'+(f.seconds/max*100)+'"></i></span>'+
      '<span class="feat-body">'+
        (f.delivered.length
          ? '<ul class="commits">'+f.delivered.map(function(c){
              return '<li><code>'+esc(c.hash)+'</code><span>'+esc(c.subject)+'</span></li>';
            }).join("")+
            (f.moreDelivered?'<li><span>'+esc(fill(L.moreDelivered,"{n}",f.moreDelivered))+'</span></li>':"")+'</ul>'
          : '<p class="card-s">'+esc(pl(L.daysNoCommits,f.days))+'</p>')+
      '</span></button>';
  }).join("");

  Array.prototype.forEach.call(document.querySelectorAll(".feat"), function(b){
    b.onclick = function(){ openFeat[b.dataset.f] = !openFeat[b.dataset.f]; renderFeats(); grow(); };
  });
}

/* ── Equipo del proyecto ────────────────────────────────────── */
/* Los nombres, ramas y commits de su gente ya están en su repositorio: se los
   enseñamos porque demuestra que esto funciona sobre sus datos, no sobre una
   demo. Las horas de cada uno son lo que Estela produce y él no puede sacar
   solo, y por eso no viajan en este fichero. */
function renderTeam(){
  var t = D.team || [];
  if (!t.length) { el("team").innerHTML = ""; return; }

  var max = t.reduce(function(m,p){return Math.max(m,p.commits);},0) || 1;
  // El candado solo cuenta a quien de verdad sigue sin medirse: en cuanto
  // todo el mundo visible instaló Estela, el CTA de Teams no tiene nada que
  // vender ya en este proyecto.
  var others = t.filter(function(p){return !p.measured;}).length;

  var rows = t.map(function(p){
    var bar = '<span class="bar"><i data-w="'+(p.commits/max*100)+'"></i></span>';
    var meta = pl(L.commits,p.commits)+" · "+pl(L.branches,p.branches)+
      (p.lastDay?" · "+fill(L.until,"{d}",p.lastDay):"");

    // dur() solo se llama cuando seconds viene, y solo viene si measured:
    // quien publica, o un compañero que ya instaló Estela y aceptó Teams.
    var right = p.measured && p.seconds!=null
      ? '<span class="mem-h">'+dur(p.seconds)+'</span><span class="pill done">'+esc(L.measured)+'</span>'
      : '<span class="mem-lock" title="'+esc(L.measuredByTeams)+'">Teams</span>';

    return '<div class="mem'+(p.isMe?" is-me":"")+'">'+
      '<span class="mem-top">'+
        '<span class="mem-name">'+esc(p.name)+(p.isMe?' <span class="pill">'+esc(L.you)+'</span>':"")+'</span>'+
        right+'</span>'+
      bar+
      '<span class="mem-meta">'+esc(meta)+'</span></div>';
  }).join("");

  var lock = others>0
    ? '<div class="lock">'+
        '<div class="lock-t">'+esc(L.lockTitle)+'</div>'+
        '<div class="lock-d">'+md(L.lockBody1)+'<br><br>'+md(L.lockBody2)+'</div>'+
        '<a class="lock-cta" href="'+D.site+'/teams?d='+
        encodeURIComponent(D.client||"")+'" target="_blank" rel="noopener">'+
        esc(L.lockCta)+'</a>'+
      '</div>'
    : "";

  el("team").innerHTML = '<section class="card rise">'+
    '<div class="card-h"><div class="card-t">'+esc(L.teamTitle)+'</div>'+
    '<div class="card-s">'+esc(pl(L.teamSub,t.length))+'</div></div>'+
    '<div class="mems">'+rows+'</div>'+lock+'</section>';
}

/* ── Columna lateral ────────────────────────────────────────── */
function renderSide(){
  var out = [];

  var r = D.rhythm;
  var list = D.days;
  var max = list.reduce(function(m,d){return Math.max(m,d.seconds);},0) || 1;
  out.push('<section class="card rise"><div class="card-h"><div class="card-t">'+esc(L.rhythmTitle)+'</div></div>'+
    '<div class="rhythm"><div class="rhythm-n">'+
      '<div><b>'+dur(r.medianSeconds)+'</b><span>'+esc(L.typicalDay)+'</span></div>'+
      (r.longestGapDays>0?'<div><b>'+r.longestGapDays+'</b><span>'+esc(pl(L.longestGap,r.longestGapDays))+'</span></div>':"")+
    '</div>'+
    (list.length>1
      ? '<div class="bars">'+list.map(function(d){
          return '<i data-h="'+Math.max(4,Math.round(d.seconds/max*100))+
            '" title="'+esc(d.date+": "+dur(d.seconds))+'"></i>';
        }).join("")+'</div>'+
        '<div class="axis"><span>'+esc(list[0].date.slice(5))+'</span><span>'+
        esc(list[list.length-1].date.slice(5))+'</span></div>'
      : "")+
    '</div></section>');

  if (D.open.length) {
    out.push('<section class="card rise"><div class="card-h">'+
      '<div class="card-t">'+esc(L.openTitle)+'</div>'+
      '<p class="card-s">'+esc(L.openSub)+'</p></div>'+
      '<div class="rows">'+D.open.map(function(o){
        var ago = o.ageDays===0 ? L.today : o.ageDays===1 ? L.yesterday : fill(L.daysAgo,"{n}",o.ageDays);
        return '<div class="row"><span class="row-a">'+esc(o.name)+'</span>'+
          '<span class="row-b">'+esc(pl(L.commits,o.commits))+'</span>'+
          '<span class="row-c">'+esc(ago)+'</span></div>';
      }).join("")+'</div></section>');
  }

  el("side").innerHTML = out.join("");

  var extra = [];
  if (D.rework.length) {
    extra.push('<section class="card rise"><div class="card-h">'+
      '<div class="card-t">'+esc(L.reworkTitle)+'</div>'+
      '<p class="card-s">'+esc(L.reworkSub)+'</p></div>'+
      '<div class="rows">'+D.rework.map(function(f){
        return '<div class="row"><span class="row-a mono">'+esc(f.file)+'</span>'+
          '<span class="row-b">'+f.touches+'×</span>'+
          '<span class="row-c">'+esc(fill(L.inDays,"{n}",f.spanDays))+'</span></div>';
      }).join("")+'</div></section>');
  }
  el("main-extra").innerHTML = extra.join("");
}

/* ── Detalle por día ────────────────────────────────────────── */
function renderDays(){
  var list = shown();
  el("detail-count").textContent = pl(L.days,list.length);

  var ms = {};
  D.days.forEach(function(d){ ms[d.date.slice(0,7)] = true; });
  var months = Object.keys(ms).sort();

  el("filters").innerHTML = months.length<2 ? "" :
    ['<button data-f="all" aria-pressed="'+(filter==="all")+'">'+esc(L.all)+'</button>']
      .concat(months.map(function(m){
        return '<button data-f="'+m+'" aria-pressed="'+(filter===m)+'">'+
          esc(UI.monthNames[Number(m.slice(5,7))-1]+" "+m.slice(0,4))+'</button>';
      })).join("");

  el("days").innerHTML = list.length===0
    ? '<p class="empty">'+esc(L.noActivity)+'</p>'
    : list.map(function(d){
        var isOpen = !!openDay[d.date];
        return '<div class="day'+(isOpen?" is-open":"")+'">'+
          '<button class="day-h" data-d="'+esc(d.date)+'" aria-expanded="'+isOpen+'">'+
            '<span class="day-d">'+esc(longDate(d.date))+'</span>'+
            '<span class="day-t">'+dur(d.seconds)+'</span>'+
            '<span class="chev">›</span></button>'+
          (isOpen?'<div class="day-body">'+d.items.map(item).join("")+'</div>':"")+
        '</div>';
      }).join("");

  Array.prototype.forEach.call(document.querySelectorAll(".day-h"), function(b){
    b.onclick = function(){ openDay[b.dataset.d] = !openDay[b.dataset.d]; renderDays(); };
  });
  Array.prototype.forEach.call(document.querySelectorAll("#filters button"), function(b){
    b.onclick = function(){ filter = b.dataset.f; renderDays(); };
  });
}

function item(it){
  return '<div class="item"><div class="item-top">'+
    '<span class="item-w">'+(it.kind?'<span class="kindtag">'+esc(it.kind)+'</span>':"")+
      esc(it.what)+'</span>'+
    '<span class="item-t">'+dur(it.seconds)+'</span>'+
    (it.amount?'<span class="item-a">'+esc(it.amount)+'</span>':"")+'</div>'+
    (it.commits.length
      ? '<ul class="commits">'+it.commits.map(function(c){
          return '<li><code>'+esc(c.hash)+'</code><span>'+esc(c.subject)+'</span></li>';
        }).join("")+'</ul>'
      : "")+'</div>';
}

/* ── Entrada ────────────────────────────────────────────────── */
function grow(){
  requestAnimationFrame(function(){
    Array.prototype.forEach.call(document.querySelectorAll(".bar i"), function(b){
      b.style.width = b.dataset.w + "%";
    });
    Array.prototype.forEach.call(document.querySelectorAll(".bars i"), function(b){
      b.style.height = b.dataset.h + "%";
    });
  });
}

renderHead();
renderFeats();
renderTeam();
renderSide();
renderDays();

el("detail-toggle").onclick = function(){
  var d = el("detail"), on = d.classList.toggle("is-open");
  this.setAttribute("aria-expanded", String(on));
};

requestAnimationFrame(function(){
  Array.prototype.forEach.call(document.querySelectorAll(".rise"), function(c,i){
    setTimeout(function(){ c.classList.add("in"); }, i*70);
  });
  grow();
});
</script>
</body>
</html>`
    // Con una función, no con el texto: `String.replace` interpreta `$'`, `$&` y
    // `$$` dentro de la cadena de reemplazo, y un mensaje de commit con "$'" o
    // "$$" rompía el JSON — o cambiaba lo que decía sin que nadie lo notara.
    .replace("__DATA__", () => payload)
    .replace("__UI__", () => uiPayload);
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
