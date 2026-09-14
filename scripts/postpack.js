#!/usr/bin/env node
/**
 * Deshace lo que hizo `prepack`.
 *
 * La copia de `@estela/shared` dentro del paquete tiene prioridad sobre el
 * enlace del workspace, así que dejarla ahí haría que el desarrollo usara una
 * versión congelada de shared. Es el tipo de fallo que se descubre tres días
 * después preguntándose por qué un cambio no surte efecto.
 */
const { rmSync } = require("node:fs");
const { join } = require("node:path");

const paquete = join(__dirname, "..", "packages", "daemon");
for (const ruta of ["web", "README.md", join("node_modules", "@estela")]) {
  rmSync(join(paquete, ruta), { recursive: true, force: true });
}
console.log("postpack: copias temporales retiradas");
