import { readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";

import * as store from "./db/store.js";
import { normalizePath } from "./paths.js";

/**
 * A qué proyecto pertenece una carpeta de trabajo: lo comparten `estela quota`
 * y `estela statusline`.
 *
 * El `cwd` de una sesión no siempre está dentro de la carpeta registrada:
 * un worktree vive al lado del repositorio (`../web-feature`), y una sesión
 * abierta en `repo/src` de un repo sin registrar se llamaba "src". Por eso,
 * en este orden:
 *
 *  1. La carpeta tal cual contra los proyectos registrados (el prefijo más
 *     largo gana). Cubre `repo/src` y también un subproyecto registrado
 *     dentro de un monorepo (`repo/packages/x`), que resolviendo antes a la
 *     raíz git se perdería.
 *  2. La raíz git — y si es un worktree, la del repositorio principal —
 *     contra los proyectos registrados.
 *  3. Si nada coincide, "sin proyecto" con el nombre de la raíz git, nunca
 *     el de una subcarpeta. Fuera de git, la propia carpeta.
 */

export type Owner =
  | { readonly kind: "project"; readonly projectId: string }
  /**
   * `path` agrupa (dos repos pueden llamarse igual); `name` es lo que se
   * enseña; `inGit` dice si es la raíz de un repo o una carpeta suelta.
   */
  | { readonly kind: "folder"; readonly path: string; readonly name: string; readonly inGit: boolean }
  | { readonly kind: "none" };

/** Un resolvedor con caché: una semana tiene miles de turnos y pocas carpetas. */
export function ownerResolver(db: DatabaseSync): (dir: string | null) => Owner {
  const cache = new Map<string, Owner>();
  return (dir) => {
    if (!dir) return { kind: "none" };
    let owner = cache.get(dir);
    if (!owner) {
      owner = resolveOwner(db, dir);
      cache.set(dir, owner);
    }
    return owner;
  };
}

function resolveOwner(db: DatabaseSync, dir: string): Owner {
  const direct = store.projectForRepo(db, dir);
  if (direct) return { kind: "project", projectId: direct };
  const root = gitRoot(dir);
  if (root && root !== dir) {
    const viaRoot = store.projectForRepo(db, root);
    if (viaRoot) return { kind: "project", projectId: viaRoot };
  }
  const path = root ?? normalizePath(dir);
  return { kind: "folder", path, name: folderName(path), inGit: root !== null };
}

/** El nombre de una carpeta para enseñarlo: la última parte de la ruta. */
export function folderName(path: string): string {
  return basename(path.replace(/[\\/]+$/, "")) || path;
}

/**
 * La raíz del repositorio git que contiene `dir`, o null si no está en git.
 *
 * Se sube hasta encontrar `.git`. Si es una carpeta, esa es la raíz. Si es un
 * fichero (`gitdir: …`), es un worktree o un submódulo: un worktree tiene un
 * `commondir` que apunta al `.git` del repositorio principal, y la raíz es la
 * de ese; un submódulo no lo tiene, y es su propio repositorio.
 *
 * Solo lee el disco, sin ejecutar git: se llama en cada evento de la status
 * line. Si la carpeta ya no existe (un worktree borrado), sube igualmente.
 */
export function gitRoot(dir: string): string | null {
  // Una ruta relativa (o "~/…", como en la demo) se resolvería contra la
  // carpeta desde la que se ejecuta Estela, y acabaría en el repo de quien la
  // ejecuta. Los cwd de verdad son absolutos.
  if (!isAbsolute(dir)) return null;
  let d = resolve(dir);
  for (;;) {
    const dotGit = join(d, ".git");
    try {
      const st = statSync(dotGit);
      if (st.isDirectory()) return normalizePath(d);
      if (st.isFile()) return normalizePath(worktreeMain(dotGit) ?? d);
    } catch { /* no hay .git aquí: se sube */ }
    const parent = dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

/** La raíz del repositorio principal de un worktree, o null si no lo es. */
function worktreeMain(dotGitFile: string): string | null {
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGitFile, "utf8"));
    if (!m) return null;
    const gitdir = isAbsolute(m[1]!) ? m[1]! : resolve(dirname(dotGitFile), m[1]!);
    const common = readFileSync(join(gitdir, "commondir"), "utf8").trim();
    const commonDir = isAbsolute(common) ? common : resolve(gitdir, common);
    // El .git del principal: su carpeta padre es la raíz del repositorio.
    return basename(commonDir) === ".git" ? dirname(commonDir) : null;
  } catch { return null; }
}
