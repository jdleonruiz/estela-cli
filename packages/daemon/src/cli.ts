#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";

// `node:sqlite` avisa de que es experimental en cada arranque. Es ruido para
// quien solo quiere su factura, y el aviso no le dice nada accionable.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

import type { Client, Currency, TimeEntry, WorkKind } from "@estela/shared";
import {
  formatAiCost, formatDuration, formatMoney, localDate, parseMoney, setMoneyLocale,
  WORK_KIND_LABELS,
} from "@estela/shared";

import { mkdirSync, rmSync, writeFileSync } from "node:fs";

import { amortize, monthOf, shareForProject } from "./billing/amortize.js";
import { issueInvoice, InvoiceError, marginOf, rateAt, renderInvoice } from "./billing/invoice.js";
import { attachCommits, describeBlock, groupByBranchAndDay, sessionize,
         sessionizeCommits, withoutOverlap } from "./billing/sessionize.js";
import { DEFAULT_DB_PATH, openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { seedDemo } from "./demo.js";
import { diagnose, renderFindings } from "./doctor.js";
import { applySetup, planSetup, summarize, summaryLine } from "./setup.js";
import { invoiceToCsv, timeEntriesToCsv } from "./export/csv.js";
import { invoiceToPdf } from "./export/invoice-pdf.js";
import { buildShareReport } from "./export/share.js";
import { startServer } from "./server.js";
import { checkForUpdate } from "./updateCheck.js";
import { NoAccountError, publishPanel, type PublishResult } from "./publish.js";
import { NotSyncedError, syncProject } from "./sync.js";
import { syncTeamProject } from "./sync/team.js";
import { acceptTeamInvite, inviteTeamMember, listTeamMembers, revokeTeamMember } from "./team.js";
import { openBillingPortal, upgradeCheckout } from "./billing.js";
import { login, logout } from "./cloud/auth.js";
import { CloudError, cloudGet, cloudPost, setClientVersion } from "./cloud/client.js";
import { breakdownOfTurn } from "./pricing/cost.js";
import { type AgentScan, allTurns, scanAgents } from "./watchers/agents.js";
import { gitUserEmail, readCommits, repoAuthors, repoRoot } from "./watchers/git.js";
import { myEmailsByRepo, onlyMine } from "./watchers/identity.js";
import { detectLang, documentLang, getLang, setLang, tr, withLang, type Lang } from "./i18n/index.js";
import { kindLabel } from "./i18n/labels.js";

const HELP_ES = `
estela — registro de horas para desarrollo asistido por IA

  estela setup
        Primera ejecución: detecta tus agentes y repositorios, y reconstruye
        tu historial. Dos minutos, sin preguntas y sin cuenta.

  estela import [--since YYYY-MM-DD] [--repo <ruta>]
        Reconstruye tu historial desde los transcripts de los agentes y git.

  estela client add --id <id> --name <nombre> --currency <EUR|USD|...>
                    [--tax-id <NIF/CIF>] [--email <a@b.com>]
                    [--language es|en|auto]
        --tax-id y --email son los datos del cliente que saldrán impresos en
        el informe de "estela report". Repetir el comando con el mismo --id
        reescribe la ficha entera: vuelve a pasar todo lo que quieras
        conservar, lo que omitas se queda vacío.
        --language es el idioma de lo que recibe ESE cliente: el PDF, el CSV,
        el informe y el panel compartido. Es del cliente y no de tu terminal:
        puedes usar Estela en español y facturarle a una empresa en inglés.
        Sin --language se usa el de tu terminal (y se te avisa). Es lo único
        que NO se borra al repetir el comando; "auto" lo quita a propósito.
        Un "--lang en" suelto en cualquier comando manda sobre todo.
  estela project add --id <id> --client <id> --name <nombre> --repo <ruta>
                     [--rounding <min>] [--ai-cost absorbed|passthrough]
  estela project close --project <id>
        Dice que un proyecto terminó. No borra nada ni deja de capturar si
        vuelve a haber actividad ahí — "estela doctor" avisa en ese caso, en
        vez de perder el bloque o facturarlo por sorpresa.
  estela project reopen --project <id>
  estela rate set --project <id> --rate <importe> [--from YYYY-MM-DD]
  estela budget --project <id> [--amount <dólares>|none]
        Presupuesto mensual de IA. Sin --amount, consulta el actual. Alimenta
        el aviso de la pestaña Equipo.

  estela subscription add --id <id> --name <nombre> --fee <cuota> [--currency USD]
        Registra una cuota fija (Claude Max, Cursor...). Con suscripción, el
        gasto real es la cuota repartida por consumo, no la suma por token.

  estela log --project <id> --hours <n> --what "<qué hiciste>"
             [--kind development|meeting|research|review|travel|support|other]
             [--date YYYY-MM-DD] [--minutes <n>]
        Horas que ningún import va a deducir: reuniones, viajes, investigación,
        y desarrollo sin agente que tampoco dejó commits.

  estela author --project <id> [--email <a@b.com>[,otro@c.com]]
        Con qué correo commiteas en ese proyecto. Sin --email, lista los
        autores del repositorio para que elijas el tuyo.

  estela web [--port 4319]            Abre el panel en tu navegador.
  estela demo [--port 4320]           El panel lleno con datos inventados, para
                                      ver de qué va sin esperar a tener
                                      historial. No toca tu base.
  estela doctor                       Revisa los datos y avisa de lo que
                                      rompería una demo. Úsalo antes de publicar.
  estela status                       Qué hay capturado y sin imputar.
  estela entries --project <id>       Bloques imputados a un proyecto.
  estela ai-cost                      Reparto de tu cuota entre proyectos.
  estela share --project <id> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
               [--author <tu nombre>] [--with-amounts] [--out <fichero.html>]
        Informe compartible en un solo fichero HTML. Horas y commits; sin
        consumo de IA, que es tuyo mientras la pagues tú.

  estela publish --project <id> [--author <tu nombre>] [--with-amounts]
                 [--token <existente>] [--no-team] [--client <correo>[,otro]]
        Panel de solo lectura para que tu cliente USE el producto, no solo
        reciba un documento. Se aloja en getestela.dev — Free permite uno a
        la vez, Pro y Teams sin límite. Necesita "estela login" antes.
        Con --client se le avisa por correo y le aparece en su cuenta al
        entrar en getestela.dev/app. Sin --client no se toca esa lista: tus
        republicaciones no desvinculan a quien ya lo tenía.

  estela team ai-cost --project <id> --allow | --deny
        Si quien te invitó pide ver el coste de IA del proyecto, esta es tu
        respuesta. Sin --allow no sale de tu máquina, y el silencio no es un
        sí. Se comparte sumado al proyecto, nunca por persona.

  estela login --email <tú@dominio.com> [--api <url>]
        Vincula esta máquina a tu cuenta. Sin esto, Estela sigue siendo 100%
        local: nada de lo de abajo cambia lo que ya haces sin cuenta.
  estela logout
        Desvincula esta máquina. Tus datos locales no se tocan.

  estela sync enable --project <id>
        Activa el sync de un proyecto entre tus máquinas. Función de Pro; sin
        una fila aquí, ese proyecto no sale de esta máquina nunca.
  estela sync [--project <id>]
        Sube y baja lo cambiado desde el último sync. Sin --project,
        sincroniza todos los proyectos activados (personales y de equipo).

  estela team invite --project <id> --email <a@b.com>[,otro@c.com] [--kind employee|freelancer]
        Invita a alguien a que sus horas en ese proyecto se midan de verdad
        en el panel, en vez de estimarse por commits. Función de Teams. Los
        correos son los de commit del invitado, no con los que se loguee.
  estela team accept --token <token> [--as-id <id-local>]
        Acepta una invitación y deja el proyecto listo para sincronizar. Sin
        --as-id se llama igual que en el equipo que te invitó; solo hace
        falta si ya tienes un proyecto tuyo con ese nombre.
  estela team repo --project <id> --add <ruta>
        Vincula tu clon local a un proyecto de equipo ya aceptado.
  estela team list --project <id>
        Quién ha aceptado, sus horas medidas, y cuándo sincronizó por última vez.
  estela team revoke --token <token>
        Quita a alguien del equipo. Si pagas Teams, baja lo que se cobra.

  estela upgrade --plan pro|teams [--annual]
        Da de alta el plan. Imprime un enlace de Stripe Checkout — el pago
        se completa ahí, nunca en la terminal. --annual cobra el año de una
        vez, con dos meses de descuento frente al mensual.
  estela billing portal
        Cambiar de tarjeta o cancelar. Lo hace Stripe, no nosotros.
  estela account
        Tu correo, tu plan, y desde qué máquinas te has conectado.

  estela export --project <id> [--out <fichero.csv>]

  estela report --project <id> --cutoff YYYY-MM-DD [--dry-run]
                [--pdf <fichero.pdf>] [--csv <fichero.csv>] [--fx <tipo>]
                [--number <nº>]
                [--from-name <tu nombre>] [--from-email <email>]
                [--from-tax-id <tu NIF/CIF>]
        Informe de horas y commits para respaldar tu trabajo. No es una
        factura: Estela no emite documentos fiscales.
        --number fija el número del informe; sin él se numera solo y
        correlativo por año (INF-${new Date().getFullYear()}-001, -002...).
        Los --from-* son tus datos como emisor, en la cabecera del PDF.
        Necesitan --from-name: sin nombre no se imprime ese bloque, y
        --from-tax-id y --from-email se ignoran.

Opciones globales:  --db <ruta>   (por defecto ${DEFAULT_DB_PATH})
                    --lang es|en  Idioma. Sin ella se usa el del sistema;
                                  ESTELA_LANG=en lo fija para siempre.
                    --version     Solo imprime la versión instalada.
`;

const HELP_EN = `
estela — time tracking for AI-assisted development

  estela setup
        First run: detects your agents and repositories, and rebuilds your
        history. Two minutes, no questions, no account.

  estela import [--since YYYY-MM-DD] [--repo <path>]
        Rebuilds your history from agent transcripts and git.

  estela client add --id <id> --name <name> --currency <EUR|USD|...>
                    [--tax-id <tax ID>] [--email <a@b.com>]
                    [--language es|en|auto]
        --tax-id and --email are the client details printed on the report
        from "estela report". Running the command again with the same --id
        rewrites the whole record: pass everything you want to keep again,
        anything you leave out is cleared.
        --language is the language of what THAT client receives: the PDF, the
        CSV, the report and the shared panel. It belongs to the client, not to
        your terminal: you can use Estela in Spanish and bill a company in
        English. Without --language your terminal's is used (and you're told).
        It's the one thing that is NOT cleared when you run the command again;
        "auto" removes it on purpose. A bare "--lang en" on any command wins.
  estela project add --id <id> --client <id> --name <name> --repo <path>
                     [--rounding <min>] [--ai-cost absorbed|passthrough]
  estela project close --project <id>
        Marks a project as done. Doesn't delete anything or stop capturing if
        there's activity there again — "estela doctor" flags that instead of
        silently dropping the block or billing it by surprise.
  estela project reopen --project <id>
  estela rate set --project <id> --rate <amount> [--from YYYY-MM-DD]
  estela budget --project <id> [--amount <dollars>|none]
        Monthly AI budget. Without --amount, shows the current one. Feeds the
        warning on the Team tab.

  estela subscription add --id <id> --name <name> --fee <fee> [--currency USD]
        Records a flat subscription (Claude Max, Cursor...). With one, your
        real spend is the fee split by usage, not the per-token total.

  estela log --project <id> --hours <n> --what "<what you did>"
             [--kind development|meeting|research|review|travel|support|other]
             [--date YYYY-MM-DD] [--minutes <n>]
        Hours no import will ever infer: meetings, travel, research, and
        development without an agent that didn't leave commits either.

  estela author --project <id> [--email <a@b.com>[,other@c.com]]
        Which email you commit with on that project. Without --email, lists
        the repository's authors so you can pick yours.

  estela web [--port 4319]            Opens the dashboard in your browser.
  estela demo [--port 4320]           The dashboard filled with made-up data, to
                                      see what it does without waiting to build
                                      up history. It never touches your data.
  estela doctor                       Checks your data and flags anything that
                                      would ruin a demo. Run it before publishing.
  estela status                       What's been captured and not yet assigned.
  estela entries --project <id>       Blocks assigned to a project.
  estela ai-cost                      How your subscription splits across projects.
  estela share --project <id> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
               [--author <your name>] [--with-amounts] [--out <file.html>]
        Shareable report in a single HTML file. Hours and commits; no AI
        usage, which is yours as long as you're the one paying for it.

  estela publish --project <id> [--author <your name>] [--with-amounts]
                 [--token <existing>] [--no-team] [--client <email>[,other]]
        Read-only dashboard so your client can USE the product, not just
        receive a document. Hosted on getestela.dev — Free allows one at a
        time, Pro and Teams have no limit. Requires "estela login" first.
        With --client they get an email and it shows up in their account
        when they sign in to getestela.dev/app. Without --client that list
        isn't touched: republishing never unlinks anyone who already had it.

  estela team ai-cost --project <id> --allow | --deny
        If whoever invited you asks to see the project's AI cost, this is
        your answer. Without --allow it never leaves your machine, and
        silence isn't a yes. It's shared summed for the project, never per person.

  estela login --email <you@domain.com> [--api <url>]
        Links this machine to your account. Without it, Estela stays 100%
        local: nothing below changes what you already do without an account.
  estela logout
        Unlinks this machine. Your local data isn't touched.

  estela sync enable --project <id>
        Turns on sync for a project across your machines. A Pro feature;
        without it, that project never leaves this machine.
  estela sync [--project <id>]
        Uploads and downloads what changed since the last sync. Without
        --project, syncs every enabled project (personal and team).

  estela team invite --project <id> --email <a@b.com>[,other@c.com] [--kind employee|freelancer]
        Invites someone so their hours on that project are actually measured
        on the dashboard, instead of estimated from commits. A Teams feature.
        Use the emails they commit with, not the ones they sign in with.
  estela team accept --token <token> [--as-id <local-id>]
        Accepts an invitation and gets the project ready to sync. Without
        --as-id it keeps the name it has on the team that invited you; you
        only need it if you already have a project of your own with that name.
  estela team repo --project <id> --add <path>
        Links your local clone to a team project you've already accepted.
  estela team list --project <id>
        Who has accepted, their measured hours, and when they last synced.
  estela team revoke --token <token>
        Removes someone from the team. If you pay for Teams, the charge goes down.

  estela upgrade --plan pro|teams [--annual]
        Starts the plan. Prints a Stripe Checkout link — payment happens
        there, never in the terminal. --annual bills the whole year at once,
        with two months off compared to monthly.
  estela billing portal
        Change your card or cancel. Stripe handles it, not us.
  estela account
        Your email, your plan, and which machines you've signed in from.

  estela export --project <id> [--out <file.csv>]

  estela report --project <id> --cutoff YYYY-MM-DD [--dry-run]
                [--pdf <file.pdf>] [--csv <file.csv>] [--fx <rate>]
                [--number <no.>]
                [--from-name <your name>] [--from-email <email>]
                [--from-tax-id <your tax ID>]
        Report of hours and commits to back up your work. It isn't an
        invoice: Estela doesn't issue tax documents.
        --number sets the report number; without it, reports are numbered
        automatically and sequentially per year (INF-${new Date().getFullYear()}-001, -002...).
        The --from-* flags are your details as the issuer, in the PDF header.
        They need --from-name: without a name that block isn't printed, and
        --from-tax-id and --from-email are ignored.

Global options:  --db <path>   (default ${DEFAULT_DB_PATH})
                 --lang es|en  Language. Without it, your system's is used;
                               ESTELA_LANG=en sets it for good.
                 --version     Only prints the installed version.
`;

function helpText(): string {
  return getLang() === "en" ? HELP_EN : HELP_ES;
}

interface Args {
  readonly _: string[];
  readonly flags: Record<string, string | boolean>;
}

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) { flags[key] = next; i++; }
    else flags[key] = true;
  }
  return { _: positional, flags };
}

function str(args: Args, key: string): string | undefined {
  const value = args.flags[key];
  return typeof value === "string" ? value : undefined;
}

function required(args: Args, key: string): string {
  const value = str(args, key);
  if (!value) throw new UserError(tr`Falta --${key}`);
  return value;
}

class UserError extends Error {}

/** El `--lang` escrito en el comando, si es uno que existe. Distinto del de la terminal. */
function explicitLang(args: Args): Lang | undefined {
  const v = str(args, "lang");
  return v === "es" || v === "en" ? v : undefined;
}

/**
 * En qué idioma sale el documento que recibe este cliente: `--lang`, luego el
 * idioma que se le fijó, y solo si nada de eso, el de la terminal.
 */
function docLangOf(args: Args, client: Client): Lang {
  return documentLang({ explicit: explicitLang(args), clientLanguage: client.language });
}

/**
 * Si el idioma salió de la terminal, y no de una decisión, se dice — con el
 * comando ya escrito. `client add` reescribe la ficha entera, así que pedirle a
 * alguien que lo teclee de memoria es pedirle que pierda el NIF sin querer.
 */
function hintDocLang(args: Args, client: Client, lang: Lang): void {
  if (client.language || explicitLang(args)) return;
  const dice = lang === "es" ? tr`español` : tr`inglés`;
  const cmd = `estela client add --id ${client.id} --name ${JSON.stringify(client.name)} ` +
    `--currency ${client.currency}` +
    (client.taxId ? ` --tax-id ${JSON.stringify(client.taxId)}` : "") +
    (client.email ? ` --email ${JSON.stringify(client.email)}` : "") +
    ` --language <es|en>`;
  console.log(tr`\n  Sale en ${dice}, el idioma de tu terminal: a este cliente no se le fijó ninguno.`);
  console.log(tr`  Para fijarlo: ${cmd}`);
}

// ---------------------------------------------------------------------------

/**
 * `estela web` — abre el panel local.
 *
 * Quien instala la CLI no tiene forma de arrancar el servidor: hasta ahora
 * vivía en un script del repositorio, que solo existe si te lo has clonado.
 */
async function cmdWeb(args: Args, dbPath: string): Promise<void> {
  const port = Number(str(args, "port") ?? 4319);
  const url = await startServer({ port, dbPath });
  console.log(tr`\n  Estela  ${url}`);
  console.log(tr`  Datos:  ${dbPath}`);
  console.log(tr`\n  Ctrl+C para parar.\n`);
  // No devuelve: el servidor se queda escuchando.
  await new Promise(() => {});
}

/**
 * `estela demo` — el producto lleno, con datos inventados.
 *
 * Quien instala esto sin historial de agente termina el setup y ve una pantalla
 * casi vacía: ha hecho lo que se le pidió y no ha visto el producto. Esto le
 * enseña de qué va en diez segundos, en una base aparte que se puede borrar.
 */
async function cmdDemo(args: Args, dbPath: string): Promise<void> {
  const rutaDemo = join(dirname(dbPath), "estela-demo.db");
  rmSync(rutaDemo, { force: true });
  mkdirSync(dirname(rutaDemo), { recursive: true });

  const db = openDatabase(rutaDemo);
  try { seedDemo(db); } finally { db.close(); }

  const port = Number(str(args, "port") ?? 4320);
  const url = await startServer({ port, dbPath: rutaDemo, autoImportMinutes: 0, demo: true });
  console.log(tr`\n  Estela — demo con datos inventados  ${url}`);
  console.log(tr`  No es tu trabajo: no se ha tocado tu base ni se ha leído nada tuyo.`);
  console.log(tr`  Para el tuyo de verdad:  estela setup`);
  console.log(tr`\n  Ctrl+C para parar.\n`);
  await new Promise(() => {});
}

// Sin subdominio propio: se sirve bajo getestela.dev por rutas concretas
// (/auth/, /panels), proxiadas a esta API en nginx. Evita el DNS y el
// certificado de un api.getestela.dev que nadie más necesita.
const DEFAULT_API_BASE_URL = "https://getestela.dev";

async function cmdLogin(args: Args, dbPath: string): Promise<void> {
  const email = required(args, "email");
  const apiBaseUrl = str(args, "api") ?? process.env["ESTELA_API_BASE_URL"] ?? DEFAULT_API_BASE_URL;
  const db = openDatabase(dbPath);
  try { await login(db, email, apiBaseUrl); }
  finally { db.close(); }
}

async function cmdLogout(dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try { await logout(db); }
  finally { db.close(); }
}

/**
 * `estela setup` — la primera ejecución.
 *
 * Dos minutos, sin preguntas y sin cuenta. Si al terminar esa persona no ve
 * algo cierto sobre su propio trabajo, no habrá una segunda ejecución.
 */
/** Nombre del agente tal y como lo llama quien lo usa, no como lo llamamos aquí. */
function agentName(agent: AgentScan["agent"]): string {
  switch (agent) {
    case "claude-code": return "Claude Code";
    case "codex": return "Codex";
    case "cursor": return "Cursor";
    case "gemini-cli": return "Gemini CLI";
  }
}

/**
 * El parte de un escaneo.
 *
 * Se imprime por agente y no sumado: si Codex cambia de formato y empieza a
 * dar registros malformados, un total conjunto lo diluye con la salud de
 * Claude Code y el canario deja de avisar de nada.
 */
function printScanReport(scan: AgentScan): void {
  const r = scan.report;
  console.log(`  ${agentName(scan.agent)}`);
  console.log(tr`    ${r.filesRead} archivos · ${r.recordsSeen} registros`);
  console.log(tr`    ${r.turnsAccepted} turnos aceptados`);
  console.log(tr`    ${r.duplicatesDropped} duplicados descartados` +
    (r.turnsAccepted > 0
      ? tr` (${(r.duplicatesDropped / (r.turnsAccepted + r.duplicatesDropped) * 100).toFixed(0)}% de las filas)`
      : ""));
  console.log(tr`    ${r.unknownRecords} registros internos ignorados · ${r.malformedRecords} malformados`);
  if (r.producerVersions.length) {
    console.log(tr`    versiones: ${r.producerVersions.join(", ")}`);
  }
  for (const warning of r.warnings) console.warn(`  ⚠ ${agentName(scan.agent)}: ${warning}`);
}

async function cmdSetup(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    console.log(tr`\nEstela\n`);
    console.log(tr`Leyendo lo que tus agentes ya guardaron en disco…`);

    const scans = await scanAgents({});
    const turns = allTurns(scans);

    // Los repos no pueden salir solo de los transcripts: quien programa sin
    // IA, o con un agente que no deja rastro en ~/.claude (Cursor, Copilot),
    // tenía cero repos que mirar y `setup` se rendía ahí mismo — aunque la
    // propia landing promete "y también sin IA" y el resto de esta función
    // ya sabe reconstruir horas solo de commits. La carpeta desde la que se
    // corre esto es la pista seria que queda cuando no hay transcripts: es
    // donde la mayoría corre `estela setup`, dentro de su propio proyecto.
    const repos = new Set<string>();
    for (const turn of turns) if (turn.repoPath) repos.add(turn.repoPath);
    const cwdRoot = await repoRoot(process.cwd());
    if (cwdRoot) repos.add(cwdRoot);

    if (turns.length === 0 && repos.size === 0) {
      console.log(tr`\n  No se han encontrado sesiones de agentes en ~/.claude ni ~/.codex,`);
      console.log(tr`  ni un repositorio de Git en esta carpeta. Corre esto de nuevo desde`);
      console.log(tr`  dentro de tu proyecto, o trabaja un rato con tu agente y vuelve.\n`);
      return;
    }

    if (turns.length > 0) {
      store.saveTurns(db, turns);
      for (const scan of scans) store.logScan(db, scan.agent, scan.report);
      // Nombrar los agentes encontrados, en vez de contar versiones: es lo
      // que quien acaba de instalar quiere confirmar —que ha visto lo suyo—.
      const vistos = scans.filter((s) => s.report.turnsAccepted > 0).map((s) => agentName(s.agent));
      console.log(tr`  ${turns.length} turnos · ${vistos.join(", ")}`);
    } else {
      console.log(tr`  No se han encontrado sesiones de agentes en ~/.claude ni ~/.codex —`);
      console.log(tr`  sin problema, se reconstruye igual desde tus commits de Git.`);
    }

    console.log(tr`\nBuscando repositorios… (${repos.size})`);
    const plans = await planSetup(db, [...repos], await gitUserEmail(process.cwd()));
    const nuevos = applySetup(db, plans);

    for (const plan of plans.filter((x) => !x.existing)) {
      console.log(`  + ${plan.name}` +
        (plan.emails.length ? tr`  (commiteas como ${plan.emails[0]})` : tr`  ⚠ sin autor claro`));
    }
    const yaEstaban = plans.filter((x) => x.existing).length;
    if (yaEstaban) console.log(tr`  ${yaEstaban} ya estaban configurados y no se tocan`);

    console.log(tr`\nReconstruyendo tu historial…`);
    await cmdImport({ _: [], flags: { ...(args.flags["db"] ? { db: args.flags["db"] } : {}) } }, dbPath);

    const s = summarize(db);
    console.log(`\n${"─".repeat(66)}`);
    console.log(`  ${summaryLine(s)}`);
    if (s.from) console.log(tr`  del ${s.from} al ${s.to}`);
    if (s.people > 1) {
      console.log(tr`  ${s.people} personas han commiteado en esos repositorios`);
    }
    console.log(`${"─".repeat(66)}\n`);

    const sinAutor = plans.filter((p) => !p.existing && p.emails.length === 0);
    if (sinAutor.length) {
      console.log(tr`  ⚠ En ${sinAutor.length} repositorio(s) no se ha podido saber con qué`);
      console.log(tr`    correo commiteas, así que ahí no se ha capturado nada tuyo:`);
      for (const p of sinAutor.slice(0, 3)) {
        console.log(tr`      estela author --project ${p.projectId}`);
      }
      console.log("");
    }

    console.log(tr`  Ábrelo:        estela web`);
    console.log(tr`  Revísalo:      estela doctor`);
    if (nuevos > 0) {
      console.log(tr`\n  Los proyectos se han creado como internos y sin tarifa. Si alguno`);
      console.log(tr`  es de un cliente al que facturas, ponle la suya y podrás emitir`);
      console.log(tr`  informes:  estela rate set --project <id> --rate 50\n`);
    }
  } finally { db.close(); }
}

async function cmdImport(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const sinceRaw = str(args, "since");
    const since = sinceRaw ? new Date(`${sinceRaw}T00:00:00Z`) : undefined;
    if (since && Number.isNaN(since.getTime())) throw new UserError(tr`Fecha inválida: ${sinceRaw}`);

    const repoFilter = str(args, "repo");
    const repoPaths = repoFilter ? [resolve(repoFilter)] : undefined;

    console.log(tr`Leyendo transcripts de agentes…`);
    const scans = await scanAgents({
      ...(since ? { since } : {}),
      ...(repoPaths ? { repoPaths } : {}),
    });
    // Devolver al repositorio el trabajo hecho en scratchpads, o esas horas
    // quedan sin proyecto y desaparecen del parte.
    const turns = allTurns(scans);
    const rescued = scans.reduce((n, s) => n + s.scratchpadsResolved, 0);

    const savedTurns = store.saveTurns(db, turns);
    for (const scan of scans) store.logScan(db, scan.agent, scan.report);

    // Un bloque por agente, y solo de los que tienen algo. Quien no use Codex
    // no debe leer cuatro líneas de ceros para enterarse de eso.
    console.log(tr`  ${savedTurns} turnos nuevos guardados`);
    for (const scan of scans) {
      if (scan.report.filesRead === 0) continue;
      printScanReport(scan);
    }

    // Commits de cada repositorio que aparece en los transcripts, MÁS todo
    // repo ya vinculado a un proyecto aunque ningún transcript lo mencione
    // — si no, un proyecto que `setup` acaba de registrar desde el
    // directorio actual (sin ninguna sesión de agente detrás) se quedaba
    // sin sus commits, porque este `import` interno nunca miraba lo que
    // `setup` ya había guardado, solo los transcripts. Con --repo explícito
    // se respeta el filtro tal cual, incluso si ese repo tampoco tiene
    // transcripts: quien lo pide por su nombre lo quiere igual.
    const repos = new Set<string>();
    for (const turn of turns) if (turn.repoPath) repos.add(turn.repoPath);
    if (repoPaths) {
      for (const p of repoPaths) repos.add(p);
    } else {
      for (const p of store.allProjectRepoPaths(db)) repos.add(p);
    }

    // Se guardan TODOS los autores: es lo que alimenta la vista de equipo. El
    // filtro por tus correos va más abajo, justo antes de imputar horas.
    let savedCommits = 0;
    for (const repo of repos) {
      const root = await repoRoot(repo);
      if (!root) continue;
      savedCommits += store.saveCommits(db, await readCommits(root,
        since ? { since } : {}));
    }
    const mine = await myEmailsByRepo(db, repos);
    if (rescued > 0) {
      console.log(tr`  ${rescued} turnos de scratchpad devueltos a su repositorio`);
    }
    // En la primera ejecución lo normal es un solo repositorio: "1 repositorios"
    // es lo primero que lee quien acaba de instalar.
    console.log(repos.size === 1
      ? tr`Git: 1 repositorio · ${savedCommits} commits nuevos`
      : tr`Git: ${repos.size} repositorios · ${savedCommits} commits nuevos`);

    // Agrupar en bloques, fusionar por rama y día, e imputar a los proyectos.
    // Trabajo deducido de los agentes, y además el de los commits que no
    // solapan con ninguno: quien programa sin IA solo deja ese rastro.
    // Solo TUS commits derivan horas tuyas. Sin este filtro, los commits de un
    // compañero se convertirían en tiempo facturable a tu nombre.
    const commitsAll = onlyMine(await allCommits(db), mine);
    const fromAgents = attachCommits(sessionize(turns), commitsAll);
    const fromCommits = withoutOverlap(sessionizeCommits(commitsAll), fromAgents);
    const raw = [...fromAgents, ...fromCommits];
    // Se agrupa por PROYECTO, no por ruta: el agente abierto en `repo/` y en
    // `repo/src/UI` son dos rutas del mismo proyecto, y agrupar por ruta
    // producía dos bloques que luego se pisaban al guardarse con el mismo id.
    const porProyecto = (b: { repoPath: string | null }) =>
      (b.repoPath ? store.projectForRepo(db, b.repoPath) ?? b.repoPath : "");

    const blocks = groupByBranchAndDay(raw, porProyecto);
    if (fromCommits.length) {
      console.log(tr`  ${fromCommits.length} bloques deducidos solo de commits (sin agente)`);
    }
    let entries = 0;
    let unassigned = 0;

    for (const block of blocks) {
      const projectId = block.repoPath ? store.projectForRepo(db, block.repoPath) : null;
      if (!projectId) { unassigned++; continue; }
      const project = store.getProject(db, projectId)!;

      const entry: Omit<TimeEntry, "id"> = {
        projectId,
        startedAt: block.startedAt,
        endedAt: block.endedAt,
        seconds: block.seconds,
        description: describeBlock(block),
        billable: project.billable,
        invoiceId: null,
        aiCost: block.aiCost,
        // Un bloque deducido solo de commits no tuvo agente: ni segundos de
        // agente ni agente al que atribuirlos.
        agentSeconds: block.turnCount > 0 ? block.seconds : 0,
        commitHashes: block.commits.map((c) => c.hash),
        agents: block.turnCount > 0 ? ["claude-code"] : [],
        source: block.turnCount > 0 ? "agent" : "commit",
        kind: "development",
        branch: block.branch,
      };
      // El id es determinista (proyecto + día + rama) para que reimportar
      // actualice la imputación en vez de duplicarla. La fecha tiene que ser la
      // LOCAL y la misma que usa el servidor: con toISOString() se generaba un
      // id distinto para el mismo bloque y el día se contaba dos veces.
      const day = localDate(block.startedAt);
      const slug = (block.branch ?? "sin-rama").replace(/[^a-zA-Z0-9]+/g, "-");
      store.saveTimeEntry(db, { ...entry, id: `te_${projectId}_${day}_${slug}` });
      entries++;
    }

    console.log(
      tr`Bloques: ${raw.length} detectados → ${blocks.length} tras agrupar por rama y día · ` +
      tr`${entries} imputados · ${unassigned} sin proyecto`);
    if (unassigned > 0) {
      console.log(tr`\nHay ${unassigned} bloques sin proyecto asignado. Regístralos con:`);
      console.log(tr`  estela project add --id <id> --client <id> --name <nombre> --repo <ruta>`);
    }
  } finally {
    db.close();
  }
}

async function allCommits(db: ReturnType<typeof openDatabase>) {
  const rows = db.prepare("SELECT * FROM commits").all() as Record<string, unknown>[];
  return rows.map((r) => ({
    repoPath: r["repo_path"] as string,
    hash: r["hash"] as string,
    at: new Date(r["at"] as string),
    authorEmail: r["author_email"] as string,
    authorName: (r["author_name"] as string) ?? "",
    branch: (r["branch"] as string | null) ?? null,
    subject: r["subject"] as string,
    linesAdded: r["lines_added"] as number,
    linesDeleted: r["lines_deleted"] as number,
    files: String(r["files"] ?? "").split("\n").filter(Boolean),
  }));
}

function cmdClientAdd(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const currency = required(args, "currency").toUpperCase() as Currency;
    const id = required(args, "id");

    // El idioma es la única parte de la ficha que NO se borra al repetir el
    // comando sin ella: quien vuelve a ejecutar `client add` solo para cambiar un
    // correo no espera que los PDFs de ese cliente cambien de idioma sin avisar.
    // "auto" es la forma de quitarlo a propósito.
    const asked = str(args, "language");
    if (asked !== undefined && asked !== "es" && asked !== "en" && asked !== "auto") {
      throw new UserError(tr`--language admite es, en o auto, y recibí "${asked}".`);
    }
    const language = asked === "auto" ? undefined : (asked ?? store.getClient(db, id)?.language);

    store.upsertClient(db, {
      id,
      name: required(args, "name"),
      currency,
      ...(str(args, "tax-id") ? { taxId: str(args, "tax-id")! } : {}),
      ...(str(args, "email") ? { email: str(args, "email")! } : {}),
      ...(language ? { language } : {}),
    });
    console.log(tr`Cliente "${required(args, "name")}" guardado. Factura en ${currency}.`);
    if (language) {
      console.log(tr`  Sus documentos salen en ${language === "es" ? tr`español` : tr`inglés`}.`);
    }
  } finally { db.close(); }
}

function cmdProjectAdd(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const clientId = required(args, "client");
    if (!store.getClient(db, clientId)) {
      throw new UserError(tr`No existe el cliente "${clientId}". Créalo primero con: estela client add`);
    }
    const repo = str(args, "repo");
    store.upsertProject(db, {
      id: required(args, "id"),
      clientId,
      name: required(args, "name"),
      repoPaths: repo ? [resolve(repo)] : [],
      billable: str(args, "billable") !== "false",
      roundingMinutes: Number(str(args, "rounding") ?? 0),
      aiCostPolicy: (str(args, "ai-cost") ?? "absorbed") as "absorbed" | "passthrough",
      kind: (str(args, "kind") ?? "client") as "client" | "employment" | "internal",
    });
    console.log(tr`Proyecto "${required(args, "name")}" guardado.`);
    if (repo) console.log(tr`  repositorio: ${resolve(repo)}`);
  } finally { db.close(); }
}

/**
 * `estela project close` — dice que un proyecto terminó, sin borrar nada.
 *
 * A propósito NO bloquea `estela import`: si vuelve a haber actividad ahí
 * (un compañero commitea, o retomas el proyecto sin acordarte de reabrirlo),
 * perder ese bloque real sería peor que capturarlo de más. `estela doctor`
 * es quien avisa si un proyecto cerrado vuelve a captar trabajo.
 */
function cmdProjectClose(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);

    if (project.closedAt) {
      console.log(tr`"${project.name}" ya estaba cerrado desde el ${project.closedAt.toISOString().slice(0, 10)}.`);
      return;
    }

    const pending = store.getTimeEntries(db, projectId)
      .filter((e) => e.billable && e.invoiceId === null);
    if (pending.length > 0) {
      const seconds = pending.reduce((s, e) => s + e.seconds, 0);
      console.log(tr`  ⚠ "${project.name}" tiene ${formatDuration(seconds)} sin facturar en ${pending.length} bloques.`);
      console.log(tr`    Ciérralo igual, o factúralo primero con: estela report --project ${projectId} --cutoff <fecha>`);
    }

    // Fin del día local, no el instante exacto: "estela log" fecha las horas
    // manuales de hoy a las 10:00 hora local sin importar cuándo se anoten (a
    // propósito, para no fingir precisión). Cerrar "ahora mismo" por la tarde
    // dejaría esas horas de la mañana con una marca posterior al cierre, y el
    // aviso de doctor saltaría sin que hubiera pasado nada raro. Mismo criterio
    // que ya usa "estela report --cutoff" para el corte de facturación.
    const hoy = localDate(new Date());
    store.closeProject(db, projectId, new Date(`${hoy}T23:59:59`));
    console.log(tr`
"${project.name}" cerrado. Los datos siguen ahí; si vuelve a captar`);
    console.log(tr`trabajo, "estela doctor" avisa en vez de perderlo en silencio.`);
    console.log(tr`Para reabrirlo:  estela project reopen --project ${projectId}`);
  } finally { db.close(); }
}

function cmdProjectReopen(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);

    if (!project.closedAt) {
      console.log(tr`"${project.name}" ya estaba abierto.`);
      return;
    }

    store.reopenProject(db, projectId);
    console.log(tr`"${project.name}" reabierto.`);
  } finally { db.close(); }
}

/**
 * Presupuesto mensual de IA de un proyecto.
 *
 * En dólares, que es la moneda en la que facturan los modelos, aunque le
 * cobres al cliente en euros. Mezclarlo con la moneda del cliente obligaría a
 * un tipo de cambio para comparar el gasto con su propio límite.
 *
 * Sin presupuesto no hay aviso. Es distinto de un presupuesto de cero, que
 * avisaría siempre.
 */
function cmdBudget(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);

    const raw = str(args, "amount");
    if (raw === undefined) {
      const current = db.prepare(
        "SELECT ai_budget_micro_usd AS b FROM projects WHERE id = ?"
      ).get(projectId) as { b: number | null };
      console.log(current.b === null
        ? tr`"${project.name}" no tiene presupuesto de IA.`
        : tr`"${project.name}": $${(current.b / 1e6).toFixed(2)} al mes.`);
      return;
    }

    if (raw === "none") {
      db.prepare("UPDATE projects SET ai_budget_micro_usd = NULL WHERE id = ?").run(projectId);
      console.log(tr`Presupuesto de "${project.name}" retirado.`);
      return;
    }

    const dollars = Number(raw.replace(",", "."));
    if (!Number.isFinite(dollars) || dollars < 0) {
      throw new UserError(tr`Importe inválido: ${raw}`);
    }
    db.prepare("UPDATE projects SET ai_budget_micro_usd = ? WHERE id = ?")
      .run(Math.round(dollars * 1e6), projectId);
    console.log(tr`Presupuesto de IA de "${project.name}": $${dollars.toFixed(2)} al mes.`);
  } finally { db.close(); }
}

function cmdRateSet(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);

    const client = store.getClient(db, project.clientId)!;
    const currency = (str(args, "currency")?.toUpperCase() as Currency) ?? client.currency;
    const rate = parseMoney(required(args, "rate"), currency);

    const fromRaw = str(args, "from");
    const effectiveFrom = fromRaw ? new Date(`${fromRaw}T00:00:00Z`) : new Date(0);

    store.addRatePeriod(db, { projectId, hourlyRate: rate, effectiveFrom, effectiveTo: null });
    console.log(tr`Tarifa de "${project.name}": ${formatMoney(rate)}/hora` +
      (fromRaw ? tr` desde ${fromRaw}.` : tr` (aplica a todo el histórico).`));
  } finally { db.close(); }
}

function cmdStatus(dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const turns = db.prepare(
      "SELECT COUNT(*) n, SUM(cost_micro_usd) c, MIN(at) a, MAX(at) b FROM agent_turns"
    ).get() as { n: number; c: number | null; a: string | null; b: string | null };

    console.log(tr`Base de datos: ${dbPath}\n`);
    console.log(tr`Turnos de agente:  ${turns.n}`);
    if (turns.a) console.log(tr`Periodo:           ${turns.a.slice(0, 10)} → ${turns.b!.slice(0, 10)}`);
    console.log(tr`Coste de IA total: ${formatAiCost({ microUsd: turns.c ?? 0 })}\n`);

    const clients = store.listClients(db);
    if (clients.length === 0) {
      console.log(tr`Sin clientes configurados. Empieza con:`);
      console.log(tr`  estela client add --id <id> --name <nombre> --currency EUR`);
      return;
    }

    for (const client of clients) {
      console.log(`${client.name}  [${client.currency}]`);
      for (const project of store.listProjects(db).filter((p) => p.clientId === client.id)) {
        const entries = store.getTimeEntries(db, project.id);
        const pending = entries.filter((e) => e.billable && e.invoiceId === null);
        const seconds = pending.reduce((s, e) => s + e.seconds, 0);
        const ai = pending.reduce((s, e) => s + e.aiCost.microUsd, 0);
        const rate = rateAt(store.getRates(db, project.id), project.id, new Date());

        console.log(`  ${project.name}` + (project.closedAt ? tr` (cerrado)` : ""));
        console.log(tr`    tarifa:          ${rate ? `${formatMoney(rate)}/h` : tr`— sin definir —`}`);
        console.log(tr`    sin facturar:    ${formatDuration(seconds)} en ${pending.length} bloques`);
        if (rate && seconds > 0) {
          const amount = { amount: Math.round((rate.amount * seconds) / 3600), currency: rate.currency };
          console.log(tr`    importe:         ${formatMoney(amount)}`);
        }
        console.log(tr`    coste de IA:     ${formatAiCost({ microUsd: ai })}`);
      }
      console.log("");
    }

    const scan = db.prepare("SELECT * FROM scan_log ORDER BY id DESC LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    if (scan && String(scan["warnings"])) {
      console.warn(`⚠ ${scan["warnings"]}`);
    }
  } finally { db.close(); }
}

function cmdEntries(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);

    const entries = store.getTimeEntries(db, projectId);
    if (entries.length === 0) { console.log(tr`Sin bloques imputados. Ejecuta: estela import`); return; }

    console.log(`${project.name}\n`);
    for (const e of entries) {
      const flag = e.invoiceId ? tr`facturado` : e.billable ? tr`pendiente` : tr`no facturable`;
      console.log(
        `${e.startedAt.toISOString().slice(0, 16).replace("T", " ")}  ` +
        `${formatDuration(e.seconds).padStart(8)}  ` +
        `${formatAiCost(e.aiCost).padStart(9)}  ` +
        `${flag.padEnd(14)}  ${e.description.slice(0, 44)}`);
    }
  } finally { db.close(); }
}

/**
 * Genera el informe compartible.
 *
 * El fichero es autónomo a propósito: se manda por correo y se abre sin cuenta,
 * sin instalar nada y sin depender de que esta máquina esté encendida.
 */
function cmdShare(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);
    const client = store.getClient(db, project.clientId)!;

    const to = str(args, "to") ?? localDate(new Date());
    const from = str(args, "from") ?? to.slice(0, 8) + "01";
    const rates = store.getRates(db, projectId);

    const lang = docLangOf(args, client);
    const html = withLang(lang, () => buildShareReport({
      project, client,
      entries: store.getTimeEntries(db, projectId),
      from, to,
      ...(str(args, "author") ? { authorName: str(args, "author")! } : {}),
      withAmounts: args.flags["with-amounts"] === true,
      rateAt: (at) => rateAt(rates, projectId, at),
      // La IA la pagas tú mientras no haya una organización detrás, así que su
      // consumo no entra en el informe. No es una opción: no hay bandera.
      aiPayer: "self",
      commitsOf: (hashes) => hashes.length
        ? db.prepare(
            `SELECT hash, subject FROM commits WHERE hash IN (${hashes.map(() => "?").join(",")})`
          ).all(...hashes) as { hash: string; subject: string }[]
        : [],
    }));

    const out = str(args, "out") ?? `informe-${projectId}-${to}.html`;
    writeFileSync(out, html, "utf8");

    console.log(tr`\nInforme: ${out}`);
    console.log(tr`  ${project.name} · ${client.name} · ${from} al ${to}`);
    console.log(tr`  Un solo fichero. Se abre sin instalar nada y sin depender de tu máquina.`);
    if (args.flags["with-amounts"] !== true) {
      console.log(tr`\n  Incluye horas y commits. Sin importes (añade --with-amounts) y sin`);
      console.log(tr`  consumo de IA, que es tuyo mientras la pagues tú.`);
    }
    hintDocLang(args, client, lang);
  } finally { db.close(); }
}

/**
 * Registra tiempo a mano.
 *
 * Un proyecto no son solo commits. Reuniones, desplazamientos, investigación y
 * spikes son horas reales que se facturan igual, y sin poder anotarlas el parte
 * del día miente por omisión: enseña solo lo que dejó rastro en Git y hace
 * parecer que el resto del trabajo no ocurrió.
 */
function cmdLog(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) {
      const known = store.listProjects(db).map((p) => p.id).join(", ") || tr`(ninguno)`;
      throw new UserError(tr`No existe el proyecto "${projectId}". Los que hay: ${known}`);
    }

    const kind = (str(args, "kind") ?? "meeting") as WorkKind;
    if (!(kind in WORK_KIND_LABELS)) {
      throw new UserError(
        tr`Tipo "${kind}" no reconocido. Usa uno de: ${Object.keys(WORK_KIND_LABELS).join(", ")}`);
    }

    const hoursRaw = str(args, "hours");
    const minutesRaw = str(args, "minutes");
    if (!hoursRaw && !minutesRaw) throw new UserError(tr`Indica --hours o --minutes`);

    const seconds = Math.round(
      (hoursRaw ? Number(hoursRaw.replace(",", ".")) * 3600 : 0) +
      (minutesRaw ? Number(minutesRaw) * 60 : 0));
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new UserError(tr`Duración inválida: ${hoursRaw ?? minutesRaw}`);
    }

    const day = str(args, "date") ?? localDate(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new UserError(tr`Fecha inválida: ${day}`);

    // A media mañana: no sabemos la hora real y fingir precisión sería peor.
    const startedAt = new Date(`${day}T10:00:00`);
    const what = str(args, "what") ?? kindLabel(kind);

    const id = store.saveTimeEntry(db, {
      projectId,
      startedAt,
      endedAt: new Date(startedAt.getTime() + seconds * 1000),
      seconds,
      description: what,
      billable: str(args, "billable") !== "false",
      invoiceId: null,
      aiCost: { microUsd: 0 },
      agentSeconds: 0,
      commitHashes: [],
      agents: [],
      source: "manual",
      kind,
      branch: null,
    });

    const rate = rateAt(store.getRates(db, projectId), projectId, startedAt);
    const amount = rate
      ? ` · ${formatMoney({ amount: Math.round((rate.amount * seconds) / 3600), currency: rate.currency })}`
      : "";

    console.log(`\n${kindLabel(kind)} · ${formatDuration(seconds)}${amount}`);
    console.log(`  ${what}`);
    console.log(`  ${project.name} · ${day}`);
    console.log(tr`\n  Registro manual: un import no lo va a tocar.  (${id})`);
  } finally { db.close(); }
}

/**
 * Publica el proyecto como panel de solo lectura.
 *
 * Genera un directorio con el token en la ruta, listo para subir a un servidor
 * estático. Se entrega el enlace completo para que no haya que componerlo a
 * mano y equivocarse.
 *
 * El token es lo único que protege la página: quien tenga la URL, entra. Por eso
 * son 128 bits y por eso revocar el acceso es borrar la carpeta del servidor —
 * una caducidad comprobada en el navegador no protegería de nada.
 */
async function cmdPublish(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    // Sin --client no se manda nada, y el servidor deja intacta la lista que
    // ya hubiera: republicar el avance de la semana no puede desvincular al
    // cliente que ya tenía este panel en su cuenta.
    const clientes = str(args, "client")
      ?.split(",").map((e) => e.trim()).filter(Boolean);

    // Sin --token explícito, se reusa el de la última publicación de este
    // proyecto desde esta máquina, si la hay. Sin esto, olvidar el --token al
    // republicar no solo generaba un enlace nuevo que dejaba muerto el que ya
    // tenía el cliente — en plan Free podía además rechazar la republicación
    // entera, porque el servidor no tenía forma de saber que no era un panel
    // nuevo de verdad.
    const token = str(args, "token") ?? store.getPublicationToken(db, projectId) ?? undefined;

    let result: PublishResult;
    try {
      result = await publishPanel(db, {
        projectId,
        ...(token ? { token } : {}),
        ...(str(args, "author") ? { authorName: str(args, "author")! } : {}),
        ...(clientes?.length ? { clients: clientes } : {}),
        withAmounts: args.flags["with-amounts"] === true,
        includeTeam: args.flags["no-team"] !== true,
        ...(explicitLang(args) ? { language: explicitLang(args)! } : {}),
      });
    } catch (error) {
      if (error instanceof NoAccountError) throw new UserError(error.message);
      throw error;
    }

    console.log(tr`\nPanel publicado.\n`);
    console.log(tr`  Enlace: ${result.url}\n`);
    if (result.adopted) {
      console.log(tr`  Este panel ya existía y queda vinculado a tu cuenta desde ahora.\n`);
    }
    if (clientes?.length) {
      console.log(tr`  Compartido con: ${clientes.join(", ")}`);
      console.log(tr`  Al entrar en getestela.dev/app con ese correo, lo verán ahí.\n`);
    }
    console.log(tr`  El token es lo único que protege la página: quien tenga el enlace, entra.`);
    console.log(tr`  Al volver a publicar desde esta máquina, este enlace se reusa solo.`);
    console.log(tr`  Desde otra máquina, pasa --token ${result.token} o el cliente perderá su enlace.`);

    const owner = store.getClient(db, store.getProject(db, projectId)!.clientId)!;
    hintDocLang(args, owner, docLangOf(args, owner));
  } finally { db.close(); }
}

/**
 * `estela sync enable --project <id>` — opt-in explícito, proyecto por
 * proyecto. Sin esta fila, ese proyecto no sale de esta máquina nunca, sea
 * cual sea el plan de la cuenta.
 */
function cmdSyncEnable(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    if (!store.getProject(db, projectId)) {
      throw new UserError(tr`No existe el proyecto "${projectId}".`);
    }
    if (!store.listPersonalSyncCandidates(db).includes(projectId)) {
      throw new UserError(tr`"${projectId}" ya está enlazado a un equipo y no puede sincronizarse también como personal.`);
    }
    store.setProjectSync(db, {
      projectId, scope: "personal", remoteProjectId: projectId,
      remoteOrgId: null, inviteToken: null,
    });
    console.log(tr`Sync activado para "${projectId}". Ejecuta "estela sync" para subir y bajar.`);
  } finally { db.close(); }
}

/** `estela sync [--project <id>]` — sin --project, sincroniza todos los proyectos habilitados. */
async function cmdSync(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const only = str(args, "project");
    const projectIds = only ? [only] : store.listProjectSyncs(db).map((s) => s.projectId);
    if (projectIds.length === 0) {
      console.log(tr`Ningún proyecto sincroniza todavía. Actívalo con: estela sync enable --project <id>`);
      return;
    }
    for (const projectId of projectIds) {
      const project = store.getProject(db, projectId);
      const label = project?.name ?? projectId;
      const scope = store.getProjectSync(db, projectId)?.scope;
      try {
        if (scope === "team") {
          const outcome = await syncTeamProject(db, projectId);
          console.log(tr`${label}: ${formatDuration(outcome.seconds)} totales enviadas`);
        } else {
          const outcome = await syncProject(db, projectId);
          console.log(tr`${label}: ${outcome.pushed} subidas, ${outcome.pulled} bajadas`);
        }
      } catch (error) {
        if (error instanceof NoAccountError || error instanceof NotSyncedError) throw new UserError(error.message);
        throw error;
      }
    }
  } finally { db.close(); }
}

/**
 * `estela team invite --project <id> --email <a@b,c@d> [--kind employee|freelancer]`
 *
 * Los correos son los de commit de quien se invita, no con los que se vaya a
 * loguear en Estela — es el mismo criterio que ya usa "estela author" para
 * la propia identidad, y es lo que permite emparejarlo en el panel.
 */
async function cmdTeamInvite(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const emails = required(args, "email").split(",").map((e) => e.trim()).filter(Boolean);
    const kind = (str(args, "kind") ?? "employee") as "employee" | "freelancer";
    if (kind !== "employee" && kind !== "freelancer") {
      throw new UserError(tr`--kind debe ser "employee" o "freelancer".`);
    }

    let result: { token: string };
    try {
      result = await inviteTeamMember(db, { projectId, emails, inviteeKind: kind });
    } catch (error) {
      if (error instanceof NoAccountError) throw new UserError(error.message);
      throw error;
    }

    console.log(tr`\nInvitación creada para: ${emails.join(", ")}\n`);
    console.log(tr`  Pásale esto (por el canal que uses con él, no hace falta correo):\n`);
    console.log(tr`    estela login --email <su-correo>`);
    console.log(tr`    estela team accept --token ${result.token} --as-id <id-que-elija>\n`);
  } finally { db.close(); }
}

/**
 * `estela team accept --token <token> --as-id <id-local>`
 *
 * El id local es obligatorio y nunca se autogenera: reusar el id del dueño
 * tal cual podría pisar en silencio un proyecto propio que ya tuviera ese
 * mismo id.
 */
/**
 * `estela team ai-cost --project <id> --allow|--deny`
 *
 * La respuesta de quien programa a que le pidan su coste de IA. Es suya y de
 * nadie más: hasta que no dice que sí, no sale de esta máquina ni un céntimo.
 * Y decir que no también se contesta — quien preguntó merece una respuesta,
 * no un silencio que parezca un fallo.
 */
async function cmdTeamAiCost(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const allow = args.flags["allow"] === true;
    const deny = args.flags["deny"] === true;
    if (allow === deny) {
      throw new UserError(tr`Elige una: --allow para compartirlo, --deny para no hacerlo.`);
    }

    const sync = store.getProjectSync(db, projectId);
    if (!sync || sync.scope !== "team" || !sync.inviteToken) {
      throw new UserError(tr`"${projectId}" no es un proyecto de equipo.`);
    }
    const account = store.getCloudAccount(db);
    if (!account) throw new UserError(tr`Vincula la máquina con "estela login" antes.`);

    const decision = allow ? "granted" : "declined";
    await cloudPost(account.apiBaseUrl, "/team/ai-cost/decision",
      { token: sync.inviteToken, decision }, { deviceToken: account.deviceToken });
    store.setAiConsent(db, projectId, false, decision);

    console.log(allow
      ? tr`\nHecho. El coste de IA de "${projectId}" se sumará al del proyecto en el ` +
        tr`siguiente "estela sync".\n\n  Nunca se enseña por persona, solo el total del proyecto.\n`
      : tr`\nHecho. El coste de IA de "${projectId}" NO se comparte, y se avisa a quien lo pidió.\n\n` +
        tr`  Tus horas se siguen midiendo igual: esto solo afecta al gasto de IA.\n`);
  } finally { db.close(); }
}

async function cmdTeamAccept(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const token = required(args, "token");
    // Sin --as-id se usa el id del dueño: pedirle a quien acepta que se
    // invente uno era pedirle un dato que el servidor ya tiene.
    const elegido = str(args, "as-id");

    let result: {
      projectName: string; emails: readonly string[]; inviteeKind: string; localProjectId: string;
    };
    try {
      result = await acceptTeamInvite(db, { token, ...(elegido ? { localProjectId: elegido } : {}) });
    } catch (error) {
      if (error instanceof NoAccountError) throw new UserError(error.message);
      throw error;
    }

    console.log(tr`\nInvitación aceptada: "${result.projectName}"`);
    console.log(tr`  Declarada para: ${result.emails.join(", ")} (${result.inviteeKind})`);
    console.log(tr`  Si no eres tú, avisa a quien te invitó.\n`);
    console.log(tr`En esta máquina se llama "${result.localProjectId}".\n`);
    console.log(tr`Ahora vincula tu repositorio local y sincroniza:\n`);
    console.log(tr`  estela team repo --project ${result.localProjectId} --add <ruta-de-tu-clon>`);
    console.log(tr`  estela import`);
    console.log(tr`  estela sync\n`);
  } finally { db.close(); }
}

/** `estela team repo --project <id> --add <ruta>` — solo añade el repositorio, nada más. */
function cmdTeamRepo(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const repo = required(args, "add");
    if (!store.getProject(db, projectId)) throw new UserError(tr`No existe el proyecto "${projectId}".`);
    store.addProjectRepo(db, projectId, resolve(repo));
    console.log(tr`Repositorio vinculado a "${projectId}": ${resolve(repo)}`);
  } finally { db.close(); }
}

/** `estela team list --project <id>` — miembros aceptados, sus horas, y cuándo sincronizaron. */
async function cmdTeamList(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    let members: Awaited<ReturnType<typeof listTeamMembers>>;
    try {
      members = await listTeamMembers(db, projectId);
    } catch (error) {
      if (error instanceof NoAccountError) throw new UserError(error.message);
      throw error;
    }

    if (members.length === 0) {
      console.log(tr`Nadie ha aceptado todavía en "${projectId}".`);
      return;
    }
    for (const m of members) {
      const synced = m.syncedAt ? tr`sincronizado ${m.syncedAt.slice(0, 10)}` : tr`sin sincronizar aún`;
      console.log(`  ${m.emails.join(", ")} (${m.inviteeKind}) · ${formatDuration(m.seconds)} · ${synced}`);
    }
  } finally { db.close(); }
}

/** `estela team revoke --token <token>` — también baja la cantidad de la suscripción de Teams. */
async function cmdTeamRevoke(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const token = required(args, "token");
    try {
      await revokeTeamMember(db, token);
    } catch (error) {
      if (error instanceof NoAccountError) throw new UserError(error.message);
      throw error;
    }
    console.log(tr`Invitación revocada.`);
  } finally { db.close(); }
}

/** `estela upgrade --plan pro|teams [--annual]` — imprime la URL de Checkout, no la abre. */
async function cmdUpgrade(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const plan = required(args, "plan");
    if (plan !== "pro" && plan !== "teams") throw new UserError(tr`--plan debe ser "pro" o "teams".`);
    const interval = args.flags["annual"] ? "yearly" : "monthly";

    let result: { url: string };
    try {
      result = await upgradeCheckout(db, plan, interval);
    } catch (error) {
      if (error instanceof NoAccountError) throw new UserError(error.message);
      throw error;
    }
    console.log(tr`\nAbre esto para completar el alta a ${plan === "pro" ? "Pro" : "Teams"}` +
      `${interval === "yearly" ? " (anual)" : ""}:\n`);
    console.log(`  ${result.url}\n`);
  } finally { db.close(); }
}

/** `estela billing portal` — cancelar o cambiar de tarjeta pasa en la página de Stripe. */
async function cmdBillingPortal(dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    let result: { url: string };
    try {
      result = await openBillingPortal(db);
    } catch (error) {
      if (error instanceof NoAccountError) throw new UserError(error.message);
      throw error;
    }
    console.log(tr`\nGestiona tu pago aquí:\n\n  ${result.url}\n`);
  } finally { db.close(); }
}

/** `estela account` — primer consumidor real de GET /account. */
async function cmdAccount(dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const account = store.getCloudAccount(db);
    if (!account) {
      throw new UserError(
        tr`Esta máquina no está vinculada a ninguna cuenta. Vincúlala con:\n\n` +
        tr`  estela login --email tu@correo.com\n`);
    }
    let info: { email: string; plan: string; devices: readonly { label: string | null; clientVersion: string | null; lastSeenAt: string | null }[] };
    try {
      info = await cloudGet(account.apiBaseUrl, "/account", { deviceToken: account.deviceToken });
    } catch (error) {
      if (error instanceof CloudError && error.status === 401) {
        throw new UserError(tr`Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n  estela login --email tu@correo.com\n`);
      }
      throw error;
    }
    console.log(tr`\n${info.email} · plan ${info.plan}\n`);
    for (const d of info.devices) {
      console.log(tr`  ${d.label ?? tr`(sin nombre)`} · v${d.clientVersion ?? "?"} · visto ${d.lastSeenAt?.slice(0, 10) ?? tr`nunca`}`);
    }
  } finally { db.close(); }
}

/**
 * Configura con qué correos commiteas en un proyecto.
 *
 * Sin argumento `--email`, enseña los autores del repositorio para que elijas:
 * en el repositorio de un cliente hay varios compañeros y tu correo global no
 * aparece por ningún lado.
 */
async function cmdAuthor(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);

    const emails = (str(args, "email") ?? "").split(",").map((e) => e.trim()).filter(Boolean);

    if (emails.length === 0) {
      const repo = project.repoPaths[0];
      if (!repo) throw new UserError(tr`El proyecto no tiene repositorio asignado.`);

      console.log(tr`\nAutores en ${project.name}:\n`);
      for (const a of await repoAuthors(repo)) {
        console.log(tr`  ${a.email.padEnd(38)} ${String(a.commits).padStart(5)} commits, hasta ${a.lastAt}`);
      }
      const current = store.getProjectAuthors(db, projectId);
      console.log(tr`\nConfigurado ahora: ${current.length ? current.join(", ") : tr`— nada —`}`);
      console.log(tr`\nElige el tuyo con:`);
      console.log(tr`  estela author --project ${projectId} --email tu@correo.com`);
      return;
    }

    store.setProjectAuthors(db, projectId, emails);
    console.log(tr`\n${project.name}: commits filtrados por ${emails.join(", ")}`);
    console.log(tr`Ejecuta "estela import" para recoger los que faltaban.`);
  } finally { db.close(); }
}

/** Commits de los repositorios de un proyecto, con sus ficheros. */
/** Revisa los datos y avisa de lo que rompería una demo. */
function cmdDoctor(dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const findings = diagnose(db);
    console.log(renderFindings(findings));
    if (findings.some((f) => f.severity === "error")) process.exitCode = 1;
  } finally { db.close(); }
}

function cmdExport(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);
    const client = store.getClient(db, project.clientId)!;
    const rates = store.getRates(db, projectId);

    const lang = docLangOf(args, client);
    const csv = withLang(lang, () => timeEntriesToCsv(
      store.getTimeEntries(db, projectId), project, client,
      (at) => rateAt(rates, projectId, at)));

    const out = str(args, "out");
    if (out) {
      writeFileSync(out, csv, "utf8");
      console.log(tr`CSV: ${out}`);
      // Solo si va a un fichero: por la salida estándar el aviso se colaría
      // dentro del propio CSV.
      hintDocLang(args, client, lang);
    } else {
      process.stdout.write(csv);
    }
  } finally { db.close(); }
}

function cmdSubscriptionAdd(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const currency = (str(args, "currency")?.toUpperCase() ?? "USD") as Currency;
    const fee = parseMoney(required(args, "fee"), currency);
    const fromRaw = str(args, "from");

    store.upsertSubscription(db, {
      id: required(args, "id"),
      name: str(args, "name") ?? required(args, "id"),
      monthlyFee: fee,
      effectiveFrom: fromRaw ? new Date(`${fromRaw}T00:00:00Z`) : new Date(0),
      effectiveTo: null,
    });
    console.log(tr`Suscripción "${str(args, "name") ?? required(args, "id")}": ${formatMoney(fee)}/mes.`);
    console.log(tr`Se repartirá entre proyectos según lo que consumió cada uno.`);
  } finally { db.close(); }
}

/** Reparto de la cuota entre proyectos, mes a mes. */
function cmdAiCost(dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const subs = store.listSubscriptions(db);
    const rows = store.consumptionByProjectMonth(db);

    if (rows.length === 0) { console.log(tr`Sin consumo registrado. Ejecuta: estela import`); return; }

    if (subs.length === 0) {
      console.log(tr`Sin suscripciones registradas: el coste se muestra a tarifa API.\n`);
      console.log(tr`Si pagas cuota fija, regístrala para ver el gasto real:`);
      console.log(tr`  estela subscription add --id claude-max --name "Claude Max" --fee 200\n`);
    }

    const shares = amortize(rows, subs, store.totalConsumptionByMonth(db));
    const names = new Map(store.listProjects(db).map((p) => [p.id, p.name]));

    let month = "";
    for (const s of shares) {
      if (s.month !== month) {
        month = s.month;
        console.log(tr`\n${month}   (consumo total: ${formatAiCost(s.monthTotal)} equiv. API)`);
      }
      const label = (names.get(s.projectId) ?? s.projectId).slice(0, 34).padEnd(36);
      const pct = `${(s.share * 100).toFixed(1)}%`.padStart(7);
      const real = subs.length ? formatMoney(s.amount).padStart(11) : "—".padStart(11);
      console.log(`  ${label}${formatAiCost(s.consumption).padStart(10)}${pct}${real}`);
    }

    if (subs.length > 0) {
      console.log(tr`\nLa última columna es dinero real: tu cuota repartida por consumo.`);
      console.log(tr`La primera es la tarifa API equivalente, útil solo como medida de uso.`);
    }
  } finally { db.close(); }
}

function cmdInvoice(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);
    const client = store.getClient(db, project.clientId)!;

    const cutoffRaw = required(args, "cutoff");
    const cutoffAt = new Date(`${cutoffRaw}T23:59:59Z`);
    if (Number.isNaN(cutoffAt.getTime())) throw new UserError(tr`Fecha inválida: ${cutoffRaw}`);

    const dryRun = args.flags["dry-run"] === true;
    const number = str(args, "number") ?? store.nextInvoiceNumber(db, "INF");
    const fx = str(args, "fx");

    const entries = store.getTimeEntries(db, projectId);

    // El reparto de la cuota se calcula AHORA y viaja con el informe. Si se
    // recalculara al reimprimirlo, un documento de agosto daría otra cifra en
    // diciembre, cuando ya se conoce más consumo.
    const subs = store.listSubscriptions(db);
    const months = new Set<string>();
    for (const e of entries) {
      if (e.billable && e.invoiceId === null && e.endedAt <= cutoffAt) months.add(monthOf(e.startedAt));
    }
    const amortized = subs.length
      ? shareForProject(
          amortize(store.consumptionByProjectMonth(db), subs, store.totalConsumptionByMonth(db)),
          projectId, [...months])
      : null;

    // Las líneas de un informe se congelan al emitirlo, así que se emiten ya en
    // el idioma del cliente: es el que verá en el PDF y en el CSV.
    const lang = docLangOf(args, client);
    const invoice = withLang(lang, () => issueInvoice({
      client, project,
      rates: store.getRates(db, projectId),
      entries, cutoffAt, number,
      ...(fx ? { usdFxRate: Number(fx) } : {}),
      ...(amortized ? { aiAmortized: amortized } : {}),
    }));

    console.log(renderInvoice(invoice, client, project));

    // Coste real de IA del periodo: la cuota de tus suscripciones repartida
    // por consumo. Es lo que de verdad te costó, frente a la tarifa API.
    if (invoice.aiAmortized) {
      console.log(tr`Coste real de IA imputado desde tu suscripción: ${formatMoney(invoice.aiAmortized)}`);
    }

    if (subs.length === 0) {
      console.log(tr`\nSin suscripciones registradas. Si pagas cuota fija, el importe de arriba`);
      console.log(tr`es tarifa API equivalente, no lo que gastaste. Regístrala con:`);
      console.log(tr`  estela subscription add --id claude-max --name "Claude Max" --fee 200`);
    }

    if (fx) {
      const m = marginOf(invoice, Number(fx));
      console.log(tr`\nMargen a tarifa API: ${formatMoney(m.margin)} de ${formatMoney(m.revenue)} ` +
        `(${m.marginPct.toFixed(1)}%)`);
    }

    // --- Exportables ---------------------------------------------------------
    const pdfPath = str(args, "pdf");
    if (pdfPath) {
      const issuerName = str(args, "from-name");
      const pdf = withLang(lang, () => invoiceToPdf(invoice, client, project, {
        ...(issuerName ? {
          issuer: {
            name: issuerName,
            ...(str(args, "from-tax-id") ? { taxId: str(args, "from-tax-id")! } : {}),
            ...(str(args, "from-email") ? { email: str(args, "from-email")! } : {}),
          },
        } : {}),
        ...(invoice.aiAmortized ? { amortizedAiCost: invoice.aiAmortized } : {}),
      }));
      writeFileSync(pdfPath, pdf);
      console.log(tr`\nPDF: ${pdfPath}  (${(pdf.length / 1024).toFixed(1)} KB, ${invoice.lines.length} conceptos)`);
    }

    const csvPath = str(args, "csv");
    if (csvPath) {
      writeFileSync(csvPath, withLang(lang, () => invoiceToCsv(invoice, client, project)), "utf8");
      console.log(tr`CSV: ${csvPath}`);
    }
    if (pdfPath || csvPath) hintDocLang(args, client, lang);

    if (dryRun) {
      console.log(tr`\n[--dry-run] No se guardó nada. Repite sin --dry-run para emitirlo.`);
      return;
    }

    const billed = entries
      .filter((e) => e.billable && e.invoiceId === null && e.endedAt <= cutoffAt)
      .map((e) => e.id);
    store.saveInvoice(db, invoice, billed);
    console.log(tr`\nInforme ${invoice.number} emitido. ${billed.length} bloques marcados como informados.`);
  } finally { db.close(); }
}

// ---------------------------------------------------------------------------

/**
 * De un paquete publicado, `dist/cli.js` está siempre un nivel por debajo de
 * `package.json`. Leerlo así, en vez de tenerlo escrito dos veces, es lo
 * único que garantiza que este número y el que ve `npm view estela version`
 * nunca se desincronicen.
 */
const VERSION = (require("../package.json") as { version: string }).version;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  // Lo primero, antes de imprimir nada: hasta la ayuda sale ya en su idioma.
  setLang(detectLang({ flag: str(args, "lang"), env: process.env, platform: process.platform }));
  setMoneyLocale(getLang() === "en" ? "en-US" : "es-EC");

  // Global y antes que nada: "estela --version" no debe abrir ninguna base de
  // datos ni comprobar el resto de argumentos para responder algo tan simple.
  if (args.flags["version"] === true) {
    console.log(VERSION);
    return;
  }

  setClientVersion(VERSION);

  const dbPath = str(args, "db") ?? DEFAULT_DB_PATH;
  const command = args._.join(" ");

  // Se llama aquí, no al final: un comando que falla a medias (por ejemplo
  // "estela import" sin repositorios) debe avisar igual de que hay una
  // versión nueva, no solo los que terminan bien.
  checkForUpdate(VERSION);

  switch (command) {
    case "setup":             await cmdSetup(args, dbPath); break;
    case "web":               await cmdWeb(args, dbPath); break;
    case "demo":              await cmdDemo(args, dbPath); break;
    case "import":            await cmdImport(args, dbPath); break;
    case "client add":        cmdClientAdd(args, dbPath); break;
    case "project add":       cmdProjectAdd(args, dbPath); break;
    case "project close":     cmdProjectClose(args, dbPath); break;
    case "project reopen":    cmdProjectReopen(args, dbPath); break;
    case "rate set":          cmdRateSet(args, dbPath); break;
    case "budget":            cmdBudget(args, dbPath); break;
    case "subscription add":  cmdSubscriptionAdd(args, dbPath); break;
    case "ai-cost":           cmdAiCost(dbPath); break;
    case "status":            cmdStatus(dbPath); break;
    case "doctor":            cmdDoctor(dbPath); break;
    case "entries":           cmdEntries(args, dbPath); break;
    case "log":               cmdLog(args, dbPath); break;
    case "author":            await cmdAuthor(args, dbPath); break;
    case "share":             cmdShare(args, dbPath); break;
    case "publish":           await cmdPublish(args, dbPath); break;
    case "export":            cmdExport(args, dbPath); break;
    case "report":            cmdInvoice(args, dbPath); break;
    case "login":             await cmdLogin(args, dbPath); break;
    case "logout":            await cmdLogout(dbPath); break;
    case "sync enable":       cmdSyncEnable(args, dbPath); break;
    case "sync":              await cmdSync(args, dbPath); break;
    case "team invite":       await cmdTeamInvite(args, dbPath); break;
    case "team accept":       await cmdTeamAccept(args, dbPath); break;
    case "team repo":         cmdTeamRepo(args, dbPath); break;
    case "team list":         await cmdTeamList(args, dbPath); break;
    case "team revoke":       await cmdTeamRevoke(args, dbPath); break;
    case "team ai-cost":      await cmdTeamAiCost(args, dbPath); break;
    case "upgrade":           await cmdUpgrade(args, dbPath); break;
    case "billing portal":    await cmdBillingPortal(dbPath); break;
    case "account":           await cmdAccount(dbPath); break;
    case "":
    case "help":         console.log(helpText()); break;
    default:
      console.error(tr`Comando desconocido: "${command}"\n${helpText()}`);
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  if (error instanceof UserError || error instanceof InvoiceError || error instanceof CloudError) {
    console.error(`\n${error.message}\n`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

export { breakdownOfTurn };
