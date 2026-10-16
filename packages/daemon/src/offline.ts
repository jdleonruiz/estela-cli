/**
 * `ESTELA_OFFLINE=1`: Estela no abre ninguna conexión de red. Ni la
 * comprobación de versión, ni el banner del panel local, ni nada de la cuenta
 * (login, sync, Teams, paneles, pagos). Todo lo local sigue igual.
 *
 * Es el interruptor general; `ESTELA_NO_UPDATE_CHECK=1` apaga solo la
 * comprobación de versión.
 */
export function isOffline(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env["ESTELA_OFFLINE"];
  return v !== undefined && v !== "" && v !== "0";
}
