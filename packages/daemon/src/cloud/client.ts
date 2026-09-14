/**
 * Habla con la API de cuentas por `fetch` nativo, sin dependencias.
 *
 * El demonio tiene una única dependencia declarada (`@estela/shared`) y esa
 * lista vacía es su argumento de confianza: nadie instala un programa que lee
 * sus transcripts si no puede auditarlo en una tarde. Un cliente HTTP de npm
 * no vale lo que cuesta romper eso.
 */

export class CloudError extends Error {
  constructor(message: string, readonly status?: number) { super(message); }
}

export interface CloudPostOptions {
  /** El token de dispositivo de `estela login`. Sin él, la llamada va sin sesión. */
  readonly deviceToken?: string;
}

/**
 * Versión de la CLI que hace la llamada. Va en todas las peticiones, no solo
 * en las autenticadas: es lo único que permite ver algún día si alguien lleva
 * meses en una versión vieja sin saberlo.
 */
let clientVersion = "0.0.0";
export function setClientVersion(v: string): void { clientVersion = v; }

export async function cloudPost<T>(
  baseUrl: string, path: string, body: unknown, options: CloudPostOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "estela-version": clientVersion,
        ...(options.deviceToken ? { authorization: `Bearer ${options.deviceToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CloudError(
      `Sin respuesta de ${baseUrl}. Puede ser tu conexión o que el servicio esté caído; ` +
      `en ambos casos, nada de lo tuyo se ha perdido: vuelve a intentarlo.`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    // El status viaja aparte del mensaje: quien llama necesita distinguir
    // "no tienes sesión" (401, pide login) de "cuota agotada" (402, pide
    // upgrade) sin tener que analizar el texto en español.
    throw new CloudError(
      typeof data["error"] === "string" ? data["error"] : `Error ${res.status}`, res.status);
  }
  return data as T;
}

/**
 * Primer GET autenticado de verdad del CLI. Hasta Teams, todo lo que hablaba
 * con la cuenta era una escritura (`cloudPost`); listar los miembros de un
 * proyecto es la primera vez que hace falta leer algo.
 */
export async function cloudGet<T>(
  baseUrl: string, path: string, options: CloudPostOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: {
        "estela-version": clientVersion,
        ...(options.deviceToken ? { authorization: `Bearer ${options.deviceToken}` } : {}),
      },
    });
  } catch {
    throw new CloudError(
      `Sin respuesta de ${baseUrl}. Puede ser tu conexión o que el servicio esté caído; ` +
      `en ambos casos, nada de lo tuyo se ha perdido: vuelve a intentarlo.`);
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new CloudError(
      typeof data["error"] === "string" ? data["error"] : `Error ${res.status}`, res.status);
  }
  return data as T;
}
