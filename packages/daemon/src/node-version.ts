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
 * El comando con el que actualizar Node, según el sistema. `nvm` no existe en
 * Windows (allí hay un `nvm-windows` aparte, con otra sintaxis), así que
 * aconsejarlo a alguien en Windows le da un segundo error justo después del
 * primero. `winget` viene con Windows 10 (1709) y 11.
 */
export function upgradeCommand(platform: string): string {
  return platform === "win32" ? "winget install OpenJS.NodeJS.LTS" : "nvm install --lts";
}
