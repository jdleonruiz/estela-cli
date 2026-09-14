#!/usr/bin/env node
/**
 * Prepara el paquete publicable.
 *
 * Copia dentro lo que en el monorepo vive fuera, porque esas rutas dejan de
 * existir en cuanto alguien instala esto desde npm:
 *
 *  - `packages/web`, que el servidor sirve. Sin ella `estela web` responde 404
 *    a todo sin decir por qué.
 *  - `@estela/shared`. En el monorepo es un enlace simbólico que npm workspaces
 *    crea en la raíz, y `bundleDependencies` no lo sigue: el paquete se
 *    publicaba sin él y la CLI moría al arrancar con "Cannot find module".
 *    Hay que dejarlo como carpeta de verdad dentro del paquete.
 *
 * `postpack.js` deshace la copia. Si se quedara, el desarrollo en el monorepo
 * usaría esa copia en vez del código fuente, y arrastraría una versión vieja
 * de shared sin que nadie se diera cuenta.
 */
const { cpSync, copyFileSync, existsSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const raiz = join(__dirname, "..");
const paquete = join(raiz, "packages", "daemon");

const web = join(raiz, "packages", "web");
if (!existsSync(join(web, "index.html"))) {
  console.error("prepack: no encuentro packages/web/index.html");
  process.exit(1);
}
rmSync(join(paquete, "web"), { recursive: true, force: true });
cpSync(web, join(paquete, "web"), { recursive: true });

const sharedOrigen = join(raiz, "packages", "shared");
const sharedDist = join(sharedOrigen, "dist", "index.js");
if (!existsSync(sharedDist)) {
  console.error("prepack: falta packages/shared/dist. Ejecuta `npm run build` antes.");
  process.exit(1);
}

const sharedDestino = join(paquete, "node_modules", "@estela", "shared");
rmSync(sharedDestino, { recursive: true, force: true });
cpSync(join(sharedOrigen, "dist"), join(sharedDestino, "dist"), { recursive: true });
writeFileSync(join(sharedDestino, "package.json"), JSON.stringify({
  name: "@estela/shared", version: "0.1.0", main: "dist/index.js",
}, null, 2) + "\n");

copyFileSync(join(raiz, "README.md"), join(paquete, "README.md"));
console.log("prepack: web, shared y README copiados al paquete");
