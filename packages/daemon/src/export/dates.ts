import type { Lang } from "../i18n/index.js";

/**
 * Nombres de mes y de día de los documentos que se entregan a un cliente.
 *
 * A mano y no con `toLocaleDateString`: el documento lo abre el cliente en su
 * navegador, pero lo genera tu máquina, y el idioma tiene que ser el del
 * documento, no el de quien lo lee ni el del sistema que lo generó.
 */
export const MONTHS: Record<Lang, readonly string[]> = {
  es: ["enero", "febrero", "marzo", "abril", "mayo", "junio",
       "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
  en: ["January", "February", "March", "April", "May", "June",
       "July", "August", "September", "October", "November", "December"],
};

export const DAYS: Record<Lang, readonly string[]> = {
  es: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

/** "lunes 14 de septiembre" o "Monday, September 14". */
export function longDate(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const dia = DAYS[lang][d.getUTCDay()]!;
  const mes = MONTHS[lang][d.getUTCMonth()]!;
  return lang === "en" ? `${dia}, ${mes} ${d.getUTCDate()}` : `${dia} ${d.getUTCDate()} de ${mes}`;
}
