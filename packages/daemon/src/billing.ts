import type { DatabaseSync } from "node:sqlite";

import { cloudPost, CloudError } from "./cloud/client.js";
import * as store from "./db/store.js";
import { NoAccountError } from "./publish.js";

/**
 * Cobro. La CLI nunca habla con Stripe directamente — solo con nuestra API,
 * que es quien tiene la clave secreta. Aquí solo pedimos la URL alojada
 * (de Checkout o del Portal) y la enseñamos; completar el pago o cancelar
 * pasa siempre en la página de Stripe, nunca en la terminal.
 */

export { NoAccountError };

function requireAccount(db: DatabaseSync) {
  const account = store.getCloudAccount(db);
  if (!account) {
    throw new NoAccountError(
      `Necesitas una cuenta para esto. Vincúlala con:\n\n` +
      `  estela login --email tu@correo.com\n`);
  }
  return account;
}

async function unwrap<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof CloudError && error.status === 401) {
      throw new NoAccountError(
        `Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n` +
        `  estela login --email tu@correo.com\n`);
    }
    throw error;
  }
}

export async function upgradeCheckout(
  db: DatabaseSync, plan: "pro" | "teams", interval: "monthly" | "yearly" = "monthly",
): Promise<{ url: string }> {
  const account = requireAccount(db);
  return unwrap(cloudPost(account.apiBaseUrl, "/billing/checkout", { plan, interval },
    { deviceToken: account.deviceToken }));
}

export async function openBillingPortal(db: DatabaseSync): Promise<{ url: string }> {
  const account = requireAccount(db);
  return unwrap(cloudPost(account.apiBaseUrl, "/billing/portal", {},
    { deviceToken: account.deviceToken }));
}
