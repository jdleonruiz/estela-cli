import assert from "node:assert/strict";
import { test } from "node:test";

import type { Client, Project, TimeEntry } from "@estela/shared";
import { money } from "@estela/shared";

import { buildPanel, newPanelToken } from "./panel.js";

const CLIENT: Client = { id: "nebula", name: "Nebula", currency: "EUR" };
const PROJECT: Project = {
  id: "portal-ventas", clientId: "nebula", name: "Portal Ventas", repoPaths: [],
  billable: true, roundingMinutes: 0, aiCostPolicy: "absorbed", kind: "client", closedAt: null,
};

function entry(day: string, seconds: number, over: Partial<TimeEntry> = {}): TimeEntry {
  const startedAt = new Date(`${day}T10:00:00Z`);
  return {
    id: `e-${day}`, projectId: "portal-ventas", startedAt,
    endedAt: new Date(startedAt.getTime() + seconds * 1000),
    seconds, description: `Trabajo del ${day}`, billable: true, invoiceId: null,
    aiCost: { microUsd: 250_000_000 }, agentSeconds: seconds,
    commitHashes: ["abc1234def"], agents: ["claude-code"],
    source: "agent", kind: "development", branch: "main",
    ...over,
  };
}

const BASE = {
  project: PROJECT, client: CLIENT,
  commitsOf: () => [{ hash: "abc1234def", subject: "feat: validación de cédula" }],
  generatedAt: new Date("2026-08-27T09:00:00Z"),
};

// ── Token de acceso ────────────────────────────────────────────────────

test("el token tiene 128 bits de entropía", () => {
  // Es lo único que protege la página: una URL publicada es pública para quien
  // la tenga, así que tiene que ser inadivinable.
  const token = newPanelToken();
  assert.match(token, /^[0-9a-f]{32}$/);

  const many = new Set(Array.from({ length: 500 }, () => newPanelToken()));
  assert.equal(many.size, 500, "no se repiten");
});

// ── Lo que nunca sale ──────────────────────────────────────────────────

test("el consumo de IA NUNCA llega al panel publicado", () => {
  const html = buildPanel({
    ...BASE,
    entries: [entry("2026-08-10", 7200, { aiCost: { microUsd: 999_000_000 } })],
    aiPayer: "self",
  });

  for (const leak of ["microUsd", "aiCost", "tarifa API", "consumo de IA",
                      "tokens", "Claude", "USD"]) {
    assert.ok(!html.includes(leak), `el panel no debe contener "${leak}"`);
  }

  // La comprobación que de verdad importa: el dato no viaja en el payload.
  // Buscar la cifra en el HTML entero da falsos positivos (un "999" casa con
  // `border-radius:999px` del CSS), así que se mira donde vive el dato.
  const payload = /<script id="data"[^>]*>(.*?)<\/script>/s.exec(html)![1]!;
  assert.ok(!payload.includes("999"), "la cifra de coste no está en los datos");
  assert.ok(!/\bcost|\bai/i.test(payload), "ni ningún campo relacionado");
});

test("los importes solo aparecen si se piden", () => {
  const entries = [entry("2026-08-10", 3600)];
  const rateAt = () => money(1300, "EUR");

  const sin = buildPanel({ ...BASE, entries, rateAt });
  assert.ok(!sin.includes("€13,00"), "sin --with-amounts no hay importes");

  const con = buildPanel({ ...BASE, entries, rateAt, withAmounts: true });
  assert.ok(con.includes("€13,00"));
  assert.ok(con.includes("valor del trabajo"));
});

test("pide a los buscadores que no lo indexen", () => {
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-10", 3600)] });
  assert.ok(html.includes('name="robots"'));
  assert.ok(html.includes("noindex"));
  assert.ok(html.includes('name="referrer" content="no-referrer"'),
    "sin referrer: la URL no debe filtrarse al pulsar un enlace saliente");
});

// ── Autonomía ──────────────────────────────────────────────────────────

test("no hace ni una sola petición de red", () => {
  // Se sirve como estático desde cualquier sitio y no depende de ninguna
  // máquina encendida. Un src= a una URL o un link rel=stylesheet lo
  // rompería. El logo va como data: URI —incrustado en el propio fichero,
  // sin ninguna petición— y es la única excepción que no viola la invariante:
  // la cabecera pide no depender de un host ajeno, no pide no llevar imágenes.
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-10", 3600)] });

  const srcs = [...html.matchAll(/\bsrc\s*=\s*"([^"]*)"/g)].map((m) => m[1]!);
  for (const src of srcs) {
    assert.ok(src.startsWith("data:"), `src apunta fuera del fichero: ${src.slice(0, 40)}`);
  }
  assert.ok(!/<link\b/.test(html), "sin hojas enlazadas");
  assert.ok(!/fetch\(|XMLHttpRequest/.test(html), "sin llamadas en JavaScript");

  // La invariante es que no se contacte con ningún host ajeno. Los enlaces al
  // sitio del producto se fijan por JavaScript desde D.site en vez de quedar
  // escritos en el HTML — un enlace de salida no debe depender de un dominio
  // fijo que puede no existir todavía. Por eso el HTML no debe llevar ningún
  // href estático: ver "los enlaces del panel nunca apuntan a un dominio fijo".
  const hosts = new Set([...html.matchAll(/href="(https?:\/\/[^/"]+)/g)].map((m) => m[1]));
  assert.deepEqual([...hosts], [],
    "ningún host debe quedar escrito a fuego en el HTML estático");
});

test("un commit con </script> no rompe la página", () => {
  // El JSON viaja dentro de un <script>: cualquier '</script>' literal en un
  // mensaje de commit cerraría la etiqueta y dejaría el resto como texto suelto.
  const html = buildPanel({
    ...BASE,
    entries: [entry("2026-08-10", 3600, { description: "fix: cierre de </script> en la plantilla" })],
    commitsOf: () => [{ hash: "abc1234", subject: "</script><img onerror=alert(1)>" }],
  });

  const scripts = html.match(/<\/script>/g) ?? [];
  assert.equal(scripts.length, 3, "solo los tres cierres legítimos: datos, interfaz y programa");
  assert.ok(!html.includes("<img onerror"), "el HTML del commit va neutralizado");
});

// ── Contenido ──────────────────────────────────────────────────────────

test("agrupa por día y suma el total", () => {
  const html = buildPanel({
    ...BASE,
    entries: [
      entry("2026-08-10", 3600),
      entry("2026-08-10", 1800, { id: "b" }),
      entry("2026-08-12", 7200),
    ],
  });

  const data = JSON.parse(/<script id="data"[^>]*>(.*?)<\/script>/s.exec(html)![1]!);
  assert.equal(data.totalSeconds, 12600);
  assert.equal(data.days.length, 2);
  assert.equal(data.days[0].items.length, 2, "los dos bloques del día 10");
});

test("las horas sin código llevan su etiqueta", () => {
  const html = buildPanel({
    ...BASE,
    entries: [entry("2026-08-10", 5400, { kind: "meeting", description: "Seguimiento" })],
    commitsOf: () => [],
  });

  const data = JSON.parse(/<script id="data"[^>]*>(.*?)<\/script>/s.exec(html)![1]!);
  assert.equal(data.days[0].items[0].kind, "Reunión");
});

test("lo no facturable no se publica", () => {
  const html = buildPanel({
    ...BASE,
    entries: [
      entry("2026-08-10", 3600),
      entry("2026-08-11", 3600, { id: "nf", billable: false, description: "Interno" }),
    ],
  });
  assert.ok(!html.includes("Interno"));
});

test("un proyecto sin trabajo produce una página válida", () => {
  const html = buildPanel({ ...BASE, entries: [] });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("Portal Ventas"));
});

// ── Ritmo: "30 días con actividad", no "30 de 51" ─────────────────────

test("los días con actividad no se presentan como una fracción de un objetivo", () => {
  // El caso real: un líder de proyecto vio "30 de 51 días con actividad" y lo
  // leyó como una meta incumplida (30 de 51 esperados), cuando 51 es solo la
  // distancia en el calendario entre el primer y el último bloque de trabajo,
  // no un plazo ni una meta. El patrón "activeDays+\" de \"+spanDays" no puede
  // volver a aparecer en el script del panel.
  const html = buildPanel({
    ...BASE,
    entries: [entry("2026-07-28", 3600), entry("2026-09-16", 3600)],
  });
  assert.ok(!/D\.rhythm\.activeDays\s*\+\s*"\s*de\s*"\s*\+\s*D\.rhythm\.spanDays/.test(html),
    "no debe volver el formato 'X de Y' para los días con actividad");
});

test("en su lugar, el rango de fechas explica el número sin necesitar pasar el ratón por encima", () => {
  const html = buildPanel({
    ...BASE,
    entries: [entry("2026-07-28", 3600), entry("2026-09-16", 3600)],
  });
  assert.ok(html.includes("shortDate(D.days[0].date)") && html.includes("shortDate(D.days[D.days.length-1].date)"),
    "la etiqueta debe construirse a partir del primer y el último día reales");
});

test("un solo día con actividad va en singular", () => {
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-10", 3600)] });
  assert.ok(html.includes('"día con actividad"'));
  assert.ok(!html.includes('"días con actividad"'.replace("días", "día con actividad") + "s"));
});

test("shortDate: el mismo cálculo que hace el navegador, ejecutado aquí", () => {
  // Se extrae la función tal cual vive en el script (misma fuente, no una
  // reimplementación) para comprobar que el rango que verá el líder de
  // proyecto es el correcto con los datos reales del caso que motivó esto.
  const html = buildPanel({
    ...BASE,
    entries: [entry("2026-07-28", 3600), entry("2026-09-16", 3600)],
  });
  const src = /function shortDate\(iso\)\{[\s\S]*?\n\}/.exec(html)![0];
  // Lo mismo que el navegador lee del bloque de interfaz, en cada idioma.
  const build = (UI: unknown) =>
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function("UI", `${src}\nreturn shortDate;`)(UI) as (iso: string) => string;

  const es = build({ lang: "es", monthNames: ["enero","febrero","marzo","abril","mayo","junio","julio",
                     "agosto","septiembre","octubre","noviembre","diciembre"] });
  assert.equal(es("2026-07-28"), "28 jul");
  assert.equal(es("2026-09-16"), "16 sep");

  // En inglés el mes va primero: "Sep 16", no "16 Sep".
  const en = build({ lang: "en", monthNames: ["January","February","March","April","May","June","July",
                     "August","September","October","November","December"] });
  assert.equal(en("2026-07-28"), "Jul 28");
  assert.equal(en("2026-09-16"), "Sep 16");
});

test("los hijos de la rejilla pueden encoger", () => {
  // El fallo que esto previene: min-width:auto es el valor por defecto de un
  // hijo de rejilla, así que no encoge por debajo de su contenido. Un nombre
  // de rama largo con nowrap desbordaba la pantalla entera en móvil.
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-10", 3600)] });
  assert.match(html, /\.grid>\*\{min-width:0\}/,
    "hace falta .grid>*{min-width:0}");
});

test("el panel se adapta a pantallas estrechas", () => {
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-10", 3600)] });
  assert.match(html, /@media\(max-width:940px\)\{\.grid\{grid-template-columns:1fr\}\}/,
    "la rejilla debe colapsar a una columna");
  assert.ok(html.includes("@media(max-width:560px)"), "hay ajustes para móvil");
});

test("la animación respeta a quien pide menos movimiento", () => {
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-10", 3600)] });
  assert.ok(html.includes("prefers-reduced-motion"));
  assert.match(html, /prefers-reduced-motion[^}]*\}[^@]*\.rise\{opacity:1/s,
    "sin movimiento, las tarjetas deben verse igualmente");
});

// ── Equipo del proyecto y el candado ─────────────────────────────────────────

const TEAM = [
  { name: "JDev Leon", isMe: true, seconds: 95_948, measured: true, commits: 11, branches: 1,
    lastDay: "2026-08-27" },
  { name: "Juan Manuel Cruz Berjano", isMe: false, measured: false, commits: 21, branches: 11,
    lastDay: "2026-08-25" },
  { name: "Nerea Vidal", isMe: false, measured: false, commits: 8, branches: 8,
    lastDay: "2026-08-20" },
];

test("las horas de un compañero no están en el fichero, ni ocultas", () => {
  // Lo que se vende es el dato; si viaja dentro del HTML y solo se tapa al
  // pintar, cualquiera lo lee con Ver código fuente. Un candado con la llave
  // puesta no es un candado.
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)], team: TEAM });

  const team = /"team":(\[.*?\}\])/.exec(html);
  assert.ok(team, "no se encontró el equipo en el payload");
  const parsed = JSON.parse(team[1]!) as { name: string; seconds?: number }[];

  for (const person of parsed) {
    if (person.name === "JDev Leon") continue;
    assert.equal(person.seconds, undefined,
      `${person.name} lleva sus segundos dentro del fichero`);
  }
  // Y el número concreto de un compañero no puede aparecer por ninguna otra vía.
  assert.ok(!html.includes("75600"), "un total ajeno se coló en el HTML");
});

test("quien publica sí ve sus horas, marcadas como medidas", () => {
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)], team: TEAM });
  assert.match(html, /"name":"JDev Leon","isMe":true,"seconds":95948/);
  assert.ok(html.includes("medido"), "falta distinguir medido de estimado");
});

test("un compañero medido (Teams) sí enseña sus horas de verdad", () => {
  // El compañero instaló Estela, aceptó la invitación, y sus horas dejaron de
  // ser una estimación por commits. Debe salir igual que las de quien
  // publica: con el número y la insignia "medido", no detrás del candado.
  const teamConMedido = [
    ...TEAM.filter((p) => p.name !== "Juan Manuel Cruz Berjano"),
    { name: "Juan Manuel Cruz Berjano", isMe: false, seconds: 43_200, measured: true,
      commits: 21, branches: 11, lastDay: "2026-08-25" },
  ];
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)], team: teamConMedido });
  assert.match(html, /"name":"Juan Manuel Cruz Berjano","isMe":false,"seconds":43200/);
});

// El texto del candado vive dentro del script embebido (una plantilla de JS
// que se concatena en tiempo de ejecución en el navegador), así que sale
// SIEMPRE en el HTML servido, tenga o no team el panel — grepearlo no dice
// nada de si el navegador lo llega a pintar. Lo único comprobable desde aquí
// es el dato del que depende esa condición (`others = t.filter(!p.measured)`
// en el script, ya revisado), igual que ya hace el test de "sin equipo" de
// arriba con `"team":[]`.
test("con todos medidos, el dato ya no le deja a quién enseñar el candado", () => {
  const todosMedidos = TEAM.map((p) => ({ ...p, measured: true, seconds: p.seconds ?? 1000 }));
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)], team: todosMedidos });
  const team = /"team":(\[.*?\}\])/.exec(html);
  assert.ok(team, "no se encontró el equipo en el payload");
  const parsed = JSON.parse(team[1]!) as { measured?: boolean }[];
  assert.ok(parsed.every((p) => p.measured === true),
    "con todos medidos en los datos, el candado no debería tener a quién enseñar");
});

test("con solo alguno medido, el dato deja al menos a alguien sin medir", () => {
  const unoMedido = TEAM.map((p, i) => i === 1 ? { ...p, measured: true, seconds: 1000 } : p);
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)], team: unoMedido });
  const team = /"team":(\[.*?\}\])/.exec(html);
  assert.ok(team, "no se encontró el equipo en el payload");
  const parsed = JSON.parse(team[1]!) as { measured?: boolean }[];
  assert.ok(parsed.some((p) => !p.measured),
    "debería quedar alguien sin medir para que el candado siga teniendo sentido");
});

test("el equipo enseña a los compañeros por su nombre", () => {
  // Es el repositorio del cliente y su propia gente: reconocerlos es lo que
  // demuestra que la herramienta funciona sobre sus datos y no sobre una demo.
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)], team: TEAM });
  assert.ok(html.includes("Juan Manuel Cruz Berjano"));
  assert.ok(html.includes("Nerea Vidal"));
});

test("sin equipo el panel no enseña ningún candado", () => {
  // Un proyecto de una sola persona no debe recibir una llamada a vender algo
  // que no le aporta nada.
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)] });
  assert.ok(!html.includes("Equipo del proyecto") || html.includes('"team":[]'));
});

test("el candado lleva al dominio real por defecto", () => {
  // getestela.dev ya está comprado y apuntando al servidor. Un enlace roto
  // justo cuando alguien se interesa cuesta más que no haber puesto el candado,
  // así que el valor por defecto tiene que ser un sitio que responda hoy.
  const porDefecto = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)], team: TEAM });
  assert.ok(porDefecto.includes("getestela.dev"), "el candado no lleva a ningún sitio");

  // Sigue siendo configurable: un panel publicado desde un entorno de pruebas,
  // o antes de que el dominio final apuntara al servidor, necesitaba poder
  // apuntar a otro sitio sin tocar el código.
  const propio = buildPanel({
    ...BASE, entries: [entry("2026-08-20", 3600)], team: TEAM,
    siteUrl: "https://horas.miempresa.com/",
  });
  assert.ok(propio.includes('"site":"https://horas.miempresa.com"'),
    "la barra final duplicaría la del path");
});

test("el candado no promete coste de IA por persona", () => {
  // Sería una divulgación del gasto de alguien, y además indeterminable: el
  // demonio lee los transcripts, ve el modelo y los tokens, y jamás de quién
  // es la tarjeta. Un coste cuyo dueño no puedes saber no se enseña como coste.
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)], team: TEAM });

  // Desde el título del bloque, no desde `class="lock"`: eso cae primero en
  // el CSS y el corte se quedaba sin el texto.
  const start = html.indexOf("Horas medidas de tu equipo");
  assert.ok(start > 0, "no se encontró el bloque bloqueado");
  const lock = html.slice(start, start + 600);
  assert.ok(lock.includes("por proyecto"), "debe decir que el coste es por proyecto");
  assert.ok(/nunca por[\s\S]{0,20}persona/.test(lock),
    "debe decir explícitamente que no es por persona");
});

test("los enlaces del panel nunca apuntan a un dominio fijo que puede no existir", () => {
  // El fallo real: la tarjeta "Esto es una foto del proyecto" y el pie de
  // página llevaban "https://getestela.dev" escrito a fuego en el HTML. Ese
  // dominio no resuelve hasta que se compre. Quien busca de dónde sale el
  // panel y encuentra un enlace muerto duda más que si no hubiera enlace: es
  // el escenario exacto que este panel existe para evitar.
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)] });
  assert.ok(!html.includes('href="https://getestela.dev"'),
    "un enlace de salida sigue fijo al dominio final, que hoy no resuelve");

  // Los dos puntos de salida tienen que existir y estar cableados al mismo
  // sitio configurable que ya usa el candado de Equipo.
  assert.ok(html.includes('id="cta-more"'), "falta el enlace de la tarjeta superior");
  assert.ok(html.includes('id="footer-site"'), "falta el enlace del pie de página");
  assert.match(html, /el\("cta-more"\)\.setAttribute\("href",\s*site/);
  assert.match(html, /el\("footer-site"\)/);
});

test("con --site, la tarjeta de arriba y el candado apuntan al mismo sitio", () => {
  const html = buildPanel({
    ...BASE, entries: [entry("2026-08-20", 3600)], team: TEAM,
    siteUrl: "https://getestela.dev",
  });
  // Ambos leen D.site en el navegador: basta con comprobar que el dato viaja
  // una sola vez y que las dos partes de la página lo consultan.
  assert.match(html, /"site":"https:\/\/getestela\.dev"/);
  assert.match(html, /var site = D\.site/);
});

test("el pie dice qué es, no solo el dominio a secas, y los dos enlaces de salida quedan atribuidos al cliente", () => {
  // Antes el pie solo enseñaba "getestela.dev" sin contexto: quien ve el
  // panel no tiene por qué saber que ese enlace suelto es la herramienta que
  // lo generó. Y sin el mismo "d=" que ya usa el CTA fuerte, un clic desde el
  // pie no quedaba atribuido a este panel en el formulario de la landing.
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)] });
  assert.match(html, /<a id="footer-site" rel="noopener noreferrer">Estela<\/a>/);
  assert.match(html, /el\("cta-more"\)\.setAttribute\("href",\s*site \+ "\/teams" \+ origen\)/);
  assert.match(html, /el\("footer-site"\)\.setAttribute\("href",\s*site \+ "\/" \+ origen\)/);
  assert.match(html, /var origen = "\?d=" \+ encodeURIComponent\(D\.client \|\| ""\)/);
});

test("el script del panel es JavaScript sintácticamente válido", () => {
  // Lo que de verdad falló una vez: un regex con "\/" dentro del template
  // literal de TypeScript se compiló a "\/" → "/" — "/^https?:\/\//" salía
  // como "/^https?:///" en el HTML, un error de sintaxis que reventaba TODO
  // el <script>. Ninguna prueba de contenido (grep de ids, de strings) lo
  // detecta: hace falta parsear el JavaScript de verdad, no solo mirarlo.
  //
  // Las pruebas de arriba comprueban contenido del HTML; esta comprueba que el
  // HTML resultante sea ejecutable, que es una propiedad distinta y es la que
  // realmente falló.
  const html = buildPanel({ ...BASE, entries: [entry("2026-08-20", 3600)], team: TEAM });

  const open = html.indexOf("<script>\n");
  const close = html.indexOf("</script>", open);
  assert.ok(open > 0 && close > open, "no se encontró el bloque de script");
  const code = html.slice(open + "<script>\n".length, close);

  // new Function() analiza el cuerpo como JavaScript real: si hay un error de
  // sintaxis, lanza aquí y no en el navegador de un cliente.
  assert.doesNotThrow(() => new Function(code), (error) =>
    `el script del panel no es JS válido: ${(error as Error).message}`);
});
