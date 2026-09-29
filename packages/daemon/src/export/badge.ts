/**
 * El badge de un proyecto para su README: "Built in 42 h · $18 of AI".
 *
 * Es una URL de shields.io con el texto dentro, nada más. No hay servidor de
 * Estela detrás ni nada que consultar al pintarlo: el número es el que tenía
 * el proyecto cuando se generó, y para actualizarlo se vuelve a generar. Así
 * no sale ningún dato de la máquina salvo el que la persona pega en su README.
 *
 * Siempre en inglés, como la web a la que enlaza: un README público se lee
 * desde cualquier sitio.
 */

const COLOR = "0E7C6B";
const DESTINO = "https://getestela.dev/en/";

export interface BadgeInput {
  /** Segundos de trabajo medido (sesiones de agente), no estimado. */
  readonly measuredSeconds: number;
  /** El coste ya formateado ("$18", "€12"), o null si no hay coste que contar. */
  readonly aiCost: string | null;
}

export function badgeText(input: BadgeInput): string {
  const hours = input.measuredSeconds / 3600;
  const horas = hours < 0.5 ? "<1" : Math.round(hours).toLocaleString("en-US");
  const built = `Built in ${horas} h`;
  return input.aiCost ? `${built} · ${input.aiCost} of AI` : built;
}

/**
 * Badge estático de un solo tramo: `/badge/<mensaje>-<color>`. En el texto,
 * shields.io lee `-` como separador y `_` como espacio, así que ambos van
 * doblados antes de codificar el resto.
 */
export function badgeUrl(text: string): string {
  const escapado = text.replace(/-/g, "--").replace(/_/g, "__");
  return `https://img.shields.io/badge/${encodeURIComponent(escapado)}-${COLOR}`;
}

export function badgeMarkdown(text: string): string {
  return `[![${text}](${badgeUrl(text)})](${DESTINO})`;
}
