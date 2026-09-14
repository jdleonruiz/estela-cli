import type { AiCost, AmortizedShare, Money, Subscription } from "@estela/shared";
import { money } from "@estela/shared";

/**
 * Reparto de una cuota fija entre proyectos.
 *
 * Con una suscripción de precio fijo, sumar el coste por token da un número que
 * no salió de tu bolsillo. Lo que gastaste de verdad es la cuota. Para saber
 * cuánto de esa cuota "se comió" un proyecto, se reparte en proporción a lo que
 * consumió, usando la tarifa API equivalente como unidad de medida.
 *
 *   parte_del_proyecto = cuota_mensual x (consumo_proyecto / consumo_total_mes)
 *
 * El denominador es **todo** tu consumo del mes, incluido el de proyectos no
 * facturables. Si tus experimentos personales se comieron la mitad de la cuota,
 * a los clientes solo les corresponde la otra mitad. Repartir únicamente entre
 * lo facturable les cargaría un gasto que no generaron.
 */

export interface ConsumptionRow {
  readonly projectId: string;
  /** Mes en formato YYYY-MM. */
  readonly month: string;
  readonly consumption: AiCost;
}

/**
 * @param monthTotals Consumo total del mes en **toda** tu máquina, incluido el
 *   trabajo que aún no has asignado a ningún proyecto. Es el denominador
 *   correcto: la cuota la pagaste entera, la usaras en lo que la usaras.
 *
 *   Sin este dato, el denominador sería solo la suma de los proyectos
 *   configurados y el primero que registres cargaría con toda la cuota, aunque
 *   la mayor parte de tu consumo estuviera en repos sin configurar.
 */
export function amortize(
  rows: readonly ConsumptionRow[],
  subscriptions: readonly Subscription[],
  monthTotals?: ReadonlyMap<string, AiCost>,
): AmortizedShare[] {
  const byMonth = new Map<string, ConsumptionRow[]>();
  for (const row of rows) {
    const bucket = byMonth.get(row.month);
    if (bucket) bucket.push(row);
    else byMonth.set(row.month, [row]);
  }

  const shares: AmortizedShare[] = [];

  for (const [month, monthRows] of byMonth) {
    const fee = feeForMonth(subscriptions, month);
    const assigned = monthRows.reduce((sum, r) => sum + r.consumption.microUsd, 0);
    // Nunca por debajo de lo ya asignado: un total incoherente no puede hacer
    // que las partes sumen más del 100%.
    const total = Math.max(monthTotals?.get(month)?.microUsd ?? 0, assigned);

    for (const row of monthRows) {
      const share = total === 0 ? 0 : row.consumption.microUsd / total;
      shares.push({
        projectId: row.projectId,
        month,
        consumption: row.consumption,
        monthTotal: { microUsd: total },
        share,
        amount: fee
          ? money(Math.round(fee.amount * share), fee.currency)
          : money(0, "USD"),
      });
    }
  }

  return shares.sort((a, b) => a.month.localeCompare(b.month) || a.projectId.localeCompare(b.projectId));
}

/**
 * Suma de las cuotas vigentes en un mes.
 *
 * Se suman porque es habitual pagar varias a la vez (Claude Max y Cursor, por
 * ejemplo) y todas alimentan el mismo trabajo.
 */
export function feeForMonth(subscriptions: readonly Subscription[], month: string): Money | null {
  const start = new Date(`${month}-01T00:00:00Z`);
  const active = subscriptions.filter(
    (s) => s.effectiveFrom <= start && (s.effectiveTo === null || start < s.effectiveTo));

  if (active.length === 0) return null;

  const currency = active[0]!.monthlyFee.currency;
  let total = 0;
  for (const s of active) {
    if (s.monthlyFee.currency !== currency) {
      throw new TypeError(
        `Suscripciones en monedas distintas en ${month} (${currency} y ${s.monthlyFee.currency}). ` +
        `Únifica la moneda de las suscripciones: no se convierten automáticamente.`);
    }
    total += s.monthlyFee.amount;
  }
  return money(total, currency);
}

/** Mes (YYYY-MM, en UTC) de una fecha. */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Lo que le corresponde a un proyecto en un rango de meses. */
export function shareForProject(
  shares: readonly AmortizedShare[],
  projectId: string,
  months: readonly string[],
): Money | null {
  const relevant = shares.filter((s) => s.projectId === projectId && months.includes(s.month));
  if (relevant.length === 0) return null;

  const currency = relevant[0]!.amount.currency;
  return money(relevant.reduce((sum, s) => sum + s.amount.amount, 0), currency);
}
