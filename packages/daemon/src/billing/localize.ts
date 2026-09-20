import type { TimeEntry } from "@estela/shared";

import { tr, withLang } from "../i18n/index.js";
import { kindLabel } from "../i18n/labels.js";

/**
 * Las frases que Estela misma escribe en la descripción de un bloque, y cómo
 * volver a decirlas en otro idioma.
 *
 * La descripción se guarda al importar, en el idioma de la terminal de ese
 * momento. Pero el documento lo lee un cliente, en SU idioma: sin esto, un panel
 * en inglés traía "(+3 commits más)" en más de la mitad de los bloques, porque
 * cualquier bloque con dos commits o más lleva esa cola.
 *
 * Lo que NO se toca nunca es texto tuyo: el asunto de un commit y lo que
 * escribes con `estela log --what`. Por eso cada plantilla solo se reconoce
 * cuando el bloque tiene la forma que la produjo (ver `localizeDescription`).
 */

/** "Asunto (+2 commits más)". `extra` son los asuntos que no se nombran. */
export function moreCommits(first: string, extra: number): string {
  return extra === 1 ? tr`${first} (+1 commit más)` : tr`${first} (+${extra} commits más)`;
}

/** "Desarrollo en la-rama": lo que se escribe cuando el bloque no tiene commits. */
export function developmentOn(branch: string | null): string {
  return branch ? tr`Desarrollo en ${branch}` : tr`Desarrollo`;
}

// Las frases de arriba, tal como se guardaron en cada idioma. Son históricas:
// lo guardado no cambia si algún día se retoca la traducción, así que estos
// patrones NO se derivan del catálogo — se quedan como están.
const MORE = /^([\s\S]*) \(\+(\d+) (?:commits? más|more commits?)\)$/;
const DEVELOPMENT = /^(?:Desarrollo|Development)(?: (?:en|on) ([\s\S]+))?$/;

type Describable = Pick<TimeEntry, "description" | "source" | "kind" | "commitHashes">;

/**
 * La descripción de un bloque, en el idioma en curso (`getLang()`).
 *
 * Solo se reescribe lo que se sabe que escribió Estela, y solo si el bloque
 * tiene la forma que lo produjo:
 *
 *  - "(+N commits más)": el bloque tiene dos commits o más. Un solo commit cuyo
 *    asunto acabe casualmente así es texto tuyo.
 *  - "Desarrollo [en rama]": el bloque no tiene commits, que es cuando Estela
 *    cae a la rama. Con commits, "Desarrollo en curso" es el asunto de uno.
 *  - Una hora anotada a mano solo cambia si su texto es EXACTAMENTE la etiqueta
 *    de su tipo, que es lo que se guarda cuando no escribes `--what`.
 */
export function localizeDescription(entry: Describable): string {
  const text = entry.description;

  if (entry.source === "manual") {
    const eraLaEtiqueta = (["es", "en"] as const).some(
      (lang) => withLang(lang, () => kindLabel(entry.kind)) === text);
    return eraLaEtiqueta ? kindLabel(entry.kind) : text;
  }

  if (entry.commitHashes.length >= 2) {
    const m = MORE.exec(text);
    if (m) return moreCommits(m[1]!, Number(m[2]));
    return text;
  }

  if (entry.commitHashes.length === 0) {
    const m = DEVELOPMENT.exec(text);
    if (m) return developmentOn(m[1] ?? null);
  }

  return text;
}

/** El mismo bloque con su descripción en el idioma en curso. */
export function withLocalizedDescription<T extends Describable>(entry: T): T {
  const description = localizeDescription(entry);
  return description === entry.description ? entry : { ...entry, description };
}
