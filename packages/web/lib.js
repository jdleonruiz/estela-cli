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
  const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const SYMBOLS = { EUR: "€", USD: "$", GBP: "£", BRL: "R$" };

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
    const value = (minor / 100).toLocaleString("es-ES", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    const symbol = SYMBOLS[currency];
    return symbol ? `${symbol}${value}` : `${value} ${currency}`;
  }

  function fmtDayTitle(iso, now = new Date()) {
    if (iso === localToday(0, now)) return "Hoy";
    if (iso === localToday(-1, now)) return "Ayer";
    const d = new Date(`${iso}T12:00:00`);
    return `${DAYS[d.getDay()]} ${d.getDate()} de ${MONTHS[d.getMonth()]}`;
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

  const api = { DAYS, MONTHS, localDay, localToday, shiftDay, fmtDuration,
                fmtMoney, fmtDayTitle, periodRange, esc };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof globalThis !== "undefined" ? globalThis : this);
