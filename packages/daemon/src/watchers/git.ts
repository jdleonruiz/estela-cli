import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CommitRecord } from "@estela/shared";

const run = promisify(execFile);

/**
 * Lector de git.
 *
 * Solo observa: no instala hooks, no escribe trailers, no toca los mensajes de
 * commit. `core.hooksPath` es global y pisaría husky o lefthook del equipo, y un
 * identificador inyectado en el historial es irreversible una vez subido. Leer
 * `git log` no tiene ninguno de esos costes.
 */

const SEP = "\x1f";
const RECORD = "\x1e";

export async function readCommits(
  repoPath: string,
  options: { since?: Date; authorEmail?: string; authorEmails?: readonly string[] } = {},
): Promise<CommitRecord[]> {
  const root = await repoRoot(repoPath);
  if (!root) return [];

  // %D son las referencias que APUNTAN al commit; no dicen a qué rama pertenece.
  // Para eso se usa --source, que hace que git diga por cuál de las referencias
  // recorridas llegó a cada commit. Sin esto, `branch` guardaba la rama actual
  // del repositorio para todos los commits y cualquier métrica por feature
  // salía mal.
  // El separador va DELANTE de la cabecera, no detrás. Con `--numstat` git
  // imprime la cabecera y a continuación las líneas de estadísticas: si el
  // separador cierra la cabecera, esas líneas quedan pegadas al principio del
  // commit siguiente y todos los recuentos salen a cero.
  // El separador de registro va SIEMPRE el primero. Si se cuela un campo antes,
  // ese campo queda pegado al final del commit anterior al partir por él.
  const format = RECORD + ["%S", "%H", "%aI", "%ae", "%an", "%s"].join(SEP);

  const args = ["log", "--source", "--all", `--pretty=format:${format}`,
                "--numstat", "--no-merges"];
  if (options.since) args.push(`--since=${options.since.toISOString()}`);

  // Varios --author en git se combinan con OR, que es justo lo que hace falta:
  // en el repo de un cliente commiteas con el correo que te dieron, y en los
  // tuyos con el propio. Filtrar por uno solo pierde casi todo tu trabajo.
  const authors = options.authorEmails?.length
    ? options.authorEmails
    : options.authorEmail ? [options.authorEmail] : [];
  // Sin ignorar mayúsculas, configurar un nombre ("JDev Leon") en vez de un
  // correo no casaría con nada y el proyecto se quedaría sin commits.
  if (authors.length) args.push("--regexp-ignore-case");
  for (const email of authors) args.push(`--author=${email}`);

  let stdout: string;
  try {
    ({ stdout } = await run("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 }));
  } catch {
    // Un repo sin commits, o sin git instalado, no debe tumbar el escaneo.
    return [];
  }

  const commits: CommitRecord[] = [];

  for (const chunk of stdout.split(RECORD)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;

    const newlineAt = trimmed.indexOf("\n");
    const header = newlineAt === -1 ? trimmed : trimmed.slice(0, newlineAt);
    const body = newlineAt === -1 ? "" : trimmed.slice(newlineAt + 1);

    const [source, hash, iso, authorEmail, authorName, subject] = header.split(SEP);
    if (!hash || !iso || !authorEmail) continue;

    // --source devuelve "refs/heads/feature/x"; nos quedamos con el nombre.
    const branch = source
      ? source.replace(/^refs\/(heads|remotes\/[^/]+)\//, "").trim() || null
      : null;

    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) continue;

    let linesAdded = 0;
    let linesDeleted = 0;
    const files: string[] = [];
    for (const line of body.split("\n")) {
      const [added, deleted, file] = line.split("\t");
      // "-" en --numstat significa archivo binario: no cuenta como líneas.
      if (added && added !== "-") linesAdded += Number(added) || 0;
      if (deleted && deleted !== "-") linesDeleted += Number(deleted) || 0;
      // Los ficheros habilitan medir reescritura: sin ellos no se puede saber
      // qué se está tocando una y otra vez.
      if (file) files.push(file.trim());
    }

    commits.push({
      repoPath: root, hash, at, authorEmail, authorName: authorName ?? "",
      branch, subject: subject ?? "", linesAdded, linesDeleted, files,
    });
  }

  return commits;
}

/**
 * Raíz del repositorio.
 *
 * `git rev-parse --show-toplevel` en vez de comprobar si existe un directorio
 * `.git`: en un `git worktree` el `.git` es un *archivo*, no un directorio, y la
 * comprobación ingenua devuelve falso en un repo perfectamente válido.
 */
export async function repoRoot(path: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd: path });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Huella de identidad del repositorio: los hashes de su(s) commit(s) raíz,
 * ordenados y unidos por coma.
 *
 * No el remoto (`origin`): muchos repos privados no lo tienen configurado, y
 * la URL en sí podría revelar el dominio interno o la organización de un
 * cliente. Un hash de commit ya es opaco por sí solo y no depende de dónde
 * viva el remoto — solo de la historia real del código.
 */
export async function rootCommitFingerprint(path: string): Promise<string | null> {
  const root = await repoRoot(path);
  if (!root) return null;
  try {
    const { stdout } = await run("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: root });
    const hashes = stdout.split("\n").map((h) => h.trim()).filter(Boolean).sort();
    return hashes.length ? hashes.join(",") : null;
  } catch {
    // Repo sin commits todavía, o sin HEAD — no hay huella que sacar aún.
    return null;
  }
}

/**
 * Ramas ya integradas en la rama de integración.
 *
 * Lo que queda fuera es trabajo abierto, que es la señal de riesgo que un jefe
 * de proyecto no tiene hoy: no la ve hasta que estalla al integrar.
 *
 * La rama base se detecta porque varía por equipo —unos integran en `main`,
 * otros en `develop`— y equivocarse la marcaría todo como abierto.
 */
export async function mergedBranches(path: string): Promise<Set<string>> {
  const root = await repoRoot(path);
  if (!root) return new Set();

  const base = await integrationBranch(root);
  if (!base) return new Set();

  const merged = new Set<string>([base]);
  for (const ref of ["--merged"]) {
    try {
      const { stdout } = await run("git", ["branch", "-a", ref, base], { cwd: root });
      for (const line of stdout.split("\n")) {
        const name = line.replace(/^[*+]?\s*/, "").trim();
        if (!name || name.includes("->")) continue;
        merged.add(name.replace(/^remotes\/[^/]+\//, ""));
      }
    } catch {
      // Un repo recién creado no tiene aún la rama base.
    }
  }
  return merged;
}

/** Rama donde el equipo integra. `develop` gana a `main` si existe. */
export async function integrationBranch(root: string): Promise<string | null> {
  for (const candidate of ["develop", "main", "master"]) {
    try {
      await run("git", ["rev-parse", "--verify", `refs/heads/${candidate}`], { cwd: root });
      return candidate;
    } catch { /* probar la siguiente */ }
  }
  return null;
}

/** Rama activa del repositorio. Ya no se usa para etiquetar commits. */
export async function currentBranch(root: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["branch", "--show-current"], { cwd: root });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Autores que han commiteado en un repositorio, de más a menos reciente.
 *
 * Sirve para preguntar "¿cuál de estos eres tú?" en vez de adivinarlo: en el
 * repositorio de un cliente hay cinco compañeros y tu correo global no aparece
 * por ningún lado.
 */
export async function repoAuthors(
  path: string, limit = 12,
): Promise<{ email: string; commits: number; lastAt: string }[]> {
  const root = await repoRoot(path);
  if (!root) return [];

  try {
    const { stdout } = await run(
      "git", ["log", "--pretty=format:%ae\t%aI", "--no-merges"],
      { cwd: root, maxBuffer: 32 * 1024 * 1024 });

    const seen = new Map<string, { commits: number; lastAt: string }>();
    for (const line of stdout.split("\n")) {
      const [email, at] = line.split("\t");
      if (!email) continue;
      const entry = seen.get(email);
      if (entry) { entry.commits++; if (at && at > entry.lastAt) entry.lastAt = at; }
      else seen.set(email, { commits: 1, lastAt: at ?? "" });
    }

    return [...seen.entries()]
      .map(([email, v]) => ({ email, commits: v.commits, lastAt: v.lastAt.slice(0, 10) }))
      .sort((a, b) => b.commits - a.commits)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function gitUserEmail(path: string): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["config", "user.email"], { cwd: path });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
