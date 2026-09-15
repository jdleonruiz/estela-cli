"use strict";

/* Lógica pura de la interfaz: fechas, formatos y rangos.
 *
 * Vive aparte para poder probarla sin navegador. Tres de los fallos que
 * llegaron a producción —el "2h 60m", el día de hoy calculado en UTC y el
 * salto de día al navegar— eran de aquí, y todos habrían caído con un test.
 *
 * Se carga como script normal en el navegador y con require() en los tests, sin
 * empaquetador de por medio. */

(function (root) {
  const SYMBOLS = { EUR: "€", USD: "$", GBP: "£", BRL: "R$" };

  /* Lo que cambia con el idioma y no es una frase: nombres de días y meses,
     cómo se titula un día y cómo se separan los decimales. Las frases viven en
     i18n.js; esto se queda aquí porque lo usan funciones puras que se prueban
     sin navegador. Español por defecto: es lo que asumen los tests de siempre. */
  const LOCALES = {
    es: {
      tag: "es-ES",
      days: ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"],
      months: ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
      today: "Hoy", yesterday: "Ayer",
      dayTitle: (weekday, day, month) => `${weekday} ${day} de ${month}`,
    },
    en: {
      tag: "en-US",
      days: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
      months: ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"],
      today: "Today", yesterday: "Yesterday",
      dayTitle: (weekday, day, month) => `${weekday}, ${month} ${day}`,
    },
  };
  let locale = LOCALES.es;

  function setLocale(lang) { locale = LOCALES[lang] || LOCALES.es; }
  /** Etiqueta BCP 47 para toLocaleString y compañía: "es-ES" o "en-US". */
  function localeTag() { return locale.tag; }

  /** Fecha local en YYYY-MM-DD. Nunca `toISOString()` a secas: eso da la de Greenwich. */
  function localDay(date) {
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
  }

  function localToday(offsetDays = 0, now = new Date()) {
    const d = new Date(now);
    d.setDate(d.getDate() + offsetDays);
    return localDay(d);
  }

  /**
   * Suma días a una fecha en YYYY-MM-DD.
   *
   * Se ancla a mediodía: a las 00:30, sumar un día operando en UTC saltaría dos
   * en el calendario de quien mira.
   */
  function shiftDay(iso, days) {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + days);
    return localDay(d);
  }

  /**
   * Duración legible.
   *
   * Redondea a minutos ANTES de separar las horas: al revés, 2h 59m 50s sale
   * como "2h 60m", y eso llegó a imprimirse en un informe.
   */
  function fmtDuration(seconds) {
    const total = Math.round(seconds / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
  }

  /** Importe desde unidades menores. `null` cuando no hay dato, no "0". */
  function fmtMoney(minor, currency) {
    if (minor === null || minor === undefined) return null;
    const value = (minor / 100).toLocaleString(locale.tag, {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    const symbol = SYMBOLS[currency];
    return symbol ? `${symbol}${value}` : `${value} ${currency}`;
  }

  function fmtDayTitle(iso, now = new Date()) {
    if (iso === localToday(0, now)) return locale.today;
    if (iso === localToday(-1, now)) return locale.yesterday;
    const d = new Date(`${iso}T12:00:00`);
    return locale.dayTitle(locale.days[d.getDay()], d.getDate(), locale.months[d.getMonth()]);
  }

  /** Rango de un periodo. "all" devuelve vacío: todo lo pendiente, sin acotar. */
  function periodRange(period, now = new Date()) {
    if (period === "all") return { from: "", to: "" };
    const to = localToday(0, now);
    const from = new Date(now);
    if (period === "week") from.setDate(from.getDate() - 6);
    else if (period === "month") from.setDate(1);
    else from.setMonth(from.getMonth() - 2, 1);
    return { from: localDay(from), to };
  }

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const api = { LOCALES, setLocale, localeTag, localDay, localToday, shiftDay, fmtDuration,
                fmtMoney, fmtDayTitle, periodRange, esc };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
