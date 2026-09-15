#!/usr/bin/env node

/**
 * Punto de entrada real del CLI — antes lo era `cli.ts` directamente.
 *
 * `cli.ts` importa (transitivamente, a través de `db/schema.ts`) `node:sqlite`,
 * que no existe antes de Node 22.5. En un Node más viejo eso revienta con
 * `ERR_UNKNOWN_BUILTIN_MODULE` y una traza interna larga, con pinta de bug del
 * programa — no de "actualiza tu Node". `npm` ya avisa de la versión mínima
 * (`engines` en package.json), pero ese aviso es una línea gris entre mucho
 * ruido de instalación, y casi nadie la lee antes de ver el error de verdad.
 *
 * Este fichero no importa nada más que módulos que existen en cualquier Node
 * con soporte a ES modules — la comprobación tiene que poder correr y fallar
 * con claridad ANTES de que el `import` de `cli.js` llegue a `node:sqlite`.
 * `import()` dinámico, no estático: un `import` de arriba del fichero se
 * resolvería antes de que este código tuviera ocasión de comprobar nada.
 */

import { tooOld } from "./node-version.js";
import { detectLang, setLang, tr } from "./i18n/index.js";

const MIN_NODE = "22.5.0";

if (tooOld(process.version, MIN_NODE)) {
  // Aquí aún no se ha leído ningún argumento: `--lang` se busca a mano.
  const i = process.argv.indexOf("--lang");
  setLang(detectLang({ flag: i >= 0 ? process.argv[i + 1] : undefined, env: process.env, platform: process.platform }));
  console.error(
    tr`\nEstela necesita Node ${MIN_NODE} o superior — tienes ${process.version} instalado.\n` +
    tr`Actualiza con nvm (nvm install --lts) o desde https://nodejs.org, y vuelve a intentarlo.\n`);
  process.exit(1);
} else {
  // Este paquete compila a CommonJS (no admite `await` de nivel superior), así
  // que un `import()` dinámico sigue siendo una promesa normal aquí — no algo
  // que haya que esperar: `cli.js` arranca solo en cuanto se carga (termina en
  // `main().catch(...)`), este `catch` es solo para un fallo de carga en sí.
  void import("./cli.js").catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
