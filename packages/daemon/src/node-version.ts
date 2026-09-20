/**
 * Comparación de versiones de Node, sin dependencias — separado de `bin.ts`
 * para poder probarlo sin disparar sus efectos de lado (el `process.exit` o
 * el `import()` del CLI real) solo por importar el fichero.
 */

export function versionParts(v: string): [number, number, number] {
  const clean = v.startsWith("v") ? v.slice(1) : v;
  const [major, minor, patch] = clean.split(".").map((n) => parseInt(n, 10) || 0);
  return [major ?? 0, minor ?? 0, patch ?? 0];
}

export function tooOld(current: string, min: string): boolean {
  const c = versionParts(current);
  const m = versionParts(min);
  for (let i = 0; i < 3; i++) {
    if (c[i]! > m[i]!) return false;
    if (c[i]! < m[i]!) return true;
  }
  return false;
}

/**
 * El comando con el que actualizar Node, según el sistema. `nvm` de Unix no
 * existe en Windows, así que aconsejarlo allí da un segundo error justo después
 * del primero. `winget` viene con Windows 10 (1709) y 11.
 *
 * Pero quien ya usa `nvm-windows` (lo delata `NVM_HOME`) NO debe instalar Node
 * con winget: los dos escriben en `C:\Program Files\nodejs` y acaban con varios
 * `npm` en el PATH y un `npm` de una versión mezclado con el `node` de otra
 * ("Class extends value undefined"). Es justo el desarrollador que más nos
 * interesa, así que a ese se le da el comando de su propia herramienta.
 */
export function upgradeCommand(platform: string, env: Record<string, string | undefined> = {}): string {
  if (platform !== "win32") return "nvm install --lts";
  return env["NVM_HOME"] ? "nvm install lts; nvm use lts" : "winget install OpenJS.NodeJS.LTS";
}
