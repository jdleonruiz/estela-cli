import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * `estela statusline install | uninstall`: el bloque `statusLine` de
 * `~/.claude/settings.json`.
 *
 * Ese fichero es de quien usa Claude Code, con sus permisos, sus hooks y sus
 * plugins. Se toca lo justo: se lee, se cambia una clave y se reescribe el
 * resto tal cual; antes, una copia. Si ya hay otra status line, no se pisa.
 *
 * Funciones puras sobre el texto del fichero: quien llama lee y escribe.
 */

export const OUR_COMMAND = "estela statusline";

/** Dónde vive la configuración de Claude Code (`CLAUDE_CONFIG_DIR` la mueve). */
export function claudeSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env["CLAUDE_CONFIG_DIR"] || join(homedir(), ".claude"), "settings.json");
}

type Json = Record<string, unknown>;

export type InstallResult =
  | { readonly status: "installed" | "replaced" | "chained"; readonly text: string; readonly previous: string | null }
  | { readonly status: "already" }
  | { readonly status: "conflict"; readonly existing: string }
  | { readonly status: "invalid" };

export type UninstallResult =
  | { readonly status: "removed" | "restored"; readonly text: string; readonly restored: string | null }
  | { readonly status: "absent" }
  | { readonly status: "foreign"; readonly existing: string }
  | { readonly status: "invalid" };

function parse(text: string | null): Json | null {
  if (text === null || !text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? v as Json : null;
  } catch { return null; }
}

function commandOf(statusLine: unknown): string | null {
  if (!statusLine || typeof statusLine !== "object") return null;
  const c = (statusLine as Json)["command"];
  return typeof c === "string" ? c : null;
}

export function isOurs(command: string | null): boolean {
  return !!command && /(^|[\s/\\])estela(\.cmd)?\s+statusline(\s|$)/.test(command);
}

/** Comillas simples de shell: lo que va dentro se pasa tal cual. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** El comando encadenado dentro de `--append '…'`, si lo hay. */
export function appendedCommand(command: string): string | null {
  const m = /--append\s+'((?:[^']|'\\'')*)'\s*$/.exec(command);
  return m ? m[1]!.replace(/'\\''/g, "'") : null;
}

function write(settings: Json): string {
  return JSON.stringify(settings, null, 2) + "\n";
}

export function planInstall(
  text: string | null, options: { readonly force?: boolean; readonly append?: boolean } = {},
): InstallResult {
  const settings = parse(text);
  if (!settings) return { status: "invalid" };
  const existing = commandOf(settings["statusLine"]);

  if (existing && isOurs(existing) && !options.force) return { status: "already" };

  let command = OUR_COMMAND;
  let status: "installed" | "replaced" | "chained" = "installed";
  if (existing && !isOurs(existing)) {
    if (options.append) { command = `${OUR_COMMAND} --append ${shellQuote(existing)}`; status = "chained"; }
    else if (options.force) status = "replaced";
    else return { status: "conflict", existing };
  }
  settings["statusLine"] = { type: "command", command, padding: 0 };
  return { status, text: write(settings), previous: existing };
}

export function planUninstall(text: string | null): UninstallResult {
  const settings = parse(text);
  if (!settings) return { status: "invalid" };
  const existing = commandOf(settings["statusLine"]);
  if (!existing) return { status: "absent" };
  if (!isOurs(existing)) return { status: "foreign", existing };

  // Si al instalar se encadenó otra, se devuelve esa: quitar Estela no puede
  // dejarte sin la status line que ya tenías.
  const before = appendedCommand(existing);
  if (before) {
    settings["statusLine"] = { type: "command", command: before };
    return { status: "restored", text: write(settings), restored: before };
  }
  delete settings["statusLine"];
  return { status: "removed", text: write(settings), restored: null };
}

/** `estela` en el PATH. Con `npx` cada evento tardaría cientos de milisegundos. */
export function estelaOnPath(env: NodeJS.ProcessEnv = process.env, platform = process.platform): boolean {
  const names = platform === "win32" ? ["estela.cmd", "estela.exe", "estela"] : ["estela"];
  return (env["PATH"] ?? "").split(delimiter).filter(Boolean)
    .some((dir) => names.some((n) => existsSync(join(dir, n))));
}

/** "settings.json.bak-20261014-161230": una copia por instalación, sin pisar las anteriores. */
export function backupName(path: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${path}.bak-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}
