import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";

import { EN } from "./en.js";

/**
 * Idioma de la terminal.
 *
 * La frase en español ES la clave: `tr` recibe la plantilla tal cual está
 * escrita en el código y, en inglés, busca su traducción en `en.ts`. Es el
 * esquema de gettext, y aquí encaja mejor que las claves inventadas de la web
 * por dos razones: el código sigue leyéndose en español, como todo el
 * proyecto, y marcar un texto no toca su lógica — solo se le pone delante la
 * etiqueta. Un test recorre el código con el compilador de TypeScript y falla
 * si alguna frase marcada no tiene traducción.
 *
 *   tr`Tarifa de "${nombre}": ${importe}/hora`
 *   → clave  'Tarifa de "{0}": {1}/hora'
 *   → inglés 'Rate for "{0}": {1}/hour'
 *
 * Los huecos van numerados, así que el inglés puede reordenarlos.
 *
 * Este módulo lo carga también `bin.ts` para avisar de que Node es viejo, así
 * que no puede usar nada que no exista en Node 16.
 */

export type Lang = "es" | "en";

let current: Lang = "es";

/*
 * El idioma de una petición concreta del panel local. `estela web` sirve a un
 * navegador que puede estar en otro idioma que la terminal que lo arrancó: un
 * error lanzado dentro de una petición tiene que salir en el del navegador, y
 * lo que imprime la terminal, en el suyo. Con una variable global se pisarían
 * entre peticiones simultáneas; AsyncLocalStorage lo ata a cada una.
 */
const scoped = new AsyncLocalStorage<Lang>();

export function setLang(lang: Lang): void { current = lang; }
export function getLang(): Lang { return scoped.getStore() ?? current; }

/** Ejecuta `fn` con otro idioma solo para lo que ocurra dentro, incluidos los await. */
export function withLang<T>(lang: Lang, fn: () => T): T {
  return scoped.run(lang, fn);
}

/**
 * En qué idioma sale un documento que se le entrega a un cliente.
 *
 * De más a menos explícito: un `--lang` escrito en el comando, luego el idioma
 * que se le fijó a ese cliente, y solo si nadie dijo nada, el de la terminal.
 * El del cliente va por encima de la terminal porque el documento no lo lee
 * quien lo genera: un freelance con la terminal en español que factura a una
 * empresa alemana no quiere mandarle un PDF en español porque su Mac lo esté.
 */
export function documentLang(input: {
  readonly explicit?: string | null | undefined;
  readonly clientLanguage?: Lang | null | undefined;
}): Lang {
  if (input.explicit === "es" || input.explicit === "en") return input.explicit;
  return input.clientLanguage ?? getLang();
}

/** El locale con el que se escriben los importes de un documento en ese idioma. */
export function moneyLocale(lang: Lang): string {
  return lang === "en" ? "en-US" : "es-EC";
}

/** La clave de una plantilla: sus trozos fijos unidos por {0}, {1}… */
export function keyOf(strings: readonly string[]): string {
  let key = strings[0] ?? "";
  for (let i = 1; i < strings.length; i++) key += `{${i - 1}}` + strings[i];
  return key;
}

export function tr(strings: TemplateStringsArray, ...values: unknown[]): string {
  const key = keyOf(strings);
  // Sin traducción cae al español en vez de romper: mejor una frase en el otro
  // idioma que un hueco. El test es quien impide que eso llegue a publicarse.
  const template = getLang() === "en" ? (EN[key] ?? key) : key;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const i = Number(index);
    return i < values.length ? String(values[i]) : match;
  });
}

/**
 * "es_EC.UTF-8", "es-ES", "en" → el idioma que toca. Uno que no es ni español
 * ni inglés cuenta como inglés: es la traducción que hay. "C" y "POSIX" no
 * dicen ningún idioma, así que devuelven null y se sigue buscando.
 */
export function langFromTag(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  const base = tag.trim().toLowerCase().split(/[_.@-]/)[0] ?? "";
  if (!base || base === "c" || base === "posix") return null;
  return base === "es" ? "es" : "en";
}

export interface LangInput {
  readonly flag?: string | undefined;
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
  /** El primer idioma del sistema en macOS, o null. Inyectable para los tests. */
  readonly appleLanguage?: () => string | null;
  /** El locale que ve Intl. Inyectable para los tests. */
  readonly intlLocale?: () => string | null;
}

/**
 * De qué idioma hablarle a esta persona, de más a menos explícito.
 *
 * El orden importa por un caso muy concreto: en macOS la terminal suele traer
 * `LANG=C.UTF-8`, que no dice nada, aunque el sistema esté en español. Si con
 * eso bastara para elegir inglés, toda la gente que ya usa Estela en español
 * pasaría a verla en inglés al actualizar. Por eso "C" no decide, y en ese caso
 * se pregunta al sistema.
 */
export function detectLang(input: LangInput): Lang {
  const fromFlag = input.flag === "es" || input.flag === "en" ? input.flag : null;
  if (fromFlag) return fromFlag;

  const explicit = input.env["ESTELA_LANG"];
  if (explicit === "es" || explicit === "en") return explicit;

  for (const name of ["LC_ALL", "LC_MESSAGES", "LANG"]) {
    const lang = langFromTag(input.env[name]);
    if (lang) return lang;
  }

  if (input.platform === "darwin") {
    const lang = langFromTag((input.appleLanguage ?? readAppleLanguage)());
    if (lang) return lang;
  }

  return langFromTag((input.intlLocale ?? readIntlLocale)()) ?? "en";
}

function readAppleLanguage(): string | null {
  try {
    // Formato: ( "es-EC", "en-EC" ). Tarda unos 10 ms y solo se llega aquí si
    // el entorno no dice ya el idioma.
    const out = execFileSync("defaults", ["read", "-g", "AppleLanguages"],
      { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] });
    const match = /[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)*/.exec(out);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

function readIntlLocale(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return null; }
}
