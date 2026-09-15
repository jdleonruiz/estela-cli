import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tr } from "./i18n/index.js";

/**
 * Avisa cuando hay una versión más nueva en npm.
 *
 * El caso real que esto evita: instalar una vez y quedarse en esa versión
 * para siempre, sin saberlo. `npm` no actualiza instalaciones globales por su
 * cuenta, y nadie va a ejecutar `npm view estela version` cada semana por
 * curiosidad.
 *
 * Dos reglas para que esto no se note cuando no hace falta:
 *
 *  - **Nunca bloquea.** El aviso sale del caché en disco, que es una lectura
 *    instantánea. Si toca refrescar el caché, se hace en segundo plano con un
 *    plazo corto — si npm no contesta a tiempo, el comando sigue su curso
 *    igual. Un `estela log` no puede tardar más porque el registro esté lento.
 *  - **Como mucho una vez al día.** Consultar npm en cada `estela status` de
 *    un script sería ruido para el registro y para quien lo mira.
 */

const CACHE_PATH = join(homedir(), ".estela", "update-check.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 1500;

interface Cache {
  readonly checkedAt: string;
  readonly latest: string;
}

function readCache(): Cache | null {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Cache;
  } catch {
    return null;
  }
}

function writeCache(latest: string): void {
  try {
    mkdirSync(join(homedir(), ".estela"), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ checkedAt: new Date().toISOString(), latest }));
  } catch {
    // Sin permiso de escritura o disco lleno: el aviso de hoy se pierde, pero
    // no hay razón para que ESO rompa el comando que se estaba ejecutando.
  }
}

/** `1.2.3` > `1.10.0`: comparar como texto ordenaría mal el "10". */
export function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/**
 * Refresca el caché en segundo plano, sin que nada espere por esto.
 *
 * `void` a propósito: si el proceso termina antes de que esto acabe, se
 * pierde el resultado de hoy y ya está — no hay nada crítico en juego, se
 * reintenta mañana. Preferible a mantener el proceso vivo por una consulta de
 * cortesía a un CLI que ya terminó su trabajo.
 */
function refreshInBackground(): void {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  void fetch("https://registry.npmjs.org/estela/latest", { signal: controller.signal })
    .then((res) => res.json())
    .then((data: unknown) => {
      const latest = (data as { version?: string }).version;
      if (typeof latest === "string") writeCache(latest);
    })
    .catch(() => { /* sin conexión, npm caído o el plazo cumplido: no pasa nada. */ })
    .finally(() => clearTimeout(timeout));
}

/**
 * Enseña el aviso si el caché dice que hay algo más nuevo, y refresca el
 * caché si ya toca. Se llama una vez al arrancar cualquier comando.
 */
export function checkForUpdate(currentVersion: string): void {
  const cache = readCache();

  if (cache && isNewer(cache.latest, currentVersion)) {
    console.log(tr`\n  ↑ Hay una versión nueva de Estela (${cache.latest}, tienes ${currentVersion}).`);
    console.log(tr`    Actualiza con: npm install -g estela@latest\n`);
  }

  const stale = !cache || Date.now() - Date.parse(cache.checkedAt) > CHECK_INTERVAL_MS;
  if (stale) refreshInBackground();
}
