import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

import { EN } from "./en.js";
import { detectLang, documentLang, getLang, keyOf, langFromTag, moneyLocale, setLang, tr, withLang } from "./index.js";

/**
 * El idioma de la terminal.
 *
 * El fallo que más cuesta ver es el silencioso: una frase marcada con tr`` sin
 * traducción sale en español en mitad de una sesión en inglés, y nada falla.
 * O una frase que alguien añade sin marcar. Los dos se buscan aquí leyendo el
 * código con el compilador de TypeScript, no con expresiones regulares: las
 * plantillas anidadas y los `${}` las harían fallar en los casos que importan.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ts = require("typescript") as typeof import("typescript");

const SRC = join(__dirname, "..", "..", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

interface Found { readonly key: string; readonly where: string }

/** Todas las frases marcadas con tr`` del código, con su clave. */
function taggedPhrases(): Found[] {
  const found: Found[] = [];
  for (const file of sourceFiles(SRC)) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const visit = (node: import("typescript").Node): void => {
      if (ts.isTaggedTemplateExpression(node) && ts.isIdentifier(node.tag) && node.tag.text === "tr") {
        const t = node.template;
        const parts = ts.isNoSubstitutionTemplateLiteral(t)
          ? [t.text]
          : [t.head.text, ...t.templateSpans.map((span) => span.literal.text)];
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        found.push({ key: keyOf(parts), where: `${relative(SRC, file)}:${line}` });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

const huecos = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(",");

test("i18n: toda frase marcada en el código tiene traducción al inglés", () => {
  const faltan = taggedPhrases().filter((f) => !(f.key in EN));
  assert.deepEqual(faltan.map((f) => `${f.where}  ${JSON.stringify(f.key)}`), [],
    "añade estas frases a i18n/en.ts");
});

test("i18n: el catálogo no guarda traducciones de frases que ya no existen", () => {
  // Al cambiar una frase en español cambia su clave, y la traducción vieja se
  // queda huérfana: no rompe nada, pero el catálogo se llena de basura que
  // nadie sabe si puede borrar.
  const vivas = new Set(taggedPhrases().map((f) => f.key));
  const huerfanas = Object.keys(EN).filter((key) => !vivas.has(key));
  assert.deepEqual(huerfanas, [], "estas claves de en.ts ya no están en el código");
});

test("i18n: cada traducción usa exactamente los mismos huecos", () => {
  // "{1} bloques" traducido como "{0} blocks" pondría el número equivocado.
  const mal = Object.entries(EN).filter(([es, en]) => huecos(es) !== huecos(en));
  assert.deepEqual(mal, []);
});

test("i18n: no queda texto en español sin marcar en lo que se imprime", () => {
  // La forma de romper el inglés sin que falle nada: un console.log nuevo con
  // la frase escrita a pelo. Se miran los argumentos de console.* y de los
  // errores que ve la persona.
  const ERRORES = new Set(["UserError", "Error", "CloudError", "NoAccountError", "NotSyncedError", "InvoiceError"]);
  const espanol = /[áéíóúñ¿¡]|\b(de|con|sin|por|para|los|las|del|una|hay|que|tu|tus|ya|al|en|es|no|se)\b/i;
  const sueltas: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const literales = (node: import("typescript").Node): void => {
      if (ts.isTaggedTemplateExpression(node)) return;
      let texto: string | null = null;
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) texto = node.text;
      if (ts.isTemplateExpression(node)) {
        texto = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
      }
      if (texto !== null && /[a-záéíóúñ]{3}/i.test(texto) && espanol.test(texto)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        sueltas.push(`${relative(SRC, file)}:${line}  ${JSON.stringify(texto).slice(0, 80)}`);
      }
      ts.forEachChild(node, literales);
    };
    const visit = (node: import("typescript").Node): void => {
      const esConsola = ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "console";
      const esError = ts.isNewExpression(node) && ts.isIdentifier(node.expression) &&
        ERRORES.has(node.expression.text);
      if ((esConsola || esError) && (node as import("typescript").CallExpression).arguments) {
        for (const arg of (node as import("typescript").CallExpression).arguments) literales(arg);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  assert.deepEqual(sueltas, [], "márcalas con tr``");
});

test("i18n: la ayuda en inglés documenta los mismos comandos y opciones", () => {
  // Dos textos completos se separan fácil: se añade un comando en uno y el
  // otro se queda sin él.
  const cli = readFileSync(join(SRC, "cli.ts"), "utf8");
  const bloque = (name: string) => {
    const start = cli.indexOf(`const ${name} = \``);
    assert.ok(start >= 0, `no encuentro ${name}`);
    return cli.slice(start, cli.indexOf("\n`;", start));
  };
  const firma = (text: string) => ({
    comandos: [...new Set([...text.matchAll(/^ {2}estela ([a-z-]+(?: [a-z-]+)?)/gm)].map((m) => m[1]))].sort(),
    opciones: [...new Set([...text.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]))].sort(),
  });
  assert.deepEqual(firma(bloque("HELP_EN")), firma(bloque("HELP_ES")));
});

test("i18n: tr deja el español tal cual y traduce al inglés", () => {
  const antes = getLang();
  try {
    const nombre = "Web";
    setLang("es");
    assert.equal(tr`Proyecto "${nombre}" guardado.`, 'Proyecto "Web" guardado.');
    setLang("en");
    assert.equal(tr`Proyecto "${nombre}" guardado.`, 'Project "Web" saved.');
    // Una frase sin traducción sale en español, no vacía ni con la clave rota.
    assert.equal(tr`Frase inventada ${nombre} que no está`, "Frase inventada Web que no está");
  } finally { setLang(antes); }
});

test("i18n: los huecos se pueden reordenar en la traducción", () => {
  assert.equal(keyOf(["a ", " b ", " c"]), "a {0} b {1} c");
  // El valor 1 va donde la traducción diga {1}, esté donde esté.
  const plantilla = "{1} antes que {0}";
  const valores = ["uno", "dos"];
  assert.equal(plantilla.replace(/\{(\d+)\}/g, (_, i: string) => valores[Number(i)]!), "dos antes que uno");
});

test("i18n: langFromTag entiende las formas habituales y no se inventa idioma con C", () => {
  assert.equal(langFromTag("es_EC.UTF-8"), "es");
  assert.equal(langFromTag("es-ES"), "es");
  assert.equal(langFromTag("en_US.UTF-8"), "en");
  assert.equal(langFromTag("fr_FR.UTF-8"), "en", "un idioma sin traducción cae al inglés");
  assert.equal(langFromTag("C.UTF-8"), null, "C no dice ningún idioma");
  assert.equal(langFromTag("POSIX"), null);
  assert.equal(langFromTag(""), null);
  assert.equal(langFromTag(undefined), null);
});

test("i18n: detectLang, de lo más explícito a lo menos", () => {
  const nunca = () => { throw new Error("no debería preguntar al sistema"); };
  const base = { platform: "linux", appleLanguage: nunca, intlLocale: nunca };

  assert.equal(detectLang({ ...base, flag: "en", env: { ESTELA_LANG: "es", LANG: "es_ES.UTF-8" } }), "en",
    "--lang gana a todo");
  assert.equal(detectLang({ ...base, env: { ESTELA_LANG: "en", LANG: "es_ES.UTF-8" } }), "en",
    "ESTELA_LANG gana al entorno");
  assert.equal(detectLang({ ...base, env: { LC_ALL: "es_EC.UTF-8", LANG: "en_US.UTF-8" } }), "es",
    "LC_ALL gana a LANG");
  assert.equal(detectLang({ ...base, env: { LANG: "en_GB.UTF-8" } }), "en");
});

test("i18n: con LANG=C en macOS pregunta al sistema, no elige inglés", () => {
  // El caso real: la terminal con LANG=C.UTF-8 en un Mac en español. Elegir
  // inglés ahí pasaría a toda la gente que ya usa Estela a verla en inglés.
  assert.equal(detectLang({
    env: { LANG: "C.UTF-8" }, platform: "darwin",
    appleLanguage: () => "es-EC", intlLocale: () => "en-US",
  }), "es");
  assert.equal(detectLang({
    env: { LANG: "C.UTF-8" }, platform: "darwin",
    appleLanguage: () => "en-GB", intlLocale: () => "es-ES",
  }), "en");
});

test("i18n: sin nada que lo diga, Intl; y si tampoco, inglés", () => {
  assert.equal(detectLang({ env: {}, platform: "win32", intlLocale: () => "es-MX" }), "es");
  assert.equal(detectLang({ env: {}, platform: "linux", intlLocale: () => null }), "en");
  assert.equal(detectLang({ env: {}, platform: "darwin", appleLanguage: () => null, intlLocale: () => null }), "en");
});

test("i18n: dos peticiones a la vez no se pisan el idioma", async () => {
  // El panel local puede atender a la vez una petición en inglés y otra en
  // español. Con el idioma en una variable global, la que termina después
  // cogería el de la otra en cuanto hubiera un await de por medio.
  const antes = getLang();
  setLang("es");
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const [en, es] = await Promise.all([
      withLang("en", async () => { await espera(20); return tr`Invitación revocada.`; }),
      withLang("es", async () => { await espera(5); return tr`Invitación revocada.`; }),
    ]);
    assert.equal(en, "Invitation revoked.");
    assert.equal(es, "Invitación revocada.");
    assert.equal(tr`Invitación revocada.`, "Invitación revocada.", "fuera de una petición, el de la terminal");
  } finally { setLang(antes); }
});

test("i18n: documentLang, de lo más explícito a lo menos: --lang, cliente, terminal", () => {
  setLang("es");
  try {
    // Sin nada: la terminal.
    assert.equal(documentLang({}), "es");
    setLang("en");
    assert.equal(documentLang({}), "en");
    // El idioma del cliente gana a la terminal: el documento no lo lee quien lo genera.
    assert.equal(documentLang({ clientLanguage: "es" }), "es");
    // Un --lang escrito en el comando gana a todo.
    assert.equal(documentLang({ explicit: "es", clientLanguage: "en" }), "es");
    // Un valor que no es un idioma no decide nada.
    assert.equal(documentLang({ explicit: "fr", clientLanguage: "es" }), "es");
    assert.equal(documentLang({ explicit: null, clientLanguage: null }), "en");
    // Dentro de withLang, "la terminal" es la de esa petición.
    assert.equal(withLang("es", () => documentLang({})), "es");
  } finally { setLang("es"); }
});

test("i18n: moneyLocale, un locale por idioma", () => {
  assert.equal(moneyLocale("en"), "en-US");
  assert.equal(moneyLocale("es"), "es-EC");
});
