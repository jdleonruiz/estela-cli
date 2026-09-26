/**
 * Rutas de repositorio, iguales vengan de donde vengan.
 *
 * En Windows la misma carpeta llega escrita de tres maneras: el agente la da
 * como `C:\Users\ana\repo`, git como `C:/Users/ana/repo`, y cualquiera de las
 * dos puede traer la unidad en minúscula. Comparadas como texto no coinciden,
 * y el efecto era que en Windows el trabajo del agente no caía en ningún
 * proyecto: solo se veían las horas deducidas de commits.
 *
 * Por eso toda ruta se normaliza al entrar (lectores de agentes, git, la CLI y
 * la base) y se compara con `isSameOrInside`. Las rutas de macOS y Linux no se
 * tocan: solo se reconoce como de Windows lo que empieza por unidad (`C:`) o
 * es una ruta de red (`\\servidor\...`).
 */

function isWindowsPath(p: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(p) || /^[A-Za-z]:$/.test(p) || /^\\\\[^\\]/.test(p);
}

/** `C:\Users\ana\repo\` → `C:/Users/ana/repo`. Lo que no es de Windows, tal cual. */
export function normalizePath(p: string): string {
  if (!isWindowsPath(p)) return p;
  const unc = p.startsWith("\\\\");
  let out = p.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (unc) out = "/" + out;                              // //servidor/recurso
  out = out.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
  if (/^[A-Z]:$/.test(out)) out += "/";                 // la unidad sola es su raíz
  if (out.length > 3 && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

/** Normalizar y además ignorar mayúsculas donde el sistema las ignora: en Windows. */
function key(p: string): string {
  const n = normalizePath(p);
  return isWindowsPath(n) ? n.toLowerCase() : n;
}

/** ¿Es `child` la carpeta `root` o algo dentro de ella? `repo2` no está dentro de `repo`. */
export function isSameOrInside(child: string, root: string): boolean {
  const c = key(child), r = key(root);
  return c === r || c.startsWith(r.endsWith("/") ? r : r + "/");
}

/** El último tramo de la ruta, para enseñar un repositorio por su nombre. */
export function baseName(p: string): string {
  return normalizePath(p).split("/").filter(Boolean).pop() ?? p;
}
