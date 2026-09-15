/**
 * Dinero en unidades menores enteras. Nunca coma flotante.
 *
 * Un `0.1 + 0.2 !== 0.3` en una factura es un cliente preguntando por qué el
 * total no cuadra. Todo importe se guarda como entero:
 *   - Importes facturables  -> céntimos (EUR/USD/GBP tienen 2 decimales).
 *   - Coste de IA           -> micro-dólares (1e-6 USD).
 *
 * El coste de IA necesita micro-unidades porque una lectura de caché puede
 * valer $0.0007: en céntimos se redondearía a cero y el total del mes se
 * perdería entero.
 */

export type Currency = "EUR" | "USD" | "GBP" | "MXN" | "COP" | "ARS" | "CLP" | "PEN" | "BRL";

/** Decimales de la unidad menor por moneda (ISO 4217). */
const MINOR_UNIT_DIGITS: Record<Currency, number> = {
  EUR: 2, USD: 2, GBP: 2, MXN: 2, COP: 2, ARS: 2, CLP: 0, PEN: 2, BRL: 2,
};

/** Importe facturable. `amount` son unidades menores enteras de `currency`. */
export interface Money {
  readonly amount: number;
  readonly currency: Currency;
}

/** Coste de IA. Siempre USD: es la moneda en la que factura el proveedor. */
export interface AiCost {
  readonly microUsd: number;
}

export const ZERO_AI_COST: AiCost = { microUsd: 0 };

export function money(amount: number, currency: Currency): Money {
  if (!Number.isInteger(amount)) {
    throw new TypeError(`Money.amount debe ser entero (unidades menores), recibido ${amount}`);
  }
  return { amount, currency };
}

/** Convierte "13" o "13.50" (entrada humana) a unidades menores. */
export function parseMoney(input: string, currency: Currency): Money {
  const trimmed = input.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new TypeError(`Importe no reconocido: "${input}"`);
  }
  const digits = MINOR_UNIT_DIGITS[currency];
  const [whole = "0", frac = ""] = trimmed.split(".");
  const negative = whole.startsWith("-");
  const wholeDigits = negative ? whole.slice(1) : whole;
  const padded = (frac + "0".repeat(digits)).slice(0, digits);
  // Redondeo half-up sobre el primer decimal descartado.
  const nextDigit = frac.length > digits ? Number(frac[digits]) : 0;
  let minor = Number(wholeDigits) * 10 ** digits + Number(padded || "0");
  if (nextDigit >= 5) minor += 1;
  return { amount: negative ? -minor : minor, currency };
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { amount: a.amount + b.amount, currency: a.currency };
}

export function sumMoney(items: readonly Money[], currency: Currency): Money {
  let total = 0;
  for (const m of items) {
    if (m.currency !== currency) {
      throw new TypeError(`No se pueden sumar ${m.currency} y ${currency} sin tipo de cambio explícito`);
    }
    total += m.amount;
  }
  return { amount: total, currency };
}

export function addAiCost(a: AiCost, b: AiCost): AiCost {
  return { microUsd: a.microUsd + b.microUsd };
}

export function sumAiCost(items: readonly AiCost[]): AiCost {
  return { microUsd: items.reduce((acc, c) => acc + c.microUsd, 0) };
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`Monedas distintas: ${a.currency} vs ${b.currency}. Usa convertMoney con un tipo de cambio explícito.`);
  }
}

/**
 * Convierte entre monedas con un tipo de cambio **explícito y fechado**.
 *
 * No hay conversión implícita en ninguna parte del sistema: una factura emitida
 * en marzo debe seguir cuadrando en noviembre, así que el tipo usado se guarda
 * junto a la factura y jamás se recalcula con el de hoy.
 *
 * @param rate unidades de `to` por 1 unidad de `from` (ej. 0.92 para USD->EUR)
 */
export function convertMoney(from: Money, to: Currency, rate: number): Money {
  if (!(rate > 0) || !Number.isFinite(rate)) {
    throw new TypeError(`Tipo de cambio inválido: ${rate}`);
  }
  const fromDigits = MINOR_UNIT_DIGITS[from.currency];
  const toDigits = MINOR_UNIT_DIGITS[to];
  const major = from.amount / 10 ** fromDigits;
  return { amount: Math.round(major * rate * 10 ** toDigits), currency: to };
}

/** Coste de IA (micro-USD) a un importe facturable en la moneda indicada. */
export function aiCostToMoney(cost: AiCost, to: Currency, usdRate: number): Money {
  return convertMoney({ amount: Math.round(cost.microUsd / 10_000), currency: "USD" }, to, usdRate);
}

/**
 * Importe facturable de una duración a una tarifa por hora.
 *
 * Redondeo half-up sobre la unidad menor. El redondeo del *tiempo* (facturar a
 * bloques de 15 min, por ejemplo) es una decisión distinta y ocurre antes, en
 * `roundSeconds` — mezclar ambos redondeos es como se generan los descuadres.
 */
export function billableAmount(seconds: number, hourlyRate: Money): Money {
  if (seconds < 0) throw new RangeError(`Duración negativa: ${seconds}`);
  return { amount: Math.round((hourlyRate.amount * seconds) / 3600), currency: hourlyRate.currency };
}

/**
 * Redondea una duración al incremento de facturación pactado.
 * `incrementMinutes = 0` factura al segundo exacto.
 */
export function roundSeconds(seconds: number, incrementMinutes: number): number {
  if (incrementMinutes <= 0) return seconds;
  const step = incrementMinutes * 60;
  return Math.round(seconds / step) * step;
}

const SYMBOLS: Partial<Record<Currency, string>> = {
  EUR: "€", USD: "$", GBP: "£", MXN: "$", BRL: "R$",
};

/**
 * Locale por defecto de los importes. Español mientras nadie diga otra cosa;
 * la terminal lo cambia al arrancar según su idioma, para que "€1.254,79" no
 * salga así en una sesión en inglés.
 */
let defaultMoneyLocale = "es-EC";

export function setMoneyLocale(locale: string): void { defaultMoneyLocale = locale; }

export function formatMoney(m: Money, locale = defaultMoneyLocale): string {
  const digits = MINOR_UNIT_DIGITS[m.currency];
  const value = (m.amount / 10 ** digits).toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  const symbol = SYMBOLS[m.currency];
  return symbol ? `${symbol}${value}` : `${value} ${m.currency}`;
}

/** El coste de IA se muestra con 2 decimales, o 4 cuando es menor de un céntimo. */
export function formatAiCost(cost: AiCost): string {
  const usd = cost.microUsd / 1_000_000;
  if (usd !== 0 && Math.abs(usd) < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

/**
 * Fecha local en formato YYYY-MM-DD.
 *
 * `toISOString().slice(0,10)` da la fecha **UTC**, y eso parte la jornada en dos
 * para cualquiera al oeste de Greenwich: en Ecuador (UTC−5) todo lo trabajado
 * después de las 19:00 cae al día UTC siguiente. Una jornada de tarde-noche
 * aparecería repartida entre dos días y el parte diario dejaría de cuadrar.
 *
 * El día de trabajo es el del reloj de quien trabaja, no el de Greenwich.
 */
export function localDate(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function formatDuration(seconds: number): string {
  // Redondear a minutos ANTES de separar las horas. Al revés, 2h 59m 50s da
  // "2h 60m": los minutos redondean a 60 y las horas ya se calcularon aparte.
  const totalMinutes = Math.round(seconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}m`;
}
