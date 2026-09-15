import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * Pruebas de la interfaz web sin navegador.
 *
 * Los fallos que llegaron a producción fueron de dos clases:
 *
 *  1. Lógica pura mal escrita — "2h 60m", el día de hoy calculado en UTC, el
 *     salto de dos días al navegar. Se prueban llamando a las funciones.
 *  2. CSS y DOM — el atributo `hidden` que no ocultaba nada porque una clase
 *     con `display: flex` lo pisaba, y un `id` referenciado que no existía en
 *     el HTML. Se prueban leyendo los ficheros y comprobando invariantes.
 *
 * Nada de esto necesita un navegador ni una dependencia nueva, y cubre las dos
 * familias de fallo que de verdad ocurrieron.
 */

const WEB = join(__dirname, "..", "..", "web");
const html = readFileSync(join(WEB, "index.html"), "utf8");
const css = readFileSync(join(WEB, "app.css"), "utf8");
const appJs = readFileSync(join(WEB, "app.js"), "utf8");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const lib = require(join(WEB, "lib.js")) as {
  localDay: (d: Date) => string;
  localToday: (offset?: number, now?: Date) => string;
  shiftDay: (iso: string, days: number) => string;
  fmtDuration: (s: number) => string;
  fmtMoney: (minor: number | null, currency: string) => string | null;
  fmtDayTitle: (iso: string, now?: Date) => string;
  periodRange: (p: string, now?: Date) => { from: string; to: string };
  esc: (t: string) => string;
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const i18n = require(join(WEB, "i18n.js")) as {
  dict: Record<string, Record<string, string | { one: string; other: string }>>;
  SUPPORTED: string[];
  detectLang: (stored: string | null, navigatorLangs: string[] | undefined) => string;
  t: (key: string, vars?: Record<string, unknown>) => string;
  setLang: (lang: string) => string;
};

// ── Duraciones ─────────────────────────────────────────────────────────

test("interfaz: nunca imprime 60 minutos", () => {
  assert.equal(lib.fmtDuration(2 * 3600 + 59 * 60 + 50), "3h");
  assert.equal(lib.fmtDuration(3599), "1h");
  for (let s = 0; s < 12 * 3600; s += 13) {
    assert.ok(!lib.fmtDuration(s).includes("60m"), `fmtDuration(${s})`);
  }
});

test("interfaz: duraciones normales", () => {
  assert.equal(lib.fmtDuration(0), "0m");
  assert.equal(lib.fmtDuration(3660), "1h 01m");
  assert.equal(lib.fmtDuration(4 * 3600 + 16 * 60), "4h 16m");
});

// ── Fechas ─────────────────────────────────────────────────────────────

test("interfaz: hoy se calcula en local, no en Greenwich", () => {
  // El fallo real: a las 23:31 en UTC-5, toISOString() daba el día siguiente,
  // así que la pestaña "Hoy" llevaba a un día vacío y el día real salía
  // etiquetado como "Ayer".
  const tarde = new Date("2026-08-27T04:31:00Z");   // 23:31 del 26 en UTC-5
  assert.equal(lib.localToday(0, tarde), lib.localDay(tarde));

  if (tarde.getTimezoneOffset() > 0) {
    assert.notEqual(lib.localToday(0, tarde), tarde.toISOString().slice(0, 10),
      "al oeste de Greenwich la fecha local difiere de la UTC a esa hora");
  }
});

test("interfaz: navegar un día no salta dos", () => {
  // Anclar a mediodía evita que a las 00:30 la aritmética en UTC salte dos días.
  assert.equal(lib.shiftDay("2026-08-26", 1), "2026-08-27");
  assert.equal(lib.shiftDay("2026-08-27", -1), "2026-08-26");
  assert.equal(lib.shiftDay("2026-03-01", -1), "2026-02-28");
  assert.equal(lib.shiftDay("2026-12-31", 1), "2027-01-01");
});

test("interfaz: ida y vuelta entre días siempre vuelve al mismo sitio", () => {
  let day = "2026-01-01";
  for (let i = 0; i < 400; i++) {
    const next = lib.shiftDay(day, 1);
    assert.equal(lib.shiftDay(next, -1), day, `falla en ${day}`);
    day = next;
  }
});

test("interfaz: 'Hoy' y 'Ayer' se calculan con la misma fecha local", () => {
  const now = new Date("2026-08-27T04:31:00Z");
  assert.equal(lib.fmtDayTitle(lib.localToday(0, now), now), "Hoy");
  assert.equal(lib.fmtDayTitle(lib.localToday(-1, now), now), "Ayer");
});

test("interfaz: el periodo 'todo' no acota fechas", () => {
  assert.deepEqual(lib.periodRange("all"), { from: "", to: "" });
  const mes = lib.periodRange("month", new Date("2026-08-27T12:00:00Z"));
  assert.ok(mes.from.endsWith("-01"), "el mes empieza el día 1");
  assert.ok(mes.from <= mes.to);
});

// ── Importes ───────────────────────────────────────────────────────────

test("interfaz: sin importe devuelve null, no cero", () => {
  // Enseñar "0,00" donde no hay tarifa haría creer que el trabajo no vale nada.
  assert.equal(lib.fmtMoney(null, "EUR"), null);
  assert.equal(lib.fmtMoney(undefined as never, "EUR"), null);
  assert.equal(lib.fmtMoney(0, "EUR"), "€0,00");
});

test("interfaz: una moneda sin símbolo se escribe con su código", () => {
  assert.ok(lib.fmtMoney(1000, "COP")!.includes("COP"));
  assert.equal(lib.fmtMoney(1300, "EUR"), "€13,00");
});

// ── Invariantes del HTML y el CSS ──────────────────────────────────────

test("interfaz: el atributo hidden oculta de verdad", () => {
  // El fallo real: `[hidden] { display: none }` es una regla del navegador y
  // cualquier `display` de autor la gana. Como .hero y .approve son flex, el
  // atributo no hacía nada: el formulario salía abierto y un día vacío seguía
  // enseñando las cifras del anterior.
  assert.match(css, /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/,
    "hace falta [hidden] { display: none !important }");
});

test("interfaz: todo id que usa el guion existe en el HTML", () => {
  // Un $("#x") contra un id que se renombró devuelve null y revienta al usarlo.
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]!));
  const usados = [...appJs.matchAll(/\$\("#([a-zA-Z0-9_-]+)"\)/g)].map((m) => m[1]!);

  // Los que se crean dinámicamente y no están en el HTML de partida.
  const dinamicos = new Set(["add-toggle", "add-form", "add-cancel", "add-kind",
    "add-minutes", "add-what", "add-project", "new-project", "np-repo", "np-name",
    "np-rate", "np-client", "np-clientname", "np-currency", "approve-all", "rep-periods",
    "team-more", "rep-search", "reports-more"]);

  const faltan = [...new Set(usados)].filter((id) => !ids.has(id) && !dinamicos.has(id));
  assert.deepEqual(faltan, [], `ids referenciados que no existen: ${faltan.join(", ")}`);
});

test("interfaz: ningún color vive solo dentro de un media query", () => {
  // Un color declarado únicamente bajo `prefers-color-scheme` no aplica en el
  // otro tema, y la página sale con el texto de un tema sobre el fondo del otro.
  const dentro = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"));
  const bloque = dentro.slice(0, dentro.indexOf("\n}\n") + 3);
  const reglas = [...bloque.matchAll(/^\s{2,}([a-z-]+)\s*\{/gm)].map((m) => m[1]!);
  assert.deepEqual(reglas, [],
    `el bloque oscuro solo debe redefinir variables, no reglas: ${reglas.join(", ")}`);
});

test("interfaz: no quedan fechas calculadas en UTC", () => {
  // El patrón que causó tres fallos distintos: toISOString().slice(0,10) sin
  // restar antes el desfase horario.
  const sospechosas = [...appJs.matchAll(/toISOString\(\)\.slice\(0,\s*10\)/g)];
  const conOffset = [...appJs.matchAll(/getTimezoneOffset\(\)[^;]*toISOString\(\)\.slice\(0,\s*10\)/g)];
  assert.equal(sospechosas.length, conOffset.length,
    "toda conversión a YYYY-MM-DD debe restar el desfase horario antes");
});

test("interfaz: el HTML carga lib.js, luego i18n.js, luego app.js", () => {
  // Al revés, app.js llamaría a funciones que aún no existen, e i18n.js no
  // podría avisar a lib.js del idioma para las fechas y los importes.
  const lib = html.indexOf('src="/lib.js"');
  const i18n = html.indexOf('src="/i18n.js"');
  const app = html.indexOf('src="/app.js"');
  assert.ok(lib > 0 && i18n > 0 && app > 0, "los tres scripts deben estar enlazados");
  assert.ok(lib < i18n && i18n < app, "orden: lib.js, i18n.js, app.js");
});

test("interfaz: el escapado neutraliza HTML en datos", () => {
  // Un mensaje de commit con etiquetas no puede inyectarse en la página.
  const salida = lib.esc('<img onerror="alert(1)"> & "x"');
  assert.ok(!salida.includes("<img"));
  assert.ok(salida.includes("&lt;img"));
  assert.ok(salida.includes("&amp;"));
});

// ── La misma lógica bajo varios husos horarios ─────────────────────────

/**
 * Recarga lib.js con otra zona horaria.
 *
 * Sin esto, los tests de fechas solo valen en el huso de quien los ejecuta: la
 * versión defectuosa de `shiftDay` acierta por casualidad en UTC-5 y falla al
 * este de Greenwich. Un test que depende del reloj de la máquina no prueba nada.
 */
function conZona<T>(tz: string, fn: (lib: typeof libMod) => T): T {
  const previa = process.env["TZ"];
  process.env["TZ"] = tz;
  const ruta = require.resolve(join(WEB, "lib.js"));
  delete require.cache[ruta];
  try {
    return fn(require(ruta) as typeof libMod);
  } finally {
    process.env["TZ"] = previa;
    delete require.cache[ruta];
  }
}

type LibModule = typeof lib;
const libMod = lib as LibModule;

const ZONAS = [
  "America/Guayaquil",    // UTC-5, el tuyo
  "Pacific/Honolulu",     // UTC-10, el extremo oeste
  "Europe/Madrid",        // UTC+2
  "Asia/Tokyo",           // UTC+9
  "Pacific/Kiritimati",   // UTC+14, el extremo este
  "Asia/Kathmandu",       // UTC+5:45, desfase no entero
];

test("fechas: navegar un día funciona en cualquier huso", () => {
  for (const tz of ZONAS) {
    conZona(tz, (l) => {
      assert.equal(l.shiftDay("2026-08-26", 1), "2026-08-27", `avanzar en ${tz}`);
      assert.equal(l.shiftDay("2026-08-27", -1), "2026-08-26", `retroceder en ${tz}`);
      assert.equal(l.shiftDay("2026-02-28", 1), "2026-03-01", `fin de mes en ${tz}`);
      assert.equal(l.shiftDay("2026-01-01", -1), "2025-12-31", `cambio de año en ${tz}`);
    });
  }
});

test("fechas: ida y vuelta es estable en cualquier huso", () => {
  for (const tz of ZONAS) {
    conZona(tz, (l) => {
      let day = "2026-03-01";
      for (let i = 0; i < 120; i++) {
        const next = l.shiftDay(day, 1);
        assert.equal(l.shiftDay(next, -1), day, `${day} en ${tz}`);
        day = next;
      }
    });
  }
});

test("fechas: el día local nunca es el de Greenwich al este ni al oeste", () => {
  // A las 23:31 en Guayaquil ya es el día siguiente en UTC; a las 00:30 en
  // Tokio todavía es el día anterior. Ambos casos rompían la pestaña "Hoy".
  const nocheGuayaquil = new Date("2026-08-27T04:31:00Z");
  conZona("America/Guayaquil", (l) => {
    assert.equal(l.localToday(0, nocheGuayaquil), "2026-08-26");
  });

  const madrugadaTokio = new Date("2026-08-26T15:30:00Z");  // 00:30 del 27 en Tokio
  conZona("Asia/Tokyo", (l) => {
    assert.equal(l.localToday(0, madrugadaTokio), "2026-08-27");
  });
});

test("fechas: el rango del mes empieza el día 1 en cualquier huso", () => {
  for (const tz of ZONAS) {
    conZona(tz, (l) => {
      const r = l.periodRange("month", new Date("2026-08-27T04:31:00Z"));
      assert.ok(r.from.endsWith("-01"), `${tz}: ${r.from}`);
      assert.ok(r.from <= r.to, `${tz}: ${r.from} > ${r.to}`);
    });
  }
});

test("interfaz: 'sin tarifa' solo se dice cuando de verdad falta", () => {
  // El fallo real: un día con trabajo en euros y en dólares dejaba el total
  // nulo, y la pantalla decía "sin tarifa definida" aunque todas estuvieran
  // puestas. Mandaba a revisar una configuración correcta.
  //
  // Se comprueba sobre el propio código: la etiqueta debe depender de si hay
  // subtotales, no de que exista un total único.
  assert.match(appJs, /const totals = day\.totals \|\| \[\]/,
    "el día debe usar subtotales por moneda");
  assert.match(appJs, /day\.missingRate \? tr\("day\.noRate"\)/,
    "la etiqueta de falta de tarifa debe venir del servidor, no deducirse de un total nulo");
  assert.ok(!/money \? "por facturar" : "sin tarifa definida"/.test(appJs),
    "no puede deducirse la falta de tarifa de que el total sea nulo");
});

// ── Mantenerse al día ────────────────────────────────────────────────────────

test("cada pestaña se puede refrescar", () => {
  // Si se añade una pestaña y no se enseña a reloadView() a recargarla, el
  // botón de actualizar deja de hacer nada en esa vista y no lo dice. Falla
  // en silencio, que es justo el fallo que este cambio venía a arreglar.
  const tabs = [...html.matchAll(/data-view="([a-z]+)"/g)].map((m) => m[1]!);
  assert.ok(tabs.length >= 4, `solo se encontraron ${tabs.length} pestañas`);

  const reload = appJs.slice(appJs.indexOf("function reloadView"));
  const body = reload.slice(0, reload.indexOf("\n}"));

  for (const tab of tabs) {
    assert.ok(body.includes(`"${tab}"`), `reloadView() no recarga la pestaña "${tab}"`);
  }
});

test("el aviso de import fallido existe y se puede ocultar", () => {
  // El fallo real: `hidden` no ocultaba nada porque una clase con display lo
  // pisaba. Aquí el aviso nace oculto, así que la regla tiene que aguantar.
  assert.match(html, /id="sync-warn"[^>]*hidden/,
    "el aviso debe empezar oculto");
  assert.ok(!/\.sync-warn\s*\{[^}]*display:/.test(css),
    ".sync-warn no debe declarar display: pisaría a [hidden]");
});

test("el botón de actualizar existe y está referenciado", () => {
  for (const id of ["sync", "sync-label", "sync-warn"]) {
    assert.ok(html.includes(`id="${id}"`), `falta id="${id}" en el HTML`);
    assert.ok(appJs.includes(`#${id}`), `app.js no usa #${id}`);
  }
});

test("volver a la pestaña actualiza", () => {
  // Es la vía que no exige acordarse de nada, y por eso la que importa.
  assert.ok(appJs.includes("visibilitychange"),
    "sin esto hay que pulsar el botón a mano cada vez");
});

test("la animación del botón respeta prefers-reduced-motion", () => {
  const idx = css.indexOf("prefers-reduced-motion");
  assert.ok(idx > 0, "falta la regla de movimiento reducido");
  assert.ok(css.slice(idx).includes("sync-dot"),
    "el punto que parpadea debe pararse con movimiento reducido");
});

// ── Vista de equipo ──────────────────────────────────────────────────────────

test("los KPIs del equipo nunca se apilan en una columna", () => {
  // Cuatro cifras apiladas dejan de compararse entre sí y vuelven a ser datos
  // sueltos, que es justo el problema que esta pantalla venía a resolver.
  const block = css.slice(css.indexOf(".kpis-4"));
  assert.match(block, /grid-template-columns:\s*repeat\(4/);
  const mobile = block.slice(block.indexOf("max-width"), block.indexOf("max-width") + 160);
  assert.match(mobile, /repeat\(2/, "en móvil deben quedar dos columnas, no una");
});

test("los segmentos de la barra de composición son bloques", () => {
  // Ya pasó dos veces: un <span> sin display:block renderiza a altura cero y
  // la barra desaparece sin que nada falle.
  const seg = css.slice(css.indexOf(".seg "), css.indexOf(".seg ") + 90);
  assert.match(seg, /display:\s*block/);
});

test("la tabla ancha hace scroll dentro de su caja, no en la página", () => {
  const wrap = css.slice(css.indexOf(".tbl-wrap"), css.indexOf(".tbl-wrap") + 120);
  assert.match(wrap, /overflow-x:\s*auto/);
});

test("las cifras de la tabla se alinean para poder compararse", () => {
  const num = css.slice(css.indexOf(".tbl .num"), css.indexOf(".tbl .num") + 130);
  assert.match(num, /text-align:\s*right/);
  assert.match(num, /tabular-nums/, "sin cifras de ancho fijo las columnas bailan");
});

test("medido y estimado se distinguen a la vista", () => {
  // Presentar horas estimadas con el mismo aspecto que las medidas es lo que
  // convertiría esta pantalla en una herramienta para señalar a alguien.
  assert.ok(appJs.includes('tr("team.measured")') && appJs.includes('tr("team.estimated")'));
  // Y en los dos idiomas: en inglés tampoco pueden verse igual.
  for (const lang of ["es", "en"]) {
    const d = i18n.dict[lang]!;
    assert.ok(d["team.measured"] && d["team.estimated"] && d["team.measured"] !== d["team.estimated"],
      `${lang}: medido y estimado tienen que decir cosas distintas`);
  }
  assert.ok(css.includes(".prec-ok"), "falta el estilo que separa ambas");
});

test("la tabla de personas no se ordena por horas en el cliente", () => {
  // El orden lo fija el servidor por actividad reciente. Si la web reordenara
  // por horas, volvería a ser un ranking de rendimiento.
  const render = appJs.slice(appJs.indexOf("function renderTeam"));
  const body = render.slice(0, render.indexOf("\n}"));
  assert.ok(!/\.sort\(/.test(body), "renderTeam() no debe reordenar a las personas");
});

test("la pestaña Equipo está enganchada a la navegación", () => {
  assert.ok(html.includes('data-view="team"'));
  assert.ok(html.includes('id="view-team"'));
  assert.ok(appJs.includes('name === "team"'), "showView() no la carga");
});

test("la vista de equipo avisa de que sus cifras no suman con los totales", () => {
  // Los totales cuentan tu trabajo imputado; la tabla de personas incluye horas
  // estimadas de gente que no usa Estela. Sin decirlo, el primer lector atento
  // ve que no cuadra y deja de creerse el resto de la pantalla.
  assert.ok(appJs.includes('tr("team.note")'), "la nota tiene que pintarse en la vista de equipo");
  assert.match(String(i18n.dict["es"]!["team.note"]), /no entran<\/b> en los totales/);
  assert.match(String(i18n.dict["en"]!["team.note"]), /aren't included<\/b> in the totals/);
});

test("la vista de equipo ensancha la página", () => {
  // 720px es el ancho para leer un texto. Una tabla de seis columnas ahí no
  // cabe, y era la queja concreta: que ocupe más pantalla.
  assert.match(css, /main\.wide\s*\{[^}]*max-width:\s*11\d\dpx/);
  assert.ok(appJs.includes('classList.toggle("wide"'), "nadie activa la clase");
});

// ── Informes: buscador y plegado ─────────────────────────────────────────────

test("Informes pliega el formulario por defecto, igual que un bloque de Mi día", () => {
  // El fallo que esto evita: con varios proyectos con tarifa, la pantalla
  // desplegaba fecha+fecha+nombre+casilla+botón para CADA UNO a la vez, y se
  // volvía una columna larga sin poder distinguir un proyecto de otro.
  assert.ok(appJs.includes("state.reportsOpen"), "falta el registro de qué fila está abierta");
  assert.match(appJs, /\$\{open \? `[\s\S]*?<form class="report-actions"/,
    "el formulario debe renderizarse solo cuando la fila está abierta, no ocultarse con CSS");
});

test("Informes muestra un tope de filas con 'ver más', y busca en el navegador", () => {
  assert.ok(appJs.includes("const REPORT_ROWS = 5"), "el tope debe ser explícito, no un número suelto");
  assert.ok(appJs.includes("state.reportsQuery"), "falta el estado del buscador");
  assert.ok(appJs.includes('id="reports-more"'), "falta el botón de ver más proyectos");
});

// ── Idiomas ──────────────────────────────────────────────────────────────────


function variables(entry: string | { one: string; other: string }): string {
  const texto = typeof entry === "string" ? entry : entry.one + entry.other;
  return [...new Set([...texto.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort().join(",");
}

test("idiomas: español e inglés tienen exactamente las mismas claves", () => {
  // Una clave solo en un idioma cae al español en pantalla: en inglés saldría
  // media interfaz en otro idioma sin que nada fallara.
  const es = Object.keys(i18n.dict["es"]!);
  const en = Object.keys(i18n.dict["en"]!);
  assert.deepEqual(es.filter((k) => !en.includes(k)), [], "claves sin traducir al inglés");
  assert.deepEqual(en.filter((k) => !es.includes(k)), [], "claves en inglés que no existen en español");
});

test("idiomas: cada traducción usa las mismas variables y la misma forma", () => {
  // "{n} bloques" traducido como "{count} blocks" dejaría el número sin poner.
  for (const [key, es] of Object.entries(i18n.dict["es"]!)) {
    const en = i18n.dict["en"]![key]!;
    assert.equal(typeof en, typeof es, `${key}: uno es plural y el otro no`);
    assert.equal(variables(en), variables(es), `${key}: variables distintas`);
  }
});

test("idiomas: toda clave que usan la página y el HTML existe", () => {
  const usadas = [
    ...[...appJs.matchAll(/\btr\("([^"]+)"/g)].map((m) => m[1]!),
    ...[...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]!),
  ];
  // `kind.${kind}` se arma en tiempo de ejecución: se comprueba aparte.
  for (const kind of ["development", "meeting", "research", "review", "travel", "support", "other"]) {
    usadas.push(`kind.${kind}`);
  }
  const faltan = [...new Set(usadas)].filter((k) => !(k in i18n.dict["es"]!));
  assert.deepEqual(faltan, [], `claves usadas que no están en i18n.js: ${faltan.join(", ")}`);
});

test("idiomas: no queda texto en español escrito a mano en app.js", () => {
  // La forma de romper el inglés sin que falle nada más: añadir un aviso nuevo
  // con la frase puesta directamente en vez de con tr(). Se buscan tildes y
  // palabras que solo existen en español, fuera de comentarios.
  const codigo = appJs.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const lineas = codigo.split("\n").filter((l) =>
    /["'`>]/.test(l) && /[áéíóúñ¿¡]|\b(sin|por|para|los|las|del|una|hay|desde|hasta)\b/.test(l.replace(/tr\("[^"]*"/g, "")));
  // `hay` es el nombre de una variable, no una frase.
  const reales = lineas.filter((l) => !/const hay =/.test(l));
  assert.deepEqual(reales.map((l) => l.trim()), [], "texto sin pasar por tr()");
});

test("idiomas: plurales y variables se resuelven bien", () => {
  i18n.setLang("es");
  assert.equal(i18n.t("summary.days", { n: 1 }), "1 día trabajado", "el singular concuerda entero");
  assert.equal(i18n.t("summary.days", { n: 3 }), "3 días trabajados");
  i18n.setLang("en");
  assert.equal(i18n.t("summary.days", { n: 1 }), "1 day worked");
  assert.equal(i18n.t("team.people", { n: 2 }), "2 people", "el plural irregular no es añadir una s");
  assert.equal(i18n.t("projects.stale.item", { name: "Web", blocks: "2 new blocks", when: "today" }),
    "Web — 2 new blocks since you published it today");
  i18n.setLang("es");
});

test("idiomas: el elegido a mano gana, luego el del navegador, y si no inglés", () => {
  assert.equal(i18n.detectLang("es", ["en-US"]), "es", "lo elegido a mano manda");
  assert.equal(i18n.detectLang(null, ["es-EC", "en"]), "es");
  assert.equal(i18n.detectLang(null, ["en-GB"]), "en");
  assert.equal(i18n.detectLang(null, ["fr-FR", "de"]), "en", "un idioma sin traducción cae al inglés");
  assert.equal(i18n.detectLang("xx", undefined), "en");
});

test("idiomas: fechas e importes siguen al idioma", () => {
  const mod = require(join(WEB, "lib.js")) as typeof lib & { setLocale: (l: string) => void };
  const now = new Date("2026-09-14T15:00:00Z");
  try {
    mod.setLocale("en");
    assert.equal(mod.fmtDayTitle(mod.localToday(0, now), now), "Today");
    assert.equal(mod.fmtDayTitle("2026-09-07", now), "Monday, September 7");
    assert.equal(mod.fmtMoney(1234567, "USD"), "$12,345.67", "en inglés, coma de miles y punto decimal");
    mod.setLocale("es");
    assert.equal(mod.fmtDayTitle("2026-09-07", now), "lunes 7 de septiembre");
    // 5 cifras: en español, 1234 va sin separador de miles por norma (lo
    // hace así Intl), así que se prueba con un número donde sí toca.
    assert.equal(mod.fmtMoney(1234567, "EUR"), "€12.345,67");
  } finally {
    mod.setLocale("es");
  }
});
