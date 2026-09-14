import type { DatabaseSync } from "node:sqlite";

import * as store from "../db/store.js";
import { cloudPost, CloudError } from "./client.js";

/**
 * `estela login` / `estela logout`.
 *
 * Login por dispositivo: se pide un código, se confirma desde el correo (o,
 * mientras la Fase 3 no exista, desde la consola de la API en pruebas
 * locales), y el CLI lo recoge preguntando cada pocos segundos. Nada de esto
 * sincroniza datos todavía — solo deja la máquina vinculada a una cuenta.
 */

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

interface DeviceStart {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUrl: string;
}

interface DevicePoll {
  readonly status: "pending" | "authorized" | "expired";
  readonly accountId?: string;
  readonly deviceToken?: string;
}

export async function login(db: DatabaseSync, email: string, apiBaseUrl: string): Promise<void> {
  const start = await cloudPost<DeviceStart>(apiBaseUrl, "/auth/device/start", { email });

  console.log(`\nTe mandamos un enlace a ${email}. Confírmalo para vincular esta máquina.`);
  console.log(`Código de verificación (debe coincidir con el del enlace): ${start.userCode}`);
  console.log("Esperando confirmación...\n");

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const poll = await cloudPost<DevicePoll>(apiBaseUrl, "/auth/device/poll", { deviceCode: start.deviceCode });

    if (poll.status === "expired") {
      throw new CloudError("El login caducó o el enlace ya se usó. Ejecuta \"estela login\" otra vez.");
    }
    if (poll.status === "authorized" && poll.accountId && poll.deviceToken) {
      store.setCloudAccount(db, {
        accountId: poll.accountId,
        email,
        plan: "free",
        deviceToken: poll.deviceToken,
        apiBaseUrl,
        linkedAt: new Date(),
      });
      console.log(`Vinculado como ${email}.`);
      return;
    }
    // "pending": se sigue esperando.
  }

  throw new CloudError("No se confirmó el login a tiempo. Ejecuta \"estela login\" otra vez.");
}

export async function logout(db: DatabaseSync): Promise<void> {
  const account = store.getCloudAccount(db);
  if (!account) {
    console.log("Esta máquina ya era local.");
    return;
  }

  try {
    await cloudPost(account.apiBaseUrl, "/auth/device/revoke", { deviceToken: account.deviceToken });
  } catch {
    // Sin servidor a mano no se puede revocar en remoto, pero desvincular
    // localmente sigue siendo correcto: es lo único que el usuario controla
    // desde aquí, y "logout" no debe fallar por un problema de red.
  }

  store.clearCloudAccount(db);
  console.log("Desvinculado. Tus datos locales no se tocaron.");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
