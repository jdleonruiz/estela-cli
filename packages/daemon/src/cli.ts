#!/usr/bin/env node
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";

// `node:sqlite` avisa de que es experimental en cada arranque. Es ruido para
// quien solo quiere su factura, y el aviso no le dice nada accionable.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

import type { DatabaseSync } from "node:sqlite";

import type { Client, CloudAccount, Currency, Money, Project, TimeEntry, TrackerSystem, WorkItemTracker, WorkKind } from "@estela/shared";
import {
  extractWorkItems, formatAiCost, formatDuration, formatMoney, formatMoneyWhole, formatWorkItem, localDate, parseMoney,
  parseWorkItem, setMoneyLocale, TRACKER_SYSTEMS, WORK_KIND_LABELS,
} from "@estela/shared";

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";

import { amortize, feeForMonth, monthOf, shareForProject } from "./billing/amortize.js";
import { badgeMarkdown, badgeText, badgeUrl } from "./export/badge.js";
import { receiptData, renderReceipt } from "./export/receipt.js";
import { issueInvoice, InvoiceError, marginOf, rateAt, renderInvoice } from "./billing/invoice.js";
import { attachCommits, describeBlock, groupByBranchAndDay, sessionize } from "./billing/sessionize.js";
import { DEFAULT_DB_PATH, openDatabase } from "./db/schema.js";
import * as store from "./db/store.js";
import { seedDemo } from "./demo.js";
import { diagnose, renderFindings } from "./doctor.js";
import { applySetup, planSetup, summarize, summaryLine } from "./setup.js";
import { invoiceToCsv, spendToCsv, timeEntriesToCsv, undeliveredToCsv } from "./export/csv.js";
import { financeToCsv, financeToJson, financeToMarkdown, sum, type FinanceClient, type FinanceDeliveries,
         type FinanceSummary, type FinanceUndelivered } from "./export/finance.js";
import { isSameOrInside, normalizePath } from "./paths.js";
import { CLOCKIFY_DATE_FORMATS, type ClockifyDateFormat, timeEntriesToClockifyCsv } from "./export/clockify.js";
import { invoiceToPdf } from "./export/invoice-pdf.js";
import { buildShareReport } from "./export/share.js";
import { startServer } from "./server.js";
import { checkForUpdate } from "./updateCheck.js";
import { analyzePlan } from "./metrics/plan.js";
import { undeliveredSpend, shareOf, type BranchLine, type Spend, type UndeliveredReport, type UndeliveredTurn } from "./metrics/undelivered.js";
import { realFromMonths, spendByUnit, type Basis, type SpendBy, type SpendProject, type SpendProjectReport, type SpendUnit } from "./metrics/spend.js";
import { blocksCachePath, scanBlocks } from "./plan-blocks.js";
import { planById, type ClaudePlanId } from "./plan-prices.js";
import { planToJson, renderNoData, renderNoPlan, renderPlanReport, type BlockCounts } from "./plan-report.js";
import { historyPath, KEEP_DAYS, pruneSamples, readSamples } from "./rate-history.js";
import { loadCache } from "./statusline-cache.js";
import {
  listPublishedPanels, NoAccountError, preparePanel, unpublishAll, unpublishPanel, uploadPanel,
  type PanelSummary, type PublishResult,
} from "./publish.js";
import { NotSyncedError, syncProject } from "./sync.js";
import { syncTeamProject } from "./sync/team.js";
import { acceptTeamInvite, inviteTeamMember, listTeamMembers, revokeTeamMember } from "./team.js";
import { openBillingPortal, upgradeCheckout } from "./billing.js";
import { login, logout } from "./cloud/auth.js";
import { CloudError, cloudGet, cloudPost, setClientVersion } from "./cloud/client.js";
import { breakdownOfTurn, costOfTurn } from "./pricing/cost.js";
import { type AgentScan, allTurns, scanAgents } from "./watchers/agents.js";
import { branchNames, gitUserEmail, integrationBranch, mergedBranches, readCommits, readMerges, repoAuthors, repoRoot } from "./watchers/git.js";
import { myEmailsByRepo, onlyMine } from "./watchers/identity.js";
import { gitRoot } from "./project-of.js";
import { GitHubPlanSource } from "./delivery/github.js";
import { GitLabPlanSource } from "./delivery/gitlab.js";
import { deliveryReport, type Cost, type DeliveryBlock, type DeliveryLine, type DeliveryReport } from "./delivery/report.js";
import type { Availability, FetchQuery, PlanFilter, PlanSource, TrackerItem } from "./delivery/source.js";
import { clientRequests, type Requester } from "./delivery/clients.js";
import { detectLang, documentLang, getLang, setLang, tr, withLang, type Lang } from "./i18n/index.js";
import { DAYS, MONTHS } from "./export/dates.js";
import { HISTORY_WEEKS, quotaToJson, weekStart, type AgentQuota, type QuotaBreakdown,
         type QuotaBucket, type QuotaReport } from "./metrics/quota.js";
import { loadQuotaReport, refreshQuotaTurns } from "./quota.js";
import { commitOnlyBlocks, knownTurns, planEntries, type AssignmentPlan } from "./billing/assign.js";
import { backupName, claudeSettingsPath, estelaOnPath, planInstall, planUninstall } from "./statusline-install.js";
import { kindLabel } from "./i18n/labels.js";

const HELP_ES = `
estela — registro de horas para desarrollo asistido por IA

  estela setup
        Primera ejecución: detecta tus agentes y repositorios, y reconstruye
        tu historial. Dos minutos, sin preguntas y sin cuenta.

  estela import [--since YYYY-MM-DD] [--repo <ruta>]
        Reconstruye tu historial desde los transcripts de los agentes y git.
        Una sesión en una subcarpeta o en un worktree cuenta para el
        proyecto de su repo. Dos ramas a la vez en un proyecto se reparten
        ese rato: el total es tiempo real. Nunca mueve horas de un proyecto
        a otro ni toca un día aprobado.

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
  estela project tracker --project <id> [--system jira|azure|github|gitlab|none]
                         [--prefix PROJ,OPS] [--plan-label <etiqueta>|none]
                         [--client-label <prefijo>|none]
        El gestor de tareas del proyecto, para reconocer sus tickets en la
        rama y los commits (feature/1234-login, AB#1234, PROJ-12). Luego
        "estela import" lo aplica a lo ya capturado. --plan-label es la
        etiqueta que marca lo planificado para "estela delivery", y
        --client-label el prefijo de las peticiones de clientes (cliente:).
  estela delivery [--project <id>] [--month YYYY-MM | --from YYYY-MM-DD [--to YYYY-MM-DD]]
                  [--label <etiqueta> | --milestone <nombre>] [--offline] [--json]
        Planificado frente a entregado en un periodo (por defecto, este mes),
        con el coste de IA de cada parte: lo del plan que se entregó, lo que
        no, y lo entregado que no estaba en el plan. Lee las issues y los PR
        de GitHub con "gh" (--system github) o las issues y las MR de GitLab
        con "glab" (--system gitlab); es la única llamada fuera de tu
        máquina, y --offline la evita. Sin ellos usa lo leído la última vez
        o, si nunca se leyó, lo entregado según git.
  estela delivery --by client [--project <id>] [--month YYYY-MM | --from …]
        El gasto de IA del periodo en peticiones de cada cliente frente al
        resto: una issue o un PR con la etiqueta "cliente:<nombre>" es una
        petición de ese cliente, y un PR hereda las etiquetas de las issues
        que cierra. Una hora que sirvió a varios va a "Varios", sin repartir.
        No hay ingresos ni contratos: solo une el gasto con quién lo pidió.
  estela summary [--month YYYY-MM | --from YYYY-MM-DD [--to YYYY-MM-DD]]
                 [--client <id>] [--project <id>] [--format md|csv|json]
                 [--out <fichero>] [--stale-days 14] [--lang es|en]
        Informe para finanzas, en el lenguaje de quien no programa: lo
        pagado en IA, por cliente y proyecto, lo entregado (y el plan, si
        "estela delivery" lo leyó), lo pedido por cada cliente y lo que no
        llegó a entregarse. Los detalles técnicos van al final. Por defecto,
        el último mes cerrado. Con --out, el formato sale de la extensión.
        No llama a nada fuera de tu máquina.
  estela client alias [--client <id> --label <nombre>] [--remove --label <nombre>]
        Qué cliente de Estela es cada nombre de las etiquetas de cliente.
        Sin alias se compara con el id y el nombre del cliente (sin
        mayúsculas, acentos ni guiones). Sin argumentos, lista los alias.
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
  estela entries --project <id> [--ids]
        Bloques imputados a un proyecto, con sus tickets. --ids enseña el id
        de cada uno, para "estela entry link".
  estela entry link --entry <id> --items PROJ-12[,AB#1234] | --clear
        Pone a mano los tickets de un bloque. El import ya no los cambia.
  estela ai-cost                      Reparto de tu cuota entre proyectos.
  estela ai-cost --by branch|item [--project <id>] [--client <id>]
                 [--month YYYY-MM | --from YYYY-MM-DD --to YYYY-MM-DD]
                 [--json | --csv <fichero.csv>]
        Coste de IA y horas de cada entrega: por rama, o por ticket y PR.
        Dos cifras: a precio de API (mide uso) y tu cuota repartida (dinero
        pagado). Cada fila dice en qué se basa: la rama que anotó el agente,
        el número en la rama, #12 en un commit, lo puesto a mano o el
        commit de merge del PR. Lo que no tiene base va a "Sin atribuir",
        entero. Solo lee: no recalcula días aprobados ni facturados.
  estela ai-cost --undelivered [--stale-days 14] [--project <id>] [--client <id>]
                 [--month YYYY-MM | --from YYYY-MM-DD --to YYYY-MM-DD]
                 [--json | --csv <fichero.csv>]
        El gasto de IA que no ha llegado a la rama principal, por proyecto, en
        cifra y en % del gasto: sesiones sin ningún commit tuyo (durante ella
        ni en los 30 min siguientes) y ramas que existen, no están fusionadas
        y llevan --stale-days días sin actividad. Es una señal para revisar,
        no un juicio. No cuenta: las ramas borradas sin merge (pudo ser un
        squash) ni las sesiones anteriores a tu primer commit en el repo.
  estela quota [--json] [--no-refresh] [--weighted]
        ¿Qué proyecto se come tu cuota de Claude Code o Codex? Tokens por
        proyecto en la ventana de 5 h actual y en la semana (de lunes a
        hoy), y esta semana frente a la media de tus 4 anteriores en el
        mismo tramo. Solo consumo real: no dice cuánto te queda, porque
        Anthropic y OpenAI no publican los límites. La ventana de 5 h es
        una estimación: no se sabe cómo redondean su inicio, y lo que uses
        en claude.ai u otro equipo también cuenta y Estela no lo ve.
        Si la status line de Estela está instalada, la ventana de Claude
        Code es la que da Claude Code, no una estimación. Una sesión en un
        worktree o en una subcarpeta cuenta para el proyecto de su repo.
        --weighted reparte el % por precio de lista del modelo en vez de
        por tokens (no es cómo el proveedor cuenta tu límite).
        Copilot queda fuera: no guarda tokens fiables. Antes de calcular
        lee los transcripts desde el lunes (--no-refresh lo evita).
        A diferencia de ai-cost, que reparte dinero, esto reparte tokens.

  estela plan [--days <n>] [--json] [--no-color]
  estela plan set pro|max5|max20 [--since AAAA-MM-DD]
        ¿El plan de Claude que pagas te sobra o te falta? Analiza los
        porcentajes de 5 h y semana que Claude Code manda a la status line
        (solo en la terminal) y los compara con los otros planes usando el
        multiplicador por sesión que publica Anthropic. El límite semanal
        entre planes no se compara: no se publica. Primero declara tu plan
        con "plan set". Por defecto, los últimos 28 días.
  estela statusline install [--force | --append]
        Una línea bajo cada sesión de Claude Code: proyecto, horas medidas
        hoy, la parte de tu consumo de la semana que es de este proyecto y,
        si Claude Code los manda, sus porcentajes de límite de la semana y
        de 5 h (tal cual, sin estimar nada). Se calcula en tu máquina en
        unos 50 ms. Añade el bloque a ~/.claude/settings.json sin tocar lo
        demás, y antes deja una copia. Si ya tienes otra status line no la
        pisa: --force la sustituye y --append la encadena detrás.
  estela statusline uninstall
        La quita. Si la instalaste con --append, deja la que tenías.
  estela badge [--project <id>]
        Badge para el README: horas medidas y coste de IA del proyecto.
        Sin --project, el del repositorio en el que estás.
  estela receipt [--week] [--names] [--out <fichero.png>]
        Un recibo en PNG: horas medidas y estimadas, coste de IA, lo más
        caro y lo que ahorró la caché. Con --week, los últimos 7 días.
        Sin nombres de proyectos ni ramas salvo con --names. Se genera y
        se queda en tu máquina.
  estela share --project <id> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
               [--author <tu nombre>] [--with-amounts] [--out <fichero.html>]
        Informe compartible en un solo fichero HTML. Horas y commits; sin
        consumo de IA, que es tuyo mientras la pagues tú.

  estela publish --project <id> [--author <tu nombre>] [--with-amounts]
                 [--token <existente>] [--no-team] [--client <correo>[,otro]]
                 [--no-credit]
        Panel de solo lectura para que tu cliente USE el producto, no solo
        reciba un documento. Se aloja en getestela.dev — Free permite uno a
        la vez, Pro y Teams sin límite. Necesita "estela login" antes.
        Con --client se le avisa por correo y le aparece en su cuenta al
        entrar en getestela.dev/app. Sin --client no se toca esa lista: tus
        republicaciones no desvinculan a quien ya lo tenía.
        --no-credit quita la línea "Horas rellenadas por Estela" del pie
        (Pro y Teams).
        Antes de subir enseña lo que va a quedar público (autores, ramas,
        ficheros, correos del cliente) y pide confirmación; --yes la salta.
  estela unpublish [<proyecto|token>] [--all] [--yes]
        Borra el panel del servidor: el enlace deja de funcionar. Sin
        argumentos, lista tus paneles publicados.

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

  estela export --project <id> [--out <fichero.csv>] [--month YYYY-MM]
                [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--format csv|clockify]
        Tus bloques en CSV. --format clockify (Pro) sale listo para importar en
        Clockify; --email es tu correo allí (por defecto el de tu cuenta de
        Estela), y --date-format/--time-format tienen que coincidir con tu
        perfil de Clockify (MM/DD/YYYY y 12h por defecto).

  estela report --project <id> --cutoff YYYY-MM-DD [--dry-run]
                [--pdf <fichero.pdf>] [--csv <fichero.csv>] [--fx <tipo>]
                [--number <nº>]
                [--from-name <tu nombre>] [--from-email <email>]
                [--from-tax-id <tu NIF/CIF>] [--no-amounts]
        Informe de horas y commits para respaldar tu trabajo. No es una
        factura: Estela no emite documentos fiscales.
        --no-amounts saca el PDF sin tarifa ni importes. En el panel, lo ya
        emitido se vuelve a descargar con o sin ellos.
        --number fija el número del informe; sin él se numera solo y
        correlativo por año (INF-${new Date().getFullYear()}-001, -002...).
        Los --from-* son tus datos como emisor, en la cabecera del PDF.
        Necesitan --from-name: sin nombre no se imprime ese bloque, y
        --from-tax-id y --from-email se ignoran.

Opciones globales:  --db <ruta>   (por defecto ${DEFAULT_DB_PATH})
                    --lang es|en  Idioma. Sin ella se usa el del sistema;
                                  ESTELA_LANG=en lo fija para siempre.
                    --version     Solo imprime la versión instalada.

Red:  Sin cuenta, Estela solo consulta npm una vez al día por si hay
      versión nueva.
      ESTELA_NO_UPDATE_CHECK=1  no la consulta (tampoco con CI definida).
      ESTELA_OFFLINE=1          ninguna conexión de red: ni versión, ni
                                banner, ni nada de la cuenta.
`;

const HELP_EN = `
estela — time tracking for AI-assisted development

  estela setup
        First run: detects your agents and repositories, and rebuilds your
        history. Two minutes, no questions, no account.

  estela import [--since YYYY-MM-DD] [--repo <path>]
        Rebuilds your history from agent transcripts and git. A session in a
        subfolder or a worktree counts for its repo's project. Two branches
        at once in a project share that time: the total is real time. It
        never moves hours from one project to another or touches an approved
        day.

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
  estela project tracker --project <id> [--system jira|azure|github|gitlab|none]
                         [--prefix PROJ,OPS] [--plan-label <label>|none]
                         [--client-label <prefix>|none]
        The project's issue tracker, to recognise its tickets in the branch
        and commits (feature/1234-login, AB#1234, PROJ-12). Then
        "estela import" applies it to what's already captured. --plan-label
        is the label that marks what's planned, for "estela delivery", and
        --client-label the prefix of client requests (cliente:).
  estela delivery [--project <id>] [--month YYYY-MM | --from YYYY-MM-DD [--to YYYY-MM-DD]]
                  [--label <label> | --milestone <name>] [--offline] [--json]
        Planned versus delivered in a period (this month by default), with
        the AI cost of each part: what was planned and delivered, what
        wasn't, and what was delivered without being planned. It reads
        GitHub issues and PRs with "gh" (--system github) or GitLab issues
        and MRs with "glab" (--system gitlab); it's the only call off your
        machine, and --offline avoids it. Without them it uses what was read
        last time or, if never read, what git says was delivered.
  estela delivery --by client [--project <id>] [--month YYYY-MM | --from …]
        The period's AI spend on each client's requests versus the rest: an
        issue or PR labelled "cliente:<name>" is that client's request, and a
        PR inherits the labels of the issues it closes. An hour that served
        several goes to "Several", unsplit. No revenue or contracts: it only
        links spend to who asked for it.
  estela summary [--month YYYY-MM | --from YYYY-MM-DD [--to YYYY-MM-DD]]
                 [--client <id>] [--project <id>] [--format md|csv|json]
                 [--out <file>] [--stale-days 14] [--lang es|en]
        A report for finance, in the words of someone who doesn't code: what
        was paid for AI, by client and project, what was delivered (and the
        plan, if "estela delivery" read it), what each client asked for, and
        what never got delivered. Technical details go at the end. Defaults
        to the last closed month. With --out, the format comes from the
        extension. It never calls anything off your machine.
  estela client alias [--client <id> --label <name>] [--remove --label <name>]
        Which Estela client each name in the client labels is. Without an
        alias it's matched against the client's id and name (ignoring case,
        accents and hyphens). With no arguments, lists the aliases.
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
  estela entries --project <id> [--ids]
        Blocks assigned to a project, with their tickets. --ids shows each
        one's id, for "estela entry link".
  estela entry link --entry <id> --items PROJ-12[,AB#1234] | --clear
        Sets a block's tickets by hand. Imports won't change them anymore.
  estela ai-cost                      How your subscription splits across projects.
  estela ai-cost --by branch|item [--project <id>] [--client <id>]
                 [--month YYYY-MM | --from YYYY-MM-DD --to YYYY-MM-DD]
                 [--json | --csv <file.csv>]
        AI cost and hours of each delivery: by branch, or by ticket and PR.
        Two figures: at API prices (measures usage) and your subscription
        split by usage (money paid). Each row says what it's based on: the
        branch the agent recorded, the number in the branch, #12 in a
        commit, set by hand, or the PR's merge commit. Anything without a
        basis goes to "Unattributed", whole. Read-only: it never recalculates
        approved or invoiced days.
  estela ai-cost --undelivered [--stale-days 14] [--project <id>] [--client <id>]
                 [--month YYYY-MM | --from YYYY-MM-DD --to YYYY-MM-DD]
                 [--json | --csv <file.csv>]
        AI spend that hasn't reached the main branch, per project, as a figure
        and as a % of spend: sessions with no commit of yours (during them or
        in the 30 min after) and branches that exist, aren't merged, and have
        been idle for --stale-days days. It's a signal to review, not a
        verdict. Not counted: branches deleted with no merge (it may have been
        a squash) and sessions before your first commit in the repo.
  estela quota [--json] [--no-refresh] [--weighted]
        Which project is eating your Claude Code or Codex quota? Tokens per
        project in the current 5-hour window and this week (Monday to
        today), and this week against the average of your previous 4 over
        the same stretch. Real usage only: it never says how much you have
        left, because Anthropic and OpenAI don't publish the limits. The
        5-hour window is an estimate: how its start is rounded isn't public,
        and anything you use on claude.ai or another machine also counts and
        Estela can't see it. With Estela's status line installed, the
        Claude Code window is the one Claude Code reports, not an estimate.
        A session in a worktree or a subfolder counts for its repo's
        project. --weighted splits the % by the model's list price instead
        of by tokens (not how the provider counts your limit). Copilot is
        left out: it doesn't record reliable tokens. Before calculating it reads transcripts since Monday
        (--no-refresh skips that). Unlike ai-cost, which splits money, this
        splits tokens.

  estela plan [--days <n>] [--json] [--no-color]
  estela plan set pro|max5|max20 [--since YYYY-MM-DD]
        Is your Claude plan too big or too small? It analyses the 5-hour
        and weekly percentages Claude Code sends to the status line (only
        in the terminal) and compares them with the other plans using the
        per-session multiplier Anthropic publishes. The weekly limit isn't
        compared across plans: it isn't published. Declare your plan first
        with "plan set". Defaults to the last 28 days.
  estela statusline install [--force | --append]
        A line under every Claude Code session: project, hours measured
        today, this project's share of your usage this week and, if Claude
        Code sends them, its weekly and 5-hour limit percentages (as they
        come, nothing estimated). Calculated on your machine in about
        50 ms. It adds the block to ~/.claude/settings.json without touching
        anything else, after making a backup. If you already have another
        status line it won't overwrite it: --force replaces it and --append
        chains it after Estela's.
  estela statusline uninstall
        Removes it. If you installed it with --append, your previous one
        is put back.
  estela badge [--project <id>]
        Badge for your README: the project's measured hours and AI cost.
        Without --project, the one for the repository you're in.
  estela receipt [--week] [--names] [--out <file.png>]
        A PNG receipt: measured and estimated hours, AI cost, the most
        expensive work and what caching saved. With --week, the last 7 days.
        No project or branch names unless you pass --names. It's generated
        and stays on your machine.
  estela share --project <id> [--from YYYY-MM-DD] [--to YYYY-MM-DD]
               [--author <your name>] [--with-amounts] [--out <file.html>]
        Shareable report in a single HTML file. Hours and commits; no AI
        usage, which is yours as long as you're the one paying for it.

  estela publish --project <id> [--author <your name>] [--with-amounts]
                 [--token <existing>] [--no-team] [--client <email>[,other]]
                 [--no-credit]
        Read-only dashboard so your client can USE the product, not just
        receive a document. Hosted on getestela.dev — Free allows one at a
        time, Pro and Teams have no limit. Requires "estela login" first.
        With --client they get an email and it shows up in their account
        when they sign in to getestela.dev/app. Without --client that list
        isn't touched: republishing never unlinks anyone who already had it.
        --no-credit removes the "Hours filled in by Estela" line from the
        footer (Pro and Teams).
        Before uploading it shows what will become public (authors,
        branches, files, client emails) and asks to confirm; --yes skips it.
  estela unpublish [<project|token>] [--all] [--yes]
        Deletes the dashboard from the server: the link stops working.
        With no arguments, lists your published dashboards.

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

  estela export --project <id> [--out <file.csv>] [--month YYYY-MM]
                [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--format csv|clockify]
        Your blocks as CSV. --format clockify (Pro) comes out ready to import
        into Clockify; --email is your email there (your Estela account's by
        default), and --date-format/--time-format have to match your Clockify
        profile (MM/DD/YYYY and 12h by default).

  estela report --project <id> --cutoff YYYY-MM-DD [--dry-run]
                [--pdf <file.pdf>] [--csv <file.csv>] [--fx <rate>]
                [--number <no.>]
                [--from-name <your name>] [--from-email <email>]
                [--from-tax-id <your tax ID>] [--no-amounts]
        Report of hours and commits to back up your work. It isn't an
        invoice: Estela doesn't issue tax documents.
        --no-amounts leaves the rate and amounts out of the PDF. In the panel,
        issued reports can be downloaded again with or without them.
        --number sets the report number; without it, reports are numbered
        automatically and sequentially per year (INF-${new Date().getFullYear()}-001, -002...).
        The --from-* flags are your details as the issuer, in the PDF header.
        They need --from-name: without a name that block isn't printed, and
        --from-tax-id and --from-email are ignored.

Global options:  --db <path>   (default ${DEFAULT_DB_PATH})
                 --lang es|en  Language. Without it, your system's is used;
                               ESTELA_LANG=en sets it for good.
                 --version     Only prints the installed version.

Network:  Without an account, Estela only checks npm once a day for a new
          version.
          ESTELA_NO_UPDATE_CHECK=1  skips that check (so does having CI set).
          ESTELA_OFFLINE=1          no network connections at all: no
                                    version check, no banner, no account.
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
/**
 * Arranca el panel convirtiendo el fallo en algo legible.
 *
 * `startServer` ya rechaza con una frase en vez de un errno, pero si llega
 * como Error normal, el catch del final imprime el objeto entero con su
 * traza. Como UserError, sale la frase sola.
 */
async function arrancarPanel(opciones: Parameters<typeof startServer>[0]): Promise<string> {
  try {
    return await startServer(opciones);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : String(error));
  }
}

async function cmdWeb(args: Args, dbPath: string): Promise<void> {
  const port = Number(str(args, "port") ?? 4319);
  const url = await arrancarPanel({ port, dbPath });
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
  const url = await arrancarPanel({ port, dbPath: rutaDemo, autoImportMinutes: 0, demo: true });
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
    case "copilot": return "GitHub Copilot";
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
      console.log(tr`\n  No se han encontrado sesiones de Claude Code, Codex ni Copilot (VS Code),`);
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
      console.log(tr`  No se han encontrado sesiones de Claude Code, Codex ni Copilot (VS Code) —`);
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
    starHintOnce(dbPath);
  } finally { db.close(); }
}

/** Lo que se recuperaría en días aprobados o facturados: se avisa, no se aplica. */
function printRecoveryBlocked(db: ReturnType<typeof openDatabase>, blocked: AssignmentPlan["blocked"]): void {
  if (blocked.length === 0) return;
  console.log(tr`\n  Sin tocar, porque ese día ya está aprobado o facturado:`);
  for (const b of [...blocked].sort((x, y) => x.day.localeCompare(y.day))) {
    const name = store.getProject(db, b.projectId)?.name ?? b.projectId;
    console.log(tr`    ${b.day} · ${name}: ${formatDuration(b.seconds)} recuperables. Revísalo con: estela entries --project ${b.projectId}`);
  }
}

/** Una pregunta de sí o no. Sin terminal (un script, CI) la respuesta es no. */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await new Promise<string>((res) => rl.question(question, res))).trim().toLowerCase();
    return ["s", "si", "sí", "y", "yes"].includes(answer);
  } finally { rl.close(); }
}

/**
 * La estrella se pide una vez, al terminar bien el primer setup: es cuando se
 * acaba de ver funcionar. Casi todo el que instala lo hace por npm y nunca
 * pasa por el repositorio, así que sin esto no sabe que existe. Una marca al
 * lado de la base evita pedirlo en cada setup, que sería insistir.
 */
function starHintOnce(dbPath: string): void {
  const flag = join(dirname(dbPath), ".star-hint-shown");
  if (existsSync(flag)) return;
  console.log(tr`\n  ¿Te sirve? Una estrella en GitHub ayuda a que otros lo encuentren:`);
  console.log(`  https://github.com/jdleonruiz/estela-cli\n`);
  try { writeFileSync(flag, new Date().toISOString()); } catch { /* sin permiso: se volverá a pedir, no pasa nada */ }
}

async function cmdImport(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const sinceRaw = str(args, "since");
    const since = sinceRaw ? new Date(`${sinceRaw}T00:00:00Z`) : undefined;
    if (since && Number.isNaN(since.getTime())) throw new UserError(tr`Fecha inválida: ${sinceRaw}`);

    const repoFilter = str(args, "repo");
    const repoPaths = repoFilter ? [normalizePath(resolve(repoFilter))] : undefined;

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
      store.saveMerges(db, await readMerges(root, since ? { since } : {}));
    }
    // Todo lo conocido, no solo lo leído ahora (ver knownTurns). Con --repo, solo
    // ese repo, que es lo que se ha pedido.
    const known = knownTurns(db, turns).filter((t) =>
      !repoPaths || (t.repoPath !== null && repoPaths.some((p) => isSameOrInside(t.repoPath!, p))));
    // Los correos también de los repos sin sesión reciente: sin ellos, un día
    // antiguo se recalcularía sin sus commits y perdería la descripción.
    const mine = await myEmailsByRepo(db, new Set([...repos, ...known.flatMap((t) => t.repoPath ?? [])]));
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
    const fromAgents = attachCommits(sessionize(known), commitsAll);
    const fromCommits = commitOnlyBlocks(db, commitsAll, fromAgents);
    const raw = [...fromAgents, ...fromCommits];
    if (fromCommits.length) {
      console.log(tr`  ${fromCommits.length} bloques deducidos solo de commits (sin agente)`);
    }

    // Sesiones en subcarpetas y worktrees incluidas: ver billing/assign.ts.
    const plan = planEntries(db, raw);

    for (const { entry } of plan.entries) store.saveTimeEntry(db, entry);
    // Con --repo el plan no ve el resto de proyectos: nada de retirar.
    const retired = repoPaths ? 0 : store.deleteStaleEntries(db, plan.stale);
    const entries = plan.entries.length;
    const unassigned = plan.unassigned;

    console.log(
      tr`Bloques: ${raw.length} detectados → ${plan.grouped} tras agrupar por rama y día · ` +
      tr`${entries} imputados · ${unassigned} sin proyecto`);
    const aplicadas = [...plan.recovered.values()].reduce((a, b) => a + b, 0);
    if (aplicadas > 0) {
      console.log(tr`  ${formatDuration(aplicadas)} recuperadas de sesiones en subcarpetas y worktrees`);
    }
    printRecoveryBlocked(db, plan.blocked);
    if (retired > 0) {
      console.log(tr`  ${retired} imputaciones retiradas: sus horas ya estaban en otra rama del mismo día`);
    }
    // Estas no se tocan, pero conviene saberlo antes de facturar lo que las repite.
    const pendientes = plan.protectedDuplicates.filter((id) => {
      const row = db.prepare("SELECT invoice_id FROM time_entries WHERE id = ?").get(id) as { invoice_id: string | null } | undefined;
      return row?.invoice_id === null;
    });
    if (pendientes.length) {
      console.log(tr`\n${pendientes.length} imputaciones aprobadas o ajustadas repiten horas de otra rama. Revísalas antes de facturar:`);
      for (const id of pendientes.slice(0, 10)) console.log(`  ${id}`);
    }
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
      repoPaths: repo ? [normalizePath(resolve(repo))] : [],
      billable: str(args, "billable") !== "false",
      roundingMinutes: Number(str(args, "rounding") ?? 0),
      aiCostPolicy: (str(args, "ai-cost") ?? "absorbed") as "absorbed" | "passthrough",
      kind: (str(args, "kind") ?? "client") as "client" | "employment" | "internal",
    });
    console.log(tr`Proyecto "${required(args, "name")}" guardado.`);
    if (repo) console.log(tr`  repositorio: ${normalizePath(resolve(repo))}`);
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
 * `estela project tracker` — qué gestor de tareas usa un proyecto, para
 * reconocer sus tickets en ramas y commits. Sin --system enseña el actual.
 *
 * No recalcula nada por sí mismo: `estela import` ya rehace todos los bloques
 * no facturados, y así solo hay un camino que decide los tickets.
 */
function cmdProjectTracker(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);

    const system = str(args, "system");
    if (!system && "client-label" in args.flags) {
      if (!project.tracker) throw new UserError(tr`Primero el gestor: estela project tracker --project ${projectId} --system github`);
      const prefix = clientLabelArg(args);
      const { clientLabel: _, ...rest } = project.tracker;
      store.setProjectTracker(db, projectId, prefix ? { ...rest, clientLabel: prefix } : rest);
      console.log(tr`Las peticiones de clientes de "${project.name}" llevan la etiqueta "${prefix ?? DEFAULT_CLIENT_LABEL}<nombre>".`);
      return;
    }
    if (!system && "plan-label" in args.flags) {
      if (!project.tracker) throw new UserError(tr`Primero el gestor: estela project tracker --project ${projectId} --system github`);
      const label = planLabelArg(args);
      store.setProjectTracker(db, projectId, withPlanLabel(project.tracker, label));
      console.log(label ? tr`Lo planificado de "${project.name}" es lo que lleva la etiqueta "${label}".`
                        : tr`"${project.name}" ya no tiene etiqueta de plan.`);
      return;
    }
    if (!system) {
      console.log(project.tracker
        ? tr`"${project.name}" usa ${project.tracker.system}${project.tracker.prefixes.length ? " (" + project.tracker.prefixes.join(", ") + ")" : ""}.`
        : tr`"${project.name}" no tiene gestor de tareas. Solo se reconocen AB#1234 y claves de Jira en mayúscula en la rama.`);
      return;
    }

    if (system === "none") {
      store.setProjectTracker(db, projectId, null);
      console.log(tr`"${project.name}" ya no tiene gestor de tareas.`);
    } else {
      if (!(TRACKER_SYSTEMS as readonly string[]).includes(system)) {
        throw new UserError(tr`Gestor desconocido: ${system}. Usa jira, azure, github, gitlab o none.`);
      }
      const prefixes = (str(args, "prefix") ?? "").split(",").map((p) => p.trim().toUpperCase()).filter(Boolean);
      if (prefixes.some((p) => !/^[A-Z][A-Z0-9]*$/.test(p))) {
        throw new UserError(tr`Prefijo inválido: tienen que ser letras y números, como PROJ u OPS.`);
      }
      const label = "plan-label" in args.flags ? planLabelArg(args) : project.tracker?.planLabel;
      const clientLabel = "client-label" in args.flags ? clientLabelArg(args) : project.tracker?.clientLabel;
      store.setProjectTracker(db, projectId, withPlanLabel(
        { system: system as TrackerSystem, prefixes, ...(clientLabel ? { clientLabel } : {}) }, label));
      console.log(tr`"${project.name}" usa ${system}${prefixes.length ? " (" + prefixes.join(", ") + ")" : ""}.`);
    }
    console.log(tr`Para aplicarlo a lo ya capturado:  estela import`);
  } finally { db.close(); }
}

/** `--plan-label <etiqueta>`, o `none` para quitarla. */
function planLabelArg(args: Args): string | undefined {
  const label = str(args, "plan-label")?.trim();
  if (!label) throw new UserError(tr`Falta la etiqueta: --plan-label <etiqueta> (o none para quitarla).`);
  return label === "none" ? undefined : label;
}

/** `--client-label <prefijo>`, o `none` para volver al de por defecto. */
function clientLabelArg(args: Args): string | undefined {
  const prefix = str(args, "client-label")?.trim();
  if (!prefix) throw new UserError(tr`Falta el prefijo: --client-label <prefijo> (o none para volver a "cliente:").`);
  return prefix === "none" ? undefined : prefix;
}

/**
 * `estela client alias` — qué cliente de Estela es cada nombre de las
 * etiquetas `cliente:<nombre>`. Sin alias se prueba con el id y el nombre del
 * cliente; si no coincide ninguno, el informe lo enseña sin mapear.
 */
function cmdClientAlias(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const label = str(args, "label");
    if ("remove" in args.flags) {
      if (!label) throw new UserError(tr`Falta --label <nombre>`);
      console.log(store.removeClientAlias(db, label)
        ? tr`"${label}" ya no apunta a ningún cliente.` : tr`"${label}" no tenía alias.`);
      return;
    }
    const clientId = str(args, "client");
    if (!label && !clientId) {
      const aliases = store.listClientAliases(db);
      if (!aliases.length) { console.log(tr`Sin alias. Las etiquetas se comparan con el id y el nombre de cada cliente.`); return; }
      for (const a of aliases) console.log(`  ${a.label.padEnd(24)} → ${store.getClient(db, a.clientId)?.name ?? a.clientId}`);
      return;
    }
    if (!label || !clientId) throw new UserError(tr`Hacen falta --client <id> y --label <nombre>.`);
    const client = store.getClient(db, clientId);
    if (!client) throw new UserError(tr`No existe el cliente "${clientId}".`);
    if (!store.aliasKey(label)) throw new UserError(tr`La etiqueta necesita al menos una letra o un número.`);
    store.setClientAlias(db, label, clientId);
    console.log(tr`La etiqueta "${label}" es ${client.name}.`);
  } finally { db.close(); }
}

function withPlanLabel(tracker: WorkItemTracker, label: string | undefined): WorkItemTracker {
  const { planLabel: _, ...rest } = tracker;
  return label ? { ...rest, planLabel: label } : rest;
}

/**
 * `estela entry link` — pone a mano los tickets de un bloque, cuando la rama
 * no lo decía o lo decía mal. Desde entonces el import no los toca;
 * `--clear` los devuelve a lo que se detecte solo.
 */
function cmdEntryLink(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const entryId = required(args, "entry");
    const row = db.prepare("SELECT project_id FROM time_entries WHERE id = ?").get(entryId) as
      { project_id: string } | undefined;
    if (!row) throw new UserError(tr`No existe el bloque "${entryId}". Los ids salen con: estela entries --project <id> --ids`);

    if (args.flags["clear"] === true) {
      store.setEntryWorkItems(db, entryId, null);
      console.log(tr`Tickets de "${entryId}" devueltos a lo que detecte el import.`);
      return;
    }

    const tracker = store.getProject(db, row.project_id)?.tracker ?? null;
    const raw = required(args, "items").split(",").map((t) => t.trim()).filter(Boolean);
    const keys: string[] = [];
    for (const text of raw) {
      const key = parseWorkItem(text, tracker);
      if (!key) {
        throw new UserError(tr`No sé de qué gestor es "${text}". Escríbelo como PROJ-12, AB#1234, o configura el del proyecto con: estela project tracker`);
      }
      if (!keys.includes(key)) keys.push(key);
    }
    store.setEntryWorkItems(db, entryId, keys);
    console.log(`"${entryId}" → ${keys.map(formatWorkItem).join(", ")}`);
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

    const ids = args.flags["ids"] === true;
    console.log(`${project.name}\n`);
    for (const e of entries) {
      const flag = e.invoiceId ? tr`facturado` : e.billable ? tr`pendiente` : tr`no facturable`;
      const tickets = (e.workItems ?? []).map(formatWorkItem).join(",");
      console.log(
        `${e.startedAt.toISOString().slice(0, 16).replace("T", " ")}  ` +
        `${formatDuration(e.seconds).padStart(8)}  ` +
        `${formatAiCost(e.aiCost).padStart(9)}  ` +
        `${flag.padEnd(14)}  ${tickets ? tickets.padEnd(10) + "  " : ""}${e.description.slice(0, 44)}`);
      if (ids) console.log(`    ${e.id}`);
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
      const panel = await preparePanel(db, {
        projectId,
        ...(token ? { token } : {}),
        ...(str(args, "author") ? { authorName: str(args, "author")! } : {}),
        ...(clientes?.length ? { clients: clientes } : {}),
        withAmounts: args.flags["with-amounts"] === true,
        includeTeam: args.flags["no-team"] !== true,
        hideCredit: args.flags["no-credit"] === true,
        ...(explicitLang(args) ? { language: explicitLang(args)! } : {}),
      });
      // Lo que va a quedar público, antes de subirlo: quien tenga el enlace
      // verá todo esto, y publicar no se deshace solo.
      printPanelSummary(panel.summary);
      if (args.flags["yes"] !== true) {
        if (!process.stdin.isTTY) {
          throw new UserError(tr`No se ha publicado nada. Sin terminal no se puede confirmar: añade --yes para publicar.`);
        }
        if (!await confirm(tr`¿Publicar? [s/N] `)) {
          console.log(tr`\nNo se ha publicado nada.`);
          return;
        }
      }
      result = await uploadPanel(db, panel);
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

/** Hasta `max` elementos de una lista, y cuántos quedan fuera. */
function shortList(items: readonly string[], max = 8): string {
  if (items.length === 0) return "—";
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? tr`${shown} y ${items.length - max} más` : shown;
}

function printPanelSummary(s: PanelSummary): void {
  console.log(tr`\nEsto va a quedar público. Quien tenga el enlace lo ve todo:\n`);
  const row = (label: string, value: string) => console.log(`  ${label.padEnd(14)}${value}`);
  row(tr`Proyecto`, `${s.project} · ${s.client}`);
  row(tr`Trabajo`, tr`${s.days} días, ${s.blocks} bloques, ${s.commitSubjects} mensajes de commit`);
  row(tr`Autores`, shortList(s.authors));
  row(tr`Ramas`, shortList(s.branches));
  row(tr`Ficheros`, shortList(s.files));
  row(tr`Importes`, s.amounts ? tr`sí (--with-amounts)` : tr`no`);
  row(tr`Clientes`, s.clients.length ? tr`${s.clients.join(", ")} (recibirán un correo)` : "—");
  console.log("");
}

/**
 * `estela unpublish <proyecto|token>` y `estela unpublish --all`.
 *
 * Borra el panel del servidor: el enlace deja de funcionar para todos al
 * momento. Sin argumentos, lista lo que tienes publicado.
 */
async function cmdUnpublish(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const target = args._[1] ?? str(args, "project") ?? str(args, "token");
    try {
      if (args.flags["all"] === true) {
        const panels = await listPublishedPanels(db);
        if (panels.length === 0) { console.log(tr`No tienes ningún panel publicado.`); return; }
        for (const p of panels) console.log(`  ${p.projectName}  ·  ${p.token}`);
        if (args.flags["yes"] !== true) {
          if (!process.stdin.isTTY) {
            throw new UserError(tr`No se ha despublicado nada. Sin terminal no se puede confirmar: añade --yes.`);
          }
          if (!await confirm(tr`\n¿Despublicar estos ${panels.length} paneles? Los enlaces dejarán de funcionar. [s/N] `)) {
            console.log(tr`\nNo se ha despublicado nada.`);
            return;
          }
        }
        const gone = await unpublishAll(db);
        console.log(tr`\n${gone.length} paneles despublicados. Sus enlaces ya no funcionan.`);
        return;
      }
      if (!target) {
        const panels = await listPublishedPanels(db);
        if (panels.length === 0) { console.log(tr`No tienes ningún panel publicado.`); return; }
        console.log(tr`Tus paneles publicados:\n`);
        for (const p of panels) console.log(`  ${p.projectId ?? "—"}  ${p.projectName}  ·  ${p.token}`);
        console.log(tr`\nPara despublicar uno: estela unpublish <proyecto o token>. Todos: estela unpublish --all`);
        return;
      }
      const gone = await unpublishPanel(db, target);
      console.log(tr`Panel de ${gone.projectName} despublicado. El enlace ya no funciona.`);
    } catch (error) {
      if (error instanceof NoAccountError) throw new UserError(error.message);
      throw error;
    }
  } finally { db.close(); }
}

/**
 * `estela plan`: ¿el plan de Claude que pagas es el que te conviene?
 *
 * Solo con lo que manda Claude Code a la status line (rate-limits.jsonl) y el
 * multiplicador por sesión que publica Anthropic. Ver metrics/plan.ts.
 */
function cmdPlan(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const declared = store.getClaudePlan(db);
    const json = args.flags["json"] === true;
    if (!declared || !planById(declared.plan)) {
      if (json) console.log(JSON.stringify({ version: 1, plan: null }, null, 2));
      else console.log(renderNoPlan());
      return;
    }
    const days = str(args, "days") === undefined ? 28 : Number(str(args, "days"));
    if (!Number.isInteger(days) || days < 1 || days > KEEP_DAYS) {
      throw new UserError(tr`--days tiene que ser un número entero de 1 a ${KEEP_DAYS}.`);
    }

    const now = new Date();
    const file = historyPath(dbPath);
    try { pruneSamples(file, now); } catch { /* sin rotar se analiza igual */ }
    const all = readSamples(file);
    const analysis = analyzePlan({ samples: all, plan: declared.plan as ClaudePlanId, since: declared.since, now, days });

    // Los 429 que Claude Code dejó en sus transcripts, en el mismo período.
    let blocks: BlockCounts | null = null;
    try {
      const found = scanBlocks(join(homedir(), ".claude", "projects"), blocksCachePath(dbPath), now)
        .filter((b) => b.at >= analysis.from.getTime() && b.at <= now.getTime());
      blocks = { fiveHour: found.filter((b) => b.type === "five_hour").length,
                 sevenDay: found.filter((b) => b.type === "seven_day").length };
    } catch { /* sin transcripts legibles, la línea no sale */ }

    if (json) {
      console.log(JSON.stringify(planToJson(analysis, { blocks, now }), null, 2));
      return;
    }
    const color = args.flags["no-color"] !== true && !process.env["NO_COLOR"] && process.stdout.isTTY === true;
    if (analysis.dataState === "none") {
      // Sin ninguna muestra nunca, y la status line vio entradas sin rate_limits: API key.
      const apiKey = all.length === 0 && loadCache(dbPath).noLimitsAt !== undefined;
      console.log(renderNoData(analysis, apiKey, color));
      return;
    }
    console.log(renderPlanReport(analysis, { color, now, blocks }));
  } finally { db.close(); }
}

/** `estela plan set pro|max5|max20 [--since AAAA-MM-DD]`. */
function cmdPlanSet(args: Args, dbPath: string): void {
  const id = args._[2] ?? "";
  const plan = planById(id);
  if (!plan) throw new UserError(tr`Plan desconocido: "${id}". Usa pro, max5 o max20.`);
  const sinceText = str(args, "since");
  let since = new Date();
  if (sinceText !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceText) || Number.isNaN(new Date(`${sinceText}T00:00:00`).getTime())) {
      throw new UserError(tr`--since tiene que ser una fecha AAAA-MM-DD.`);
    }
    since = new Date(`${sinceText}T00:00:00`);
  }
  const db = openDatabase(dbPath);
  try {
    store.setClaudePlan(db, plan.id, since);
    const d = since;
    const fecha = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    console.log(tr`Plan declarado: ${plan.name}, desde ${fecha}. El análisis solo usa lo guardado desde esa fecha.`);
    if (sinceText === undefined) {
      console.log(tr`Si ya lo tenías antes, indica desde cuándo: estela plan set ${plan.id} --since AAAA-MM-DD`);
    }
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
    console.log(tr`Repositorio vinculado a "${projectId}": ${normalizePath(resolve(repo))}`);
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

async function cmdExport(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const projectId = required(args, "project");
    const project = store.getProject(db, projectId);
    if (!project) throw new UserError(tr`No existe el proyecto "${projectId}".`);
    const client = store.getClient(db, project.clientId)!;
    const rates = store.getRates(db, projectId);

    const format = str(args, "format") ?? "csv";
    if (format !== "csv" && format !== "clockify") {
      throw new UserError(tr`Formato desconocido: ${format}. Usa csv o clockify.`);
    }
    const entries = entriesInRange(store.getTimeEntries(db, projectId), args);
    const lang = docLangOf(args, client);

    let csv: string;
    if (format === "clockify") {
      const account = await requirePaidPlan(db, tr`Exportar a Clockify`);
      const email = str(args, "email") ?? account?.email;
      if (!email) throw new UserError(tr`Falta --email: el correo de tu cuenta de Clockify.`);
      const dateFormat = (str(args, "date-format") ?? "MM/DD/YYYY").toUpperCase() as ClockifyDateFormat;
      if (!CLOCKIFY_DATE_FORMATS.includes(dateFormat)) {
        throw new UserError(tr`--date-format admite ${CLOCKIFY_DATE_FORMATS.join(", ")}.`);
      }
      const timeFormat = str(args, "time-format") ?? "12h";
      if (timeFormat !== "12h" && timeFormat !== "24h") throw new UserError(tr`--time-format admite 12h o 24h.`);
      csv = withLang(lang, () => timeEntriesToClockifyCsv(entries, project, client, { email, dateFormat, timeFormat }));
    } else {
      csv = withLang(lang, () => timeEntriesToCsv(entries, project, client, (at) => rateAt(rates, projectId, at)));
    }

    const out = str(args, "out");
    if (out) {
      writeFileSync(out, csv, "utf8");
      console.log(tr`CSV: ${out}`);
      // Solo si va a un fichero: por la salida estándar el aviso se colaría
      // dentro del propio CSV.
      if (format === "clockify") {
        console.log(tr`  ${entries.length} bloques. En Clockify: Settings → Import → Timesheets.`);
        console.log(tr`  La fecha y la hora tienen que coincidir con el formato de tu perfil de Clockify;`);
        console.log(tr`  si no, repítelo con --date-format DD/MM/YYYY o --time-format 24h.`);
      } else {
        hintDocLang(args, client, lang);
      }
    } else {
      process.stdout.write(csv);
    }
  } finally { db.close(); }
}

/**
 * `--month YYYY-MM`, o `--from`/`--to` en fechas locales. Sin ninguno, todo:
 * es lo que hacía `estela export` antes de tener rango.
 */
function periodOf(args: Args): { from: string | undefined; to: string | undefined } {
  const month = str(args, "month");
  if (month && !/^\d{4}-\d{2}$/.test(month)) throw new UserError(tr`--month va como YYYY-MM.`);
  const from = month ? `${month}-01` : str(args, "from");
  const to = month ? `${month}-31` : str(args, "to");
  for (const d of [from, to]) {
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new UserError(tr`Fecha inválida: ${d}`);
  }
  return { from, to };
}

function entriesInRange(entries: readonly TimeEntry[], args: Args): TimeEntry[] {
  const { from, to } = periodOf(args);
  return entries.filter((e) => {
    const day = localDate(e.startedAt);
    return (!from || day >= from) && (!to || day <= to);
  });
}

/**
 * Lo de Pro, comprobado contra la cuenta y no contra lo guardado aquí: el plan
 * local se anota "free" al hacer login y nadie lo actualiza después de pagar.
 * Sin conexión se deja pasar — mejor regalar un export que bloquear a quien
 * paga porque está en un avión — y se aprovecha la respuesta para dejar el
 * plan local al día.
 */
async function requirePaidPlan(db: ReturnType<typeof openDatabase>, what: string) {
  const account = store.getCloudAccount(db);
  if (!account) {
    throw new UserError(tr`${what} es de Pro. Vincula tu cuenta con: estela login --email tu@correo.com`);
  }
  try {
    const info = await cloudGet<{ plan: string }>(account.apiBaseUrl, "/account", { deviceToken: account.deviceToken });
    store.setCloudAccount(db, { ...account, plan: info.plan as CloudAccount["plan"] });
    if (info.plan === "free") {
      throw new UserError(tr`${what} es de Pro. Actualiza con: estela upgrade --plan pro`);
    }
  } catch (error) {
    if (error instanceof CloudError && error.status === 401) {
      throw new UserError(tr`Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n  estela login --email tu@correo.com\n`);
    }
    if (!(error instanceof CloudError) || error.status !== undefined) throw error;
    // Sin conexión: se deja pasar.
  }
  return account;
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
async function cmdAiCost(args: Args, dbPath: string): Promise<void> {
  if ("by" in args.flags && "undelivered" in args.flags) {
    throw new UserError(tr`--by y --undelivered van por separado: son dos informes distintos.`);
  }
  if ("by" in args.flags) { cmdAiCostBy(args, dbPath); return; }
  if ("undelivered" in args.flags) { await cmdAiCostUndelivered(args, dbPath); return; }
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

/**
 * `estela ai-cost --by branch|item` — el coste de IA de cada entrega.
 *
 * Lee las imputaciones ya guardadas (ver metrics/spend.ts): no recalcula nada
 * ni toca días aprobados o facturados.
 */
function cmdAiCostBy(args: Args, dbPath: string): void {
  const raw = args.flags["by"];
  if (raw !== "branch" && raw !== "item") throw new UserError(tr`--by va como branch o item.`);
  const by: SpendBy = raw;

  const db = openDatabase(dbPath);
  try {
    const projects = selectedProjects(db, args);

    const entries = entriesInRange(projects.flatMap((p) => store.getTimeEntries(db, p.id)), args);
    const subscriptions = store.listSubscriptions(db);
    const monthTotals = shareDenominators(db);
    const reports = spendByUnit({ entries, projects, merges: store.listMerges(db), subscriptions, monthTotals }, by);

    const csvOut = str(args, "csv");
    if ("csv" in args.flags && !csvOut) throw new UserError(tr`Falta el fichero: --csv <fichero.csv>`);
    if (csvOut) {
      writeFileSync(csvOut, spendToCsv(reports, by), "utf8");
      console.log(tr`CSV guardado en ${csvOut}`);
      return;
    }
    if ("json" in args.flags) {
      console.log(JSON.stringify(spendJson(reports, by, args), null, 2));
      return;
    }
    printSpend(reports, by, args, subscriptions.length > 0);
  } finally { db.close(); }
}

/**
 * El denominador de la cuota por mes, como en ai-cost: todo el consumo de los
 * turnos guardados, y nunca menos que lo imputado a todos los proyectos (no
 * solo a los filtrados).
 */
function shareDenominators(db: ReturnType<typeof openDatabase>): Map<string, { microUsd: number }> {
  const monthTotals = store.totalConsumptionByMonth(db);
  const assigned = new Map<string, number>();
  for (const row of store.consumptionByProjectMonth(db)) {
    assigned.set(row.month, (assigned.get(row.month) ?? 0) + row.consumption.microUsd);
  }
  for (const [month, micro] of assigned) {
    if (micro > (monthTotals.get(month)?.microUsd ?? 0)) monthTotals.set(month, { microUsd: micro });
  }
  return monthTotals;
}

/**
 * `estela delivery` — planificado frente a entregado en un periodo, con el
 * coste de IA de cada parte. Ver delivery/report.ts.
 *
 * La única llamada fuera de esta máquina de todo Estela sin cuenta: `gh` o
 * `glab`, y solo en un proyecto con GitHub o GitLab como gestor. Sin ellos, o con
 * --offline, se usa lo leído la última vez; si nunca se leyó, lo entregado
 * según git.
 */
async function cmdDelivery(args: Args, dbPath: string): Promise<void> {
  const by = str(args, "by");
  if ("by" in args.flags && by !== "client") throw new UserError(tr`--by en delivery solo admite client.`);
  const db = openDatabase(dbPath);
  try {
    const projectId = await projectFromArgsOrCwd(args, db);
    const project = store.getProject(db, projectId)!;
    const client = store.getClient(db, project.clientId);
    const { from, to } = deliveryPeriod(args);
    const title = `${project.name}${client ? ` · ${client.name}` : ""}`;
    if (by === "client") { await deliveryByClient(db, args, project, title, from, to); return; }

    const label = str(args, "label");
    const milestone = str(args, "milestone");
    if (label && milestone) throw new UserError(tr`--label y --milestone van por separado: elige una forma de marcar el plan.`);
    const configured = project.tracker?.planLabel;
    const plan: PlanFilter | null = label ? { label } : milestone ? { milestone } : configured ? { label: configured } : null;

    const { items, origin, notes, fromGit } = await loadTrackerItems(db, project, args, { from, to, plan });
    const report = deliveryReport({
      items, plan: fromGit ? null : plan, from, to,
      entries: store.getTimeEntries(db, projectId), merges: store.listMerges(db),
      subscriptions: store.listSubscriptions(db), monthTotals: shareDenominators(db),
    });
    if (!fromGit && !plan) {
      notes.push(tr`Sin etiqueta ni milestone de plan solo se enseña lo entregado. Indícalo con --label o --milestone,`);
      notes.push(tr`o déjalo fijo: estela project tracker --project ${projectId} --plan-label <etiqueta>`);
    }

    if ("json" in args.flags) {
      console.log(JSON.stringify(deliveryJson(report, { projectId, from, to, plan: fromGit ? null : plan, origin, notes }), null, 2));
      return;
    }
    printDelivery(report, {
      title, from, to, plan: fromGit ? null : plan, origin, notes, hasSubs: store.listSubscriptions(db).length > 0,
    });
  } finally { db.close(); }
}

/**
 * Las issues y los PRs de un proyecto: de GitHub con gh o de GitLab con glab si se puede; si no, lo
 * guardado la última vez; y si nunca se leyó, lo entregado según git.
 */
async function loadTrackerItems(
  db: ReturnType<typeof openDatabase>, project: Project, args: Args, query: FetchQuery,
): Promise<{ items: TrackerItem[]; origin: string; notes: string[]; fromGit: boolean }> {
  const notes: string[] = [];
  let items: TrackerItem[] | null = null;
  let origin = "";
  const repo = project.repoPaths.find((p) => existsSync(p));
  const system = project.tracker?.system;
  const remote = system === "github" || system === "gitlab" ? system : null;
  const name = remote === "gitlab" ? "GitLab" : "GitHub";
  const cli = remote === "gitlab" ? "glab" : "gh";

  if (!remote) {
    notes.push(tr`Este proyecto no tiene GitHub ni GitLab como gestor, así que no se lee el plan. Para leerlo:`);
    notes.push(tr`  estela project tracker --project ${project.id} --system github|gitlab --plan-label <etiqueta>`);
  } else if (!repo) {
    notes.push(tr`La carpeta del repo de este proyecto ya no existe: ${cli} no tiene dónde mirar.`);
  } else if ("offline" in args.flags) {
    notes.push(tr`--offline: no se consulta ${name}.`);
  } else {
    const source: PlanSource = remote === "gitlab" ? new GitLabPlanSource(repo) : new GitHubPlanSource(repo);
    const available = await source.availability();
    if (available.ok) {
      items = await source.fetch(query);
      store.saveTrackerItems(db, project.id, items);
      origin = tr`${name} (${cli}), leído ahora`;
    } else {
      notes.push(unavailableText(available, remote));
    }
  }

  if (!items && remote) {
    const cached = store.listTrackerItems(db, project.id);
    if (cached.items.length && cached.fetchedAt) {
      items = cached.items;
      origin = tr`${name}, lo guardado el ${localDate(cached.fetchedAt)} (sin conexión)`;
    }
  }
  if (items) return { items, origin, notes, fromGit: false };
  return { items: deliveredFromGit(db, project.repoPaths), notes, fromGit: true,
           origin: tr`git: los PR de los commits de merge y de los squash con (#N)` };
}

/**
 * `estela summary` — el informe para finanzas: gasto, clientes, entregas y lo
 * que no llegó a entregarse, en Markdown, CSV o JSON. Ver export/finance.ts.
 *
 * No llama a nada fuera de la máquina: de GitHub o GitLab usa lo que ya leyó
 * `estela delivery`, y si no hay nada, lo que dice git.
 */
async function cmdSummary(args: Args, dbPath: string): Promise<void> {
  const out = str(args, "out");
  const format = str(args, "format") ?? (out?.endsWith(".csv") ? "csv" : out?.endsWith(".json") ? "json" : "md");
  if (!["md", "csv", "json"].includes(format)) throw new UserError(tr`--format va como md, csv o json.`);
  const rawDays = str(args, "stale-days");
  const staleDays = rawDays === undefined ? 14 : Number(rawDays);
  if (!Number.isInteger(staleDays) || staleDays < 1) throw new UserError(tr`--stale-days va como un número entero de días, 1 o más.`);

  const db = openDatabase(dbPath);
  try {
    const { from, to } = summaryPeriod(args);
    const projects = selectedProjects(db, args);
    const filtered = "project" in args.flags || "client" in args.flags;
    const subs = store.listSubscriptions(db);
    const inPeriod = (d: Date) => { const day = localDate(d); return day >= from && day <= to; };
    // Aquí los meses son los de tu reloj, no los de UTC: un mes cerrado tiene que
    // sumar su cuota exacta, y la tarde del día 31 en América ya es el mes
    // siguiente en UTC. Los denominadores, igual: todo el consumo de cada mes
    // local, y nunca menos que lo imputado a todos los proyectos.
    const month = (d: Date) => localDate(d).slice(0, 7);
    const denominators = new Map<string, { microUsd: number }>();
    for (const t of store.turnsBetween(db, new Date(0), new Date("9999-12-31T00:00:00Z"))) {
      const m = month(t.at);
      denominators.set(m, { microUsd: (denominators.get(m)?.microUsd ?? 0) + (costOfTurn(t.tokens, t.model, t.at)?.microUsd ?? 0) });
    }
    const imputed = new Map<string, number>();
    for (const p of [...store.listProjects(db), ...store.listArchivedProjects(db)]) {
      for (const e of store.getTimeEntries(db, p.id)) imputed.set(month(e.startedAt), (imputed.get(month(e.startedAt)) ?? 0) + e.aiCost.microUsd);
    }
    for (const [m, micro] of imputed) if (micro > (denominators.get(m)?.microUsd ?? 0)) denominators.set(m, { microUsd: micro });
    const costOf = (entries: readonly TimeEntry[]): Cost => {
      const byMonth = new Map<string, number>();
      for (const e of entries) byMonth.set(month(e.startedAt), (byMonth.get(month(e.startedAt)) ?? 0) + e.aiCost.microUsd);
      const { real, partial } = realFromMonths(byMonth, subs, (m) => denominators.get(m)?.microUsd ?? 0);
      return { seconds: entries.reduce((n, e) => n + e.seconds, 0),
               consumption: { microUsd: entries.reduce((n, e) => n + e.aiCost.microUsd, 0) }, real, realPartial: partial };
    };
    const zero: Cost = { seconds: 0, consumption: { microUsd: 0 }, real: null, realPartial: false };

    // Por cliente y proyecto.
    const entriesOf = new Map(projects.map((p) => [p.id, store.getTimeEntries(db, p.id).filter((e) => inPeriod(e.startedAt))]));
    const clients = new Map<string, { name: string; projects: { id: string; name: string; cost: Cost }[] }>();
    for (const p of projects) {
      const entries = entriesOf.get(p.id)!;
      if (!entries.length) continue;
      const c = clients.get(p.clientId) ?? { name: p.clientName, projects: [] };
      c.projects.push({ id: p.id, name: p.name, cost: costOf(entries) });
      clients.set(p.clientId, c);
    }
    const financeClients: FinanceClient[] = [...clients].map(([id, c]) => ({
      id, name: c.name, projects: c.projects, cost: c.projects.reduce((acc, p) => sum(acc, p.cost), zero),
    })).sort((a, b) => b.cost.consumption.microUsd - a.cost.consumption.microUsd);
    const assigned = financeClients.reduce((acc, c) => sum(acc, c.cost), zero);

    // Lo pagado en todo el periodo, con o sin proyecto: la cuota repartida
    // sobre todo el consumo de los turnos. Con --project o --client, solo eso.
    let paid = assigned;
    let unassigned = zero;
    let unpriced = false;
    if (!filtered) {
      const byMonth = new Map<string, number>();
      let micro = 0;
      // Un día de margen a cada lado: el filtro de verdad es por fecha local.
      const desde = new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS);
      const hasta = new Date(Date.parse(`${to}T00:00:00Z`) + 2 * DAY_MS);
      for (const t of store.turnsBetween(db, desde, hasta)) {
        if (!inPeriod(t.at)) continue;
        if (t.agent === "copilot") unpriced = true;
        const c = costOfTurn(t.tokens, t.model, t.at)?.microUsd ?? 0;
        micro += c;
        byMonth.set(month(t.at), (byMonth.get(month(t.at)) ?? 0) + c);
      }
      const { real, partial } = realFromMonths(byMonth, subs, (m) => denominators.get(m)?.microUsd ?? 0);
      // Nunca por debajo de lo imputado: las imputaciones de días cerrados conservan su cifra.
      const machine: Cost = { seconds: assigned.seconds, consumption: { microUsd: Math.max(micro, assigned.consumption.microUsd) },
        real: real && assigned.real && real.amount < assigned.real.amount ? assigned.real : real ?? assigned.real, realPartial: partial };
      paid = machine;
      unassigned = {
        seconds: 0, consumption: { microUsd: Math.max(0, machine.consumption.microUsd - assigned.consumption.microUsd) },
        real: machine.real ? { amount: Math.max(0, machine.real.amount - (assigned.real?.amount ?? 0)), currency: machine.real.currency } : null,
        realPartial: machine.realPartial,
      };
    }
    for (const p of projects) if ((entriesOf.get(p.id) ?? []).some((e) => e.agents.includes("copilot"))) unpriced = true;

    // Entregas y peticiones de clientes: lo guardado de GitHub o GitLab, o lo que dice git.
    const deliveries: FinanceDeliveries[] = [];
    const merges = store.listMerges(db);
    for (const p of projects) {
      const project = store.getProject(db, p.id)!;
      const cached = store.listTrackerItems(db, p.id);
      // Lo guardado es de un gestor u otro según sus claves (github:12, gitlab:12).
      const fromGitHub = cached.items.length > 0;
      const tracker = cached.items[0]?.key.startsWith("gitlab:") ? "gitlab" as const : "github" as const;
      const items = fromGitHub ? cached.items : deliveredFromGit(db, project.repoPaths);
      const planLabel = fromGitHub ? project.tracker?.planLabel : undefined;
      const report = deliveryReport({ items, plan: planLabel ? { label: planLabel } : null, from, to,
        entries: store.getTimeEntries(db, p.id), merges, subscriptions: subs, monthTotals: denominators });
      const lines = [...(report.planned?.delivered.lines ?? []), ...report.unplanned.lines];
      let requests: FinanceDeliveries["requests"] = null;
      let requestsRest: Cost | null = null;
      if (fromGitHub) {
        const r = clientRequests({ items, entries: entriesOf.get(p.id) ?? [], merges,
          prefix: project.tracker?.clientLabel ?? DEFAULT_CLIENT_LABEL,
          requesterOf: (name) => {
            const clientId = store.clientForLabel(db, name);
            return { id: clientId ?? `?${store.aliasKey(name)}`, clientId, name: (clientId && store.getClient(db, clientId)?.name) || name };
          },
          subscriptions: subs, monthTotals: denominators });
        if (r.groups.length) {
          requests = r.groups.map((g) => ({ name: g.requesters.map((x) => x.name).join(" + "),
                                            mapped: g.requesters.every((x) => x.clientId !== null), cost: g }));
          requestsRest = r.rest;
        }
      }
      if (!lines.length && !report.planned) continue;
      deliveries.push({
        projectName: p.name, clientName: p.clientName, source: fromGitHub ? tracker : "git",
        fetchedAt: cached.fetchedAt, delivered: lines.map((l) => ({ label: itemLabel(l.item), cost: l })),
        plan: report.planned && planLabel ? {
          label: planLabel, delivered: report.planned.delivered.lines.length,
          total: report.planned.delivered.lines.length + report.planned.pending.lines.length,
          pending: report.planned.pending, unplanned: report.unplanned,
        } : null,
        requests, requestsRest,
      });
    }

    // Lo que no llegó a entregarse.
    const undelivered: FinanceUndelivered[] = (await collectUndelivered(db, projects, staleDays, from, to))
      .filter((r) => r.total.consumption.microUsd > 0)
      .map((r) => {
        // La proporción sale de las sesiones; el dinero, del gasto del proyecto
        // en este mismo informe, para que las dos tablas cuadren entre sí.
        const project = financeClients.flatMap((c) => c.projects).find((p) => p.id === r.projectId)?.cost;
        const asCost = (x: Spend): Cost => {
          const ratio = r.total.consumption.microUsd ? x.consumption.microUsd / r.total.consumption.microUsd : 0;
          const real = project?.real ? { amount: Math.round(project.real.amount * ratio), currency: project.real.currency } : x.real;
          return { seconds: 0, consumption: x.consumption, real, realPartial: project?.realPartial ?? x.realPartial };
        };
        return { projectName: projects.find((p) => p.id === r.projectId)?.name ?? r.projectId,
                 total: asCost(r.total), undelivered: asCost(r.undelivered), withoutCommit: asCost(r.sessionsWithoutCommit),
                 unmergedBranches: asCost(r.unmerged), unmergedCount: r.unmerged.branches.length };
      });

    const summary: FinanceSummary = {
      from, to, currency: subs[0]?.monthlyFee.currency ?? null, paid, unassigned,
      clients: financeClients, deliveries, undelivered, staleDays, unpricedAgents: unpriced,
    };
    const text = format === "csv" ? financeToCsv(summary)
      : format === "json" ? JSON.stringify(financeToJson(summary), null, 2) + "\n"
      : financeToMarkdown(summary);
    if (out) {
      writeFileSync(out, text, "utf8");
      console.log(tr`Informe guardado en ${out}`);
    } else {
      process.stdout.write(text);
    }
  } finally { db.close(); }
}

const DAY_MS = 86_400_000;

/** El periodo del informe: --month, --from/--to, o el último mes cerrado. */
function summaryPeriod(args: Args): { from: string; to: string } {
  const { from, to } = periodOf(args);
  if (from && to) return { from, to };
  if (from) return { from, to: localDate(new Date()) };
  if (to) throw new UserError(tr`Con --to hace falta --from.`);
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 15);
  const month = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
  const last = new Date(prev.getFullYear(), prev.getMonth() + 1, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Sin configurar, las etiquetas de cliente son `cliente:<nombre>`. */
const DEFAULT_CLIENT_LABEL = "cliente:";

/**
 * `estela delivery --by client` — el gasto de IA del periodo en peticiones de
 * cada cliente frente al resto. Ver delivery/clients.ts.
 */
async function deliveryByClient(
  db: ReturnType<typeof openDatabase>, args: Args, project: Project, title: string, from: string, to: string,
): Promise<void> {
  const prefix = project.tracker?.clientLabel ?? DEFAULT_CLIENT_LABEL;
  const { items, origin, notes, fromGit } = await loadTrackerItems(db, project, args,
    { from, to, plan: null, clientLabelPrefix: prefix });
  if (fromGit) notes.push(tr`Sin GitHub ni GitLab no hay etiquetas: no se sabe qué pidió cada cliente, y todo va al resto.`);

  const requesterOf = (name: string): Requester => {
    const clientId = store.clientForLabel(db, name);
    const c = clientId ? store.getClient(db, clientId) : null;
    return { id: clientId ?? `?${store.aliasKey(name)}`, clientId, name: c?.name ?? name };
  };
  const report = clientRequests({
    items: fromGit ? [] : items,
    entries: store.getTimeEntries(db, project.id).filter((e) => {
      const day = localDate(e.startedAt);
      return day >= from && day <= to;
    }),
    merges: store.listMerges(db), prefix, requesterOf,
    subscriptions: store.listSubscriptions(db), monthTotals: shareDenominators(db),
  });

  if ("json" in args.flags) {
    const cost = (c: Cost) => ({ seconds: c.seconds, apiMicroUsd: c.consumption.microUsd,
      real: c.real ? { amountMinor: c.real.amount, currency: c.real.currency } : null, realPartial: c.realPartial,
      percentOfSpend: report.total.consumption.microUsd ? (c.consumption.microUsd / report.total.consumption.microUsd) * 100 : null });
    console.log(JSON.stringify({
      project: project.id, period: { from, to }, labelPrefix: prefix, source: origin, notes,
      requests: report.groups.map((g) => ({
        requesters: g.requesters.map((r) => ({ clientId: r.clientId, name: r.name, mapped: r.clientId !== null })),
        items: g.items.map((i) => ({ key: i.key, kind: i.kind, number: i.number, title: i.title, state: i.state })),
        ...cost(g),
      })),
      rest: cost(report.rest), total: cost(report.total),
    }, null, 2));
    return;
  }

  console.log(tr`Peticiones de clientes · ${title} · ${from} → ${to}`);
  console.log(tr`Etiqueta: "${prefix}<nombre>" · Fuente: ${origin}`);
  console.log(tr`Estela no conoce ingresos ni contratos: esto solo une el gasto de IA con quién pidió el trabajo.`);
  for (const n of notes) console.log(n);

  const hasSubs = store.listSubscriptions(db).length > 0;
  const pct = (c: Cost) => report.total.consumption.microUsd === 0 ? "—"
    : `${((c.consumption.microUsd / report.total.consumption.microUsd) * 100).toFixed(1)} %`;
  const row = (label: string, c: Cost) =>
    `  ${label.slice(0, 44).padEnd(46)}${(c.seconds ? formatDuration(c.seconds) : "—").padStart(9)}` +
    `${formatAiCost(c.consumption).padStart(11)}` +
    `${(hasSubs ? (c.real ? formatMoney(c.real) : "—") + (c.realPartial ? "†" : "") : "—").padStart(12)}${pct(c).padStart(10)}`;
  const who = (r: Requester) => (r.clientId ? r.name : tr`"${r.name}" (sin mapear)`);

  console.log(`\n  ${"".padEnd(46)}${tr`Horas`.padStart(9)}${tr`API`.padStart(11)}${tr`Real`.padStart(12)}${tr`% gasto`.padStart(10)}`);
  for (const g of report.groups) {
    const label = g.requesters.length === 1 ? who(g.requesters[0]!) : tr`Varios: ${g.requesters.map(who).join(" + ")}`;
    console.log(row(label, g));
    const shown = g.items.slice(0, 5).map(itemLabel);
    console.log(`      ${shown.join(" · ")}${g.items.length > 5 ? tr` · y ${g.items.length - 5} más` : ""}`);
  }
  if (report.groups.length === 0) console.log(tr`  (ninguna petición de cliente con horas en el periodo)`);
  console.log(row(tr`Resto (sin petición de cliente)`, report.rest));
  console.log(row(tr`Total del periodo`, report.total));

  const unmapped = [...new Set(report.groups.flatMap((g) => g.requesters).filter((r) => !r.clientId).map((r) => r.name))];
  console.log(tr`\nUna hora cuenta para quien pidió la issue o el PR al que se une (rama del PR, su número en ramas, commits o a mano).`);
  console.log(tr`Si sirvió a peticiones de varios clientes va a "Varios", sin repartirla. Un PR hereda las etiquetas de las issues que cierra.`);
  for (const name of unmapped) {
    console.log(tr`Para unir "${name}" con un cliente de Estela: estela client alias --client <id> --label "${name}"`);
  }
}

/** El periodo de delivery: --month, --from/--to, o el mes en curso. */
function deliveryPeriod(args: Args): { from: string; to: string } {
  const { from, to } = periodOf(args);
  const today = localDate(new Date());
  if (from && to) return { from, to };
  if (from) return { from, to: today };
  if (to) throw new UserError(tr`Con --to hace falta --from.`);
  return { from: `${today.slice(0, 7)}-01`, to: `${today.slice(0, 7)}-31` };
}

function unavailableText(a: Exclude<Availability, { ok: true }>, system: "github" | "gitlab"): string {
  if (system === "gitlab") {
    switch (a.reason) {
      case "missing": return tr`glab no está instalado: sin él no se puede leer el plan de GitLab. Instálalo desde https://gitlab.com/gitlab-org/cli y ejecuta: glab auth login`;
      case "auth": return tr`glab no tiene sesión iniciada. Ejecuta: glab auth login`;
      case "repo": return tr`glab no reconoce un proyecto de GitLab en la carpeta del proyecto (${a.detail}).`;
    }
  }
  switch (a.reason) {
    case "missing": return tr`gh no está instalado: sin él no se puede leer el plan de GitHub. Instálalo desde https://cli.github.com y ejecuta: gh auth login`;
    case "auth": return tr`gh no tiene sesión iniciada. Ejecuta: gh auth login`;
    case "repo": return tr`gh no reconoce un repo de GitHub en la carpeta del proyecto (${a.detail}).`;
  }
}

/**
 * Lo entregado que se sabe sin GitHub ni GitLab: los PR y las MR fusionados
 * con merge (su mensaje dice el número y la rama) y los squash de GitHub con
 * "(#N)" al final. No hay plan: eso solo lo sabe el gestor.
 */
function deliveredFromGit(db: ReturnType<typeof openDatabase>, repoPaths: readonly string[]): TrackerItem[] {
  const inProject = (path: string) => repoPaths.some((r) => isSameOrInside(path, r) || isSameOrInside(r, path));
  const items = new Map<string, TrackerItem>();
  const pr = (key: string, title: string, at: Date, branch: string | null): TrackerItem => ({
    key, kind: "pr", number: Number(key.split(":")[1]!.replace("!", "")), title, state: "merged", completed: true,
    closedAt: at, branch, closes: [], labels: [], milestone: null, url: "",
  });
  for (const m of store.listMerges(db)) {
    // El mensaje del merge solo repite el número: la rama dice más.
    if (m.ref && /^(github|gitlab):/.test(m.ref) && inProject(m.repoPath)) {
      items.set(m.ref, pr(m.ref, m.sourceBranch ?? m.subject, m.at, m.sourceBranch));
    }
  }
  const rows = db.prepare("SELECT repo_path, subject, at FROM commits").all() as { repo_path: string; subject: string; at: string }[];
  for (const r of rows) {
    const squash = /\(#(\d+)\)\s*$/.exec(r.subject);
    if (!squash || !inProject(r.repo_path)) continue;
    const key = `github:${squash[1]}`;
    if (!items.has(key)) items.set(key, pr(key, r.subject.replace(/\s*\(#\d+\)\s*$/, ""), new Date(r.at), null));
  }
  return [...items.values()];
}

interface DeliveryView {
  readonly title: string;
  readonly from: string;
  readonly to: string;
  readonly plan: PlanFilter | null;
  readonly origin: string;
  readonly notes: readonly string[];
  readonly hasSubs: boolean;
}

function planText(plan: PlanFilter | null): string {
  if (!plan) return tr`sin plan`;
  return plan.label ? tr`etiqueta "${plan.label}"` : tr`milestone "${plan.milestone}"`;
}

function itemLabel(i: TrackerItem): string {
  return `${i.kind === "pr" ? prLabel(i) : `#${i.number}`} ${i.title}`;
}

/** Una clave de merge: `PR #10` en GitHub, `MR !10` en GitLab. */
function refLabel(key: string): string {
  return key.startsWith("gitlab:!") ? tr`MR ${formatWorkItem(key)}` : tr`PR ${formatWorkItem(key)}`;
}

/** `PR #10` en GitHub, `MR !10` en GitLab. */
function prLabel(i: TrackerItem): string {
  return i.key.startsWith("gitlab:") ? tr`MR !${i.number}` : tr`PR #${i.number}`;
}

function printDelivery(r: DeliveryReport, v: DeliveryView): void {
  console.log(tr`Planificado frente a entregado · ${v.title} · ${v.from} → ${v.to}`);
  console.log(tr`Plan: ${planText(v.plan)} · Fuente: ${v.origin}`);
  for (const n of v.notes) console.log(n);

  const money = (c: { real: Money | null; realPartial: boolean }) =>
    v.hasSubs ? (c.real ? formatMoney(c.real) : "—") + (c.realPartial ? "†" : "") : "—";
  const row = (label: string, c: DeliveryBlock | DeliveryLine) =>
    `  ${label.slice(0, 46).padEnd(48)}${(c.seconds ? formatDuration(c.seconds) : "—").padStart(9)}` +
    `${formatAiCost(c.consumption).padStart(11)}${money(c).padStart(12)}`;
  const block = (title: string, b: DeliveryBlock) => {
    console.log(`\n${title}`);
    if (b.lines.length === 0) { console.log(tr`  (nada)`); return; }
    console.log(`  ${"".padEnd(48)}${tr`Horas`.padStart(9)}${tr`API`.padStart(11)}${tr`Real`.padStart(12)}`);
    for (const l of b.lines) {
      console.log(row(itemLabel(l.item), l));
      const detail: string[] = [];
      const when = l.item.closedAt ? localDate(l.item.closedAt) : null;
      if (l.item.kind === "pr") {
        if (l.item.state === "merged" && when) detail.push(tr`fusionado ${when}`);
        else detail.push(l.item.state === "open" ? tr`abierto` : tr`cerrado sin fusionar`);
      } else if (l.deliveredBy.length) {
        detail.push(tr`entregada por ${l.deliveredBy.map(prLabel).join(", ")}`);
      } else if (l.item.completed && when) {
        detail.push(tr`cerrada ${when}`);
      } else {
        detail.push(l.item.state === "open" ? tr`abierta` : tr`cerrada sin hacer`);
      }
      detail.push(l.basis.length
        ? tr`coste según: ${l.basis.map((x) => (x === "branch" ? tr`rama del PR` : tr`número en rama o commit`)).join(", ")}`
        : tr`sin horas unidas`);
      console.log(`      ${detail.join(" · ")}`);
    }
    if (b.lines.length > 1) console.log(row(tr`Total del bloque`, b));
  };

  if (r.planned) {
    const total = r.planned.delivered.lines.length + r.planned.pending.lines.length;
    block(tr`Planificado y entregado (${r.planned.delivered.lines.length} de ${total})`, r.planned.delivered);
    block(tr`Planificado sin entregar (${r.planned.pending.lines.length})`, r.planned.pending);
  }
  block(r.planned ? tr`Entregado sin planificar (${r.unplanned.lines.length})` : tr`Entregado (${r.unplanned.lines.length})`, r.unplanned);

  console.log(tr`\nEl coste de cada línea es el de las horas unidas a ella: la rama del PR y su número en ramas, commits o a mano.`);
  console.log(tr`Incluye lo trabajado antes del periodo para esa entrega. Si una hora se une a dos líneas, el total del bloque la cuenta una vez.`);
  console.log(tr`API es lo que costaría a precio de API: mide el uso, no es dinero pagado. Real es tu cuota repartida por consumo.`);
}

function deliveryJson(r: DeliveryReport, meta: { projectId: string; from: string; to: string; plan: PlanFilter | null;
                                                  origin: string; notes: readonly string[] }) {
  const cost = (c: DeliveryBlock | DeliveryLine) => ({
    seconds: c.seconds, apiMicroUsd: c.consumption.microUsd,
    real: c.real ? { amountMinor: c.real.amount, currency: c.real.currency } : null, realPartial: c.realPartial,
  });
  const block = (b: DeliveryBlock) => ({
    ...cost(b),
    items: b.lines.map((l) => ({
      key: l.item.key, kind: l.item.kind, number: l.item.number, title: l.item.title, state: l.item.state,
      completed: l.item.completed, closedAt: l.item.closedAt?.toISOString() ?? null, url: l.item.url || null,
      deliveredBy: l.deliveredBy.map((p) => p.key), basis: l.basis, ...cost(l),
    })),
  });
  return {
    project: meta.projectId, period: { from: meta.from, to: meta.to }, plan: meta.plan, source: meta.origin, notes: meta.notes,
    planned: r.planned ? { delivered: block(r.planned.delivered), pending: block(r.planned.pending) } : null,
    unplanned: block(r.unplanned),
  };
}

/** Los proyectos de --project y --client; sin ellos, todos. */
function selectedProjects(db: ReturnType<typeof openDatabase>, args: Args): SpendProject[] {
  const projectId = str(args, "project");
  const clientId = str(args, "client");
  if (projectId && !store.getProject(db, projectId)) throw new UserError(tr`No existe el proyecto "${projectId}".`);
  if (clientId && !store.getClient(db, clientId)) throw new UserError(tr`No existe el cliente "${clientId}".`);

  // También los archivados: su gasto ocurrió, y `ai-cost` tampoco los quita.
  return [...store.listProjects(db), ...store.listArchivedProjects(db)]
    .filter((p) => (!projectId || p.id === projectId) && (!clientId || p.clientId === clientId))
    .map((p) => ({
      id: p.id, name: p.name, clientId: p.clientId,
      clientName: store.getClient(db, p.clientId)?.name ?? p.clientId,
      repoPaths: p.repoPaths, tracker: p.tracker ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * `estela ai-cost --undelivered` — el gasto que no ha llegado a la rama
 * principal: sesiones sin commit y ramas sin fusionar. Ver metrics/undelivered.ts.
 */
async function cmdAiCostUndelivered(args: Args, dbPath: string): Promise<void> {
  const rawDays = str(args, "stale-days");
  const staleDays = rawDays === undefined ? 14 : Number(rawDays);
  if ("stale-days" in args.flags && (!Number.isInteger(staleDays) || staleDays < 1)) {
    throw new UserError(tr`--stale-days va como un número entero de días, 1 o más.`);
  }

  const db = openDatabase(dbPath);
  try {
    const projects = selectedProjects(db, args);
    const wanted = new Set(projects.map((p) => p.id));
    const { from, to } = periodOf(args);

    const reports = await collectUndelivered(db, projects, staleDays, from, to);
    const names = new Map(projects.map((p) => [p.id, p]));

    const csvOut = str(args, "csv");
    if ("csv" in args.flags && !csvOut) throw new UserError(tr`Falta el fichero: --csv <fichero.csv>`);
    if (csvOut) {
      writeFileSync(csvOut, undeliveredToCsv(reports, names), "utf8");
      console.log(tr`CSV guardado en ${csvOut}`);
      return;
    }
    if ("json" in args.flags) {
      console.log(JSON.stringify(undeliveredJson(reports, names, staleDays, args), null, 2));
      return;
    }
    printUndelivered(reports, names, staleDays, args);
  } finally { db.close(); }
}

/**
 * Los datos del gasto sin entrega de esos proyectos: sus turnos, tus commits y
 * el estado de cada rama en git. Lo usan --undelivered y el informe para
 * finanzas. Solo lee git en local: nada sale de la máquina.
 */
async function collectUndelivered(
  db: ReturnType<typeof openDatabase>, projects: readonly SpendProject[], staleDays: number,
  from: string | undefined, to: string | undefined,
): Promise<UndeliveredReport[]> {
  const wanted = new Set(projects.map((p) => p.id));
  // El proyecto de cada turno, por el mismo camino que el import: la carpeta
  // tal cual y, si no, su raíz git (worktrees y subcarpetas). Con los
  // archivados: su gasto ocurrió aunque ya no capten horas.
  const roots = new Map<string, string>();
  const rootOf = (path: string) => {
    let root = roots.get(path);
    if (root === undefined) {
      root = gitRoot(path) ?? normalizePath(path);
      // La ruta tal como está en el disco: en macOS y Windows "MiApp" y
      // "miapp" son la misma carpeta, y los turnos y los commits pueden
      // traer cada uno una.
      try { root = normalizePath(realpathSync.native(root)); } catch { /* ya no existe: tal cual */ }
      roots.set(path, root);
    }
    return root;
  };
  const owners = new Map<string, string | null>();
  const projectOf = (path: string) => {
    if (!owners.has(path)) owners.set(path, store.ownerOfRepo(db, path) ?? store.ownerOfRepo(db, rootOf(path)));
    return owners.get(path)!;
  };
  const turns: UndeliveredTurn[] = [];
  for (const t of store.turnsBetween(db, new Date(0), new Date("9999-12-31T00:00:00Z"))) {
    const projectId = t.repoPath ? projectOf(t.repoPath) : null;
    if (!projectId || !wanted.has(projectId)) continue;
    turns.push({ projectId, sessionId: t.sessionId, at: t.at, root: rootOf(t.repoPath!),
      branch: t.branch, microUsd: costOfTurn(t.tokens, t.model, t.at)?.microUsd ?? 0, agent: t.agent });
  }
  const projectRoots = new Set(turns.map((t) => t.root));

  // Solo tus commits, como en el import: los de un compañero no entregan tu trabajo.
  const candidates = (await allCommits(db)).filter((c) => projectRoots.has(rootOf(c.repoPath)));
  const mine = onlyMine(candidates, await myEmailsByRepo(db, new Set(candidates.map((c) => c.repoPath))));
  const commits = mine.map((c) => ({ root: rootOf(c.repoPath), at: c.at, branch: c.branch }));

  // Qué ramas están integradas y cuáles existen hoy, repo a repo.
  const merges = store.listMerges(db);
  const facts = new Map<string, { merged: Set<string>; exists: Set<string> | null }>();
  for (const root of projectRoots) {
    const merged = new Set<string>(await mergedBranches(root));
    const base = await integrationBranch(root);
    if (base) merged.add(base);
    for (const m of merges) if (m.sourceBranch && rootOf(m.repoPath) === root) merged.add(m.sourceBranch);
    facts.set(root, { merged, exists: await branchNames(root) });
  }
  // Lo leído de GitHub o GitLab con estela delivery: la rama de un PR fusionado está
  // entregada, aunque fuera con squash y git no lo sepa.
  for (const p of projects) {
    const prRoots = new Set(turns.filter((t) => t.projectId === p.id).map((t) => t.root));
    for (const item of store.listTrackerItems(db, p.id).items) {
      if (item.kind !== "pr" || !item.completed || !item.branch) continue;
      for (const root of prRoots) facts.get(root)?.merged.add(item.branch);
    }
  }

  return undeliveredSpend({
    turns, commits, staleDays, now: new Date(), ...(from ? { from } : {}), ...(to ? { to } : {}),
    subscriptions: store.listSubscriptions(db), monthTotals: store.totalConsumptionByMonth(db),
    branchFacts: (root, branch) => {
      const f = facts.get(root);
      return { merged: f?.merged.has(branch) ?? false, exists: f?.exists ? f.exists.has(branch) : null };
    },
  });
}

function moneyCell(s: Spend): string {
  return (s.real ? formatMoney(s.real) : "—") + (s.realPartial ? "†" : "");
}

function pctCell(part: Spend, total: Spend): string {
  const pct = shareOf(part, total);
  return pct === null ? "—" : `${pct.toFixed(1)} %`;
}

function printUndelivered(
  reports: readonly UndeliveredReport[], projects: ReadonlyMap<string, SpendProject>, staleDays: number, args: Args,
): void {
  console.log(tr`Gasto de IA sin entrega · ${periodLabel(args)} · ramas sin fusionar tras ${staleDays} días`);
  console.log(tr`Es una señal para revisar, no un juicio: explorar, probar y descartar también es trabajo.`);
  if (reports.length === 0) { console.log(tr`\nNo hay gasto de IA en ese periodo.`); return; }

  const row = (label: string, s: Spend, pct: string) =>
    `  ${label.slice(0, 46).padEnd(48)}${formatAiCost(s.consumption).padStart(11)}` +
    `${moneyCell(s).padStart(13)}${pct.padStart(10)}`;
  let unpriced = false;
  let partial = false;
  let unknown = false;
  let unverifiable = false;
  for (const r of reports) {
    const p = projects.get(r.projectId);
    console.log(`\n${p?.name ?? r.projectId} · ${p?.clientName ?? ""}`);
    console.log(`  ${"".padEnd(48)}${tr`API`.padStart(11)}${tr`Real`.padStart(13)}${tr`% gasto`.padStart(10)}`);
    console.log(row(tr`Gasto del periodo`, r.total, "100 %"));

    const s = r.sessionsWithoutCommit;
    console.log(row(tr`Sesiones sin commit (${s.count})`, s, pctCell(s, r.total)));
    if (s.count > 0) {
      const sinNada = s.count - s.laterCommitted.count;
      console.log(tr`      ${s.laterCommitted.count} con commit después en su rama (${formatAiCost(s.laterCommitted.consumption)}) · ${sinNada} sin commit después`);
    }

    if (r.unverifiable.count > 0) {
      unverifiable = true;
      console.log(tr`      No cuentan otras ${r.unverifiable.count} (${formatAiCost(r.unverifiable.consumption)}): son de antes de tu primer commit reconocido en el repo.`);
    }

    const u = r.unmerged;
    console.log(row(tr`Ramas sin fusionar tras ${staleDays} días (${u.branches.length})`, u, pctCell(u, r.total)));
    for (const b of u.branches.slice(0, 8)) {
      console.log(tr`      ${b.branch} · sin actividad hace ${b.idleDays} días · ${formatAiCost(b.consumption)}`);
    }
    if (u.branches.length > 8) console.log(tr`      … y ${u.branches.length - 8} más (--json para verlas todas)`);

    console.log(row(tr`Sin entrega en total`, r.undelivered, pctCell(r.undelivered, r.total)));

    const notCounted = (state: BranchLine["state"]) => r.notCounted.filter((b) => b.state === state);
    const open = notCounted("open");
    const dudosas = notCounted("unknown");
    if (open.length) {
      console.log(tr`  No cuenta: ${open.length} ramas abiertas hace menos de ${staleDays} días (${formatAiCost(sumSpend(open))}).`);
    }
    if (dudosas.length) {
      unknown = true;
      console.log(tr`  No cuenta: ${dudosas.length} ramas borradas sin merge registrado (${formatAiCost(sumSpend(dudosas))}): ${dudosas.slice(0, 4).map((b) => b.branch).join(", ")}${dudosas.length > 4 ? ", …" : ""}`);
    }
    unpriced ||= r.unpricedAgents;
    partial ||= r.total.realPartial;
  }

  console.log(tr`\nSesión sin commit: un rato de un chat (sin pausas de más de 30 min) sin ningún commit tuyo en ese repo durante él ni en los 30 min siguientes.`);
  console.log(tr`Rama sin fusionar: existe, no está integrada y lleva ${staleDays} días sin turnos ni commits. Cambia el plazo con --stale-days.`);
  console.log(tr`Una sesión sin commit no se cuenta otra vez en su rama. Las ramas principales (main, develop…) ya son entrega.`);
  console.log(tr`API es lo que costaría a precio de API: mide el uso, no es dinero pagado. Real es tu cuota repartida por consumo.`);
  if (unverifiable) {
    console.log(tr`Antes de tu primer commit reconocido no se sabe si commiteabas con otro correo: esas sesiones no cuentan. Revisa tus correos con estela author.`);
  }
  if (unknown) console.log(tr`Una rama borrada sin merge pudo fusionarse con squash, que no deja rastro en git: por eso no cuenta.`);
  console.log(tr`Un squash también hace que una rama que sigue existiendo parezca sin fusionar: revisa la lista antes de sacar conclusiones.`);
  if (unpriced) console.log(tr`Incluye trabajo con Copilot: no guarda tokens, así que su coste no se conoce y no está sumado.`);
  if (partial) console.log(tr`† Algún mes no tenía suscripción registrada: el dinero real solo cuenta los meses con cuota.`);
}

function sumSpend(lines: readonly Spend[]): { microUsd: number } {
  return { microUsd: lines.reduce((s, l) => s + l.consumption.microUsd, 0) };
}

function undeliveredJson(
  reports: readonly UndeliveredReport[], projects: ReadonlyMap<string, SpendProject>, staleDays: number, args: Args,
) {
  const spend = (s: Spend) => ({
    apiMicroUsd: s.consumption.microUsd,
    real: s.real ? { amountMinor: s.real.amount, currency: s.real.currency } : null,
    realPartial: s.realPartial,
  });
  const line = (b: BranchLine) => ({ branch: b.branch, state: b.state, idleDays: b.idleDays, ...spend(b) });
  return {
    staleDays,
    period: { month: str(args, "month") ?? null, from: str(args, "from") ?? null, to: str(args, "to") ?? null },
    projects: reports.map((r) => ({
      id: r.projectId, name: projects.get(r.projectId)?.name ?? r.projectId,
      clientName: projects.get(r.projectId)?.clientName ?? null,
      total: spend(r.total),
      unverifiableSessions: { count: r.unverifiable.count, ...spend(r.unverifiable) },
      sessionsWithoutCommit: { count: r.sessionsWithoutCommit.count, ...spend(r.sessionsWithoutCommit),
        laterCommitted: { count: r.sessionsWithoutCommit.laterCommitted.count, ...spend(r.sessionsWithoutCommit.laterCommitted) } },
      unmergedBranches: { ...spend(r.unmerged), branches: r.unmerged.branches.map(line) },
      undelivered: { ...spend(r.undelivered), percentOfSpend: shareOf(r.undelivered, r.total) },
      notCounted: r.notCounted.map(line),
      unpricedAgents: r.unpricedAgents,
    })),
  };
}

function periodLabel(args: Args): string {
  const month = str(args, "month");
  if (month) return month;
  const from = str(args, "from");
  const to = str(args, "to");
  if (!from && !to) return tr`todo el historial`;
  return `${from ?? "…"} → ${to ?? tr`hoy`}`;
}

function basisLabel(b: Basis): string {
  switch (b) {
    case "agent-branch": return tr`rama anotada por el agente`;
    case "commit-branch": return tr`rama del commit, aproximada`;
    case "branch-name": return tr`número en el nombre de la rama`;
    case "commit-message": return tr`referencia en un commit`;
    case "manual": return tr`puesto a mano`;
    case "merge": return tr`commit de merge del PR`;
  }
}

function unitLabel(u: SpendUnit, by: SpendBy): string {
  if (u.key === null) return by === "branch" ? tr`Sin atribuir (sin rama)` : tr`Sin atribuir (sin ticket ni PR)`;
  if (by === "branch") return u.key;
  const fromMerge = u.basis.length === 1 && u.basis[0] === "merge";
  return u.items.map((i) => (fromMerge ? refLabel(i) : formatWorkItem(i))).join(", ");
}

function printSpend(reports: readonly SpendProjectReport[], by: SpendBy, args: Args, hasSubs: boolean): void {
  const title = by === "branch" ? tr`Coste de IA por rama` : tr`Coste de IA por ticket o PR`;
  console.log(`${title} · ${periodLabel(args)}`);
  if (reports.length === 0) { console.log(tr`\nNo hay horas en ese periodo.`); return; }

  const real = (u: { real: Money | null; realPartial: boolean }) =>
    hasSubs ? (u.real ? formatMoney(u.real) : "—") + (u.realPartial ? "†" : "") : "—";
  const row = (label: string, u: SpendProjectReport["total"]) =>
    `  ${label.slice(0, 44).padEnd(46)}${formatDuration(u.seconds).padStart(9)}` +
    `${(formatAiCost(u.consumption) + (u.unpricedAgents ? "*" : "")).padStart(12)}${real(u).padStart(13)}`;

  let unpriced = false;
  let partial = false;
  let noTracker = false;
  for (const r of reports) {
    console.log(`\n${r.project.name} · ${r.project.clientName}`);
    console.log(`  ${"".padEnd(46)}${tr`Horas`.padStart(9)}${tr`API`.padStart(12)}${tr`Real`.padStart(13)}`);
    for (const u of r.units) {
      console.log(row(unitLabel(u, by), u));
      const detail: string[] = [];
      if (by === "branch") {
        if (u.items.length) detail.push(u.items.map(formatWorkItem).join(", "));
        if (u.prs.length) detail.push(u.prs.map(refLabel).join(", "));
      } else if (u.branches.length) {
        detail.push(tr`ramas: ${u.branches.join(", ")}`);
      }
      if (u.basis.length) detail.push(tr`según: ${u.basis.map(basisLabel).join(", ")}`);
      if (detail.length) console.log(`      ${detail.join(" · ")}`);
    }
    console.log(row(tr`Total`, r.total));
    unpriced ||= r.total.unpricedAgents;
    partial ||= r.total.realPartial;
    if (by === "item" && !r.project.tracker) noTracker = true;
  }

  console.log(tr`\nAPI es lo que costaría a precio de API: mide el uso, no es dinero pagado.`);
  if (hasSubs) console.log(tr`Real es tu cuota repartida por consumo: esto sí es dinero pagado.`);
  else console.log(tr`Sin suscripciones registradas no hay dinero real. Si pagas cuota fija: estela subscription add`);
  console.log(tr`Lo que no se puede atribuir va a "Sin atribuir" y no se reparte entre lo demás.`);
  if (unpriced) console.log(tr`* Incluye trabajo con Copilot: sus horas cuentan, pero su coste no se conoce y no está sumado.`);
  if (partial) console.log(tr`† Algún mes no tenía suscripción registrada: el dinero real solo cuenta los meses con cuota.`);
  if (noTracker) {
    console.log(tr`Sin gestor configurado solo se reconocen tickets inequívocos (AB#12, PROJ-12) y los PR de los merges.`);
    console.log(tr`Para leer #12 y feat/12-login: estela project tracker --project <id> --system github`);
  }
}

function spendJson(reports: readonly SpendProjectReport[], by: SpendBy, args: Args) {
  const realJson = (m: Money | null) => (m ? { amountMinor: m.amount, currency: m.currency } : null);
  return {
    by,
    period: { month: str(args, "month") ?? null, from: str(args, "from") ?? null, to: str(args, "to") ?? null },
    projects: reports.map((r) => ({
      id: r.project.id, name: r.project.name, clientId: r.project.clientId, clientName: r.project.clientName,
      units: r.units.map((u) => ({
        key: u.key, attributed: u.key !== null, branches: u.branches, items: u.items, prs: u.prs,
        basis: u.basis, seconds: u.seconds, apiMicroUsd: u.consumption.microUsd,
        real: realJson(u.real), realPartial: u.realPartial, unpricedAgents: u.unpricedAgents,
      })),
      total: {
        seconds: r.total.seconds, apiMicroUsd: r.total.consumption.microUsd, real: realJson(r.total.real),
        realPartial: r.total.realPartial, unpricedAgents: r.total.unpricedAgents,
      },
    })),
  };
}

/**
 * El proyecto de un comando: el de --project, o el del repositorio en el que
 * se está. Es lo natural para lo que se pega en el README de ese repositorio.
 */
async function projectFromArgsOrCwd(args: Args, db: DatabaseSync): Promise<string> {
  const explicit = str(args, "project");
  if (explicit) {
    if (!store.getProject(db, explicit)) throw new UserError(tr`No existe el proyecto "${explicit}".`);
    return explicit;
  }
  const root = await repoRoot(process.cwd());
  const id = root ? store.projectForRepo(db, root) : null;
  if (!id) throw new UserError(tr`Este directorio no es de ningún proyecto. Indica cuál con --project <id>.`);
  return id;
}

/**
 * Lo que costó la IA de un proyecto, en dinero de verdad si se puede.
 *
 * Con una cuota registrada, es su reparto (lo que se pagó); sin ella, la
 * tarifa API equivalente, que es lo que valdría ese uso y así se marca. Los
 * meses sin cuota vigente no suman: ahí no hay reparto que hacer. `months`
 * limita a esos meses; sin él, cuenta toda la historia del proyecto.
 */
function projectAiCost(
  db: DatabaseSync, projectId: string, entries: readonly TimeEntry[], months?: readonly string[],
): { money: Money; api: boolean } | null {
  const subs = store.listSubscriptions(db);
  if (subs.length) {
    const shares = amortize(store.consumptionByProjectMonth(db), subs, store.totalConsumptionByMonth(db))
      .filter((sh) => sh.projectId === projectId && feeForMonth(subs, sh.month) !== null &&
                      (!months || months.includes(sh.month)));
    if (shares.length) {
      const currency = shares[0]!.amount.currency;
      return { money: { amount: shares.reduce((n, sh) => n + sh.amount.amount, 0), currency }, api: false };
    }
  }
  const micro = entries.reduce((n, e) => n + e.aiCost.microUsd, 0);
  if (micro === 0) return null;
  return { money: { amount: Math.round(micro / 10_000), currency: "USD" }, api: true };
}

async function cmdBadge(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const projectId = await projectFromArgsOrCwd(args, db);
    const entries = store.getTimeEntries(db, projectId);
    const measuredSeconds = entries.filter((e) => e.source === "agent").reduce((n, e) => n + e.seconds, 0);
    if (measuredSeconds === 0) {
      throw new UserError(tr`"${projectId}" no tiene horas medidas todavía: el badge solo cuenta las de sesiones de agente.`);
    }
    const cost = projectAiCost(db, projectId, entries);
    const text = badgeText({ measuredSeconds, aiCost: cost ? formatMoneyWhole(cost.money) : null });

    console.log(badgeMarkdown(text));
    console.log("");
    console.log(tr`Vista previa: ${badgeUrl(text)}`);
    if (cost?.api) {
      console.log(tr`El coste es a tarifa API. Si pagas cuota fija, regístrala para que salga lo que pagas de verdad:`);
      console.log(tr`  estela subscription add --id claude-max --name "Claude Max" --fee 200`);
    }
    console.log(tr`Es una imagen estática: para actualizar las cifras, vuelve a generarlo.`);
  } finally { db.close(); }
}

/**
 * `estela statusline install` — la línea de Estela en Claude Code. La lógica
 * del fichero está en `statusline-install.ts`; aquí, leer, escribir y contar.
 */
function cmdStatuslineInstall(args: Args): void {
  const path = claudeSettingsPath();
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  const plan = planInstall(before, { force: args.flags["force"] === true, append: args.flags["append"] === true });

  if (plan.status === "invalid") {
    throw new UserError(tr`${path} no es un JSON válido. No lo toco: arréglalo y vuelve a intentarlo.`);
  }
  if (plan.status === "already") {
    console.log(tr`La status line de Estela ya está instalada en ${path}.`);
    console.log(tr`Solo en Claude Code en la terminal: la extensión de VS Code no enseña la status line.`);
    return;
  }
  if (plan.status === "conflict") {
    console.log(tr`Ya tienes otra status line en ${path}:\n`);
    console.log(`  ${plan.existing}\n`);
    console.log(tr`No la toco. Elige:`);
    console.log(tr`  estela statusline install --append   enseña las dos, la de Estela primero`);
    console.log(tr`  estela statusline install --force    sustituye la tuya por la de Estela`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  if (before !== null) {
    const copia = backupName(path);
    copyFileSync(path, copia);
    console.log(tr`Copia de seguridad: ${copia}`);
  }
  writeFileSync(path, plan.text);
  console.log(plan.status === "chained"
    ? tr`Status line de Estela instalada, con la tuya detrás: ${plan.previous ?? ""}`
    : plan.status === "replaced"
      ? tr`Status line de Estela instalada en lugar de: ${plan.previous ?? ""}`
      : tr`Status line de Estela instalada en ${path}.`);
  console.log(tr`Se verá en la próxima sesión de Claude Code (o al reiniciar la actual).`);
  // Comprobado: la extensión de VS Code no ejecuta la status line. Sin este
  // aviso, quien trabaja ahí cree que está instalada y no la ve nunca.
  console.log(tr`Solo en Claude Code en la terminal: la extensión de VS Code no enseña la status line.`);
  if (!estelaOnPath()) {
    console.log(tr`\nAviso: "estela" no está en tu PATH, así que Claude Code no podrá ejecutarla.`);
    console.log(tr`Instálala de forma global: npm install -g estela`);
  }
}

function cmdStatuslineUninstall(): void {
  const path = claudeSettingsPath();
  if (!existsSync(path)) { console.log(tr`No hay status line de Estela que quitar.`); return; }
  const plan = planUninstall(readFileSync(path, "utf8"));
  if (plan.status === "invalid") {
    throw new UserError(tr`${path} no es un JSON válido. No lo toco: arréglalo y vuelve a intentarlo.`);
  }
  if (plan.status === "absent") { console.log(tr`No hay status line de Estela que quitar.`); return; }
  if (plan.status === "foreign") {
    console.log(tr`La status line de ${path} no es la de Estela, así que no la toco:\n\n  ${plan.existing}`);
    return;
  }
  const copia = backupName(path);
  copyFileSync(path, copia);
  writeFileSync(path, plan.text);
  console.log(tr`Copia de seguridad: ${copia}`);
  console.log(plan.status === "restored"
    ? tr`Status line de Estela quitada; vuelve a estar la que tenías: ${plan.restored ?? ""}`
    : tr`Status line de Estela quitada.`);
}

/**
 * `estela quota` — qué proyecto se come la cuota. El cálculo vive en
 * `metrics/quota.ts`; aquí solo se presenta.
 */
async function cmdQuota(args: Args, dbPath: string): Promise<void> {
  const db = openDatabase(dbPath);
  try {
    const now = new Date();
    // Sobre la base de la demo no se lee nada tuyo: mezclaría tus turnos
    // reales con los inventados, justo lo que la demo promete no hacer.
    const esDemo = basename(dbPath) === "estela-demo.db";
    if (args.flags["no-refresh"] !== true && !esDemo) {
      try { await refreshQuotaTurns(db, weekStart(now)); }
      catch {
        // Sin refrescar se sigue: lo guardado sigue valiendo, solo más viejo.
        if (args.flags["json"] !== true) console.log(tr`(No se pudieron leer los transcripts de esta semana; se usa lo ya guardado.)`);
      }
    }

    const report = loadQuotaReport(db, now, { dbPath, weighted: args.flags["weighted"] === true });
    if (args.flags["json"] === true) {
      console.log(JSON.stringify(quotaToJson(report), null, 2));
      return;
    }
    printQuota(report, store.firstTurnByAgent(db).size > 0);
  } finally { db.close(); }
}

function printQuota(report: QuotaReport, hayTurnos: boolean): void {
  console.log(tr`\nConsumo de cuota · lo calcula Estela en tu máquina; no es el límite de tu plan\n`);

  if (report.agents.length === 0) {
    console.log(hayTurnos
      ? tr`Sin consumo de Claude Code ni Codex esta semana.`
      : tr`Sin turnos de agente guardados. Empieza con: estela setup`);
  }

  for (const a of report.agents) {
    const nombre = agentName(a.agent);
    if (a.window) {
      console.log(a.window.estimated
        ? tr`${nombre} — ventana de 5 h actual (estimada): desde las ${hhmm(a.window.start)}, termina a las ${hhmm(a.window.end)}`
        : tr`${nombre} — ventana de 5 h actual: desde las ${hhmm(a.window.start)}, termina a las ${hhmm(a.window.end)}`);
      printQuotaTable(a.window);
    } else if (a.lastWindowEnded) {
      console.log(tr`${nombre} — sin ventana de 5 h abierta ahora; la última terminó ${cuando(a.lastWindowEnded, report.generatedAt)}.\n`);
    }

    console.log(tr`${nombre} — esta semana (${diaCorto(report.weekStart)} → hoy)`);
    printQuotaTable(a.week);
    console.log(`  ${comparacion(a, report.generatedAt)}\n`);
  }

  if (report.copilotExcluded) console.log(tr`Copilot no guarda tokens fiables y queda fuera de este cálculo.`);
  if (report.agents.some((a) => a.week.weighted)) {
    console.log(tr`Ponderado por precio de lista; no es cómo el proveedor cuenta tu límite.`);
    const sinPrecio = report.agents.reduce((n, a) => n + a.week.unpriced, 0);
    if (sinPrecio > 0) console.log(tr`${sinPrecio} turnos de modelos sin precio de lista cuentan como 0 en ese %.`);
  }
  // La ventana estimada lo dice; la que dio Claude Code no lo necesita, pero
  // el reparto sigue siendo solo de esta máquina.
  if (report.agents.some((a) => a.window?.estimated)) {
    console.log(tr`La ventana de 5 h es una estimación: no se publica cómo se redondea su inicio, y lo que`);
    console.log(tr`uses en claude.ai u otro equipo también consume cuota y Estela no lo ve.`);
  } else if (report.agents.some((a) => a.window)) {
    console.log(tr`La ventana de 5 h es la que da Claude Code; el reparto solo incluye lo usado en esta máquina.`);
  }
}

function printQuotaTable(b: QuotaBreakdown): void {
  const filas = b.rows.map((r) => [nombreDeFila(r.bucket), r.usage, pct(r.share)] as const);
  const ancho = Math.min(28, Math.max(tr`Proyecto`.length, tr`Total`.length, ...filas.map((f) => f[0].length)));
  const cabeza = [tr`Entrada`, tr`Salida`, tr`Lect. caché`, tr`Escr. caché`, tr`Total`];
  const col = Math.max(10, ...cabeza.map((c) => c.length + 2));
  const celdas = (u: QuotaBreakdown["total"]) =>
    [u.input, u.output, u.cacheRead, u.cacheWrite, u.total].map((n) => fmtTokens(n).padStart(col)).join("");
  const nombre = (t: string) => (t.length > ancho ? t.slice(0, ancho - 1) + "…" : t).padEnd(ancho);

  console.log(`  ${nombre(tr`Proyecto`)}${cabeza.map((c) => c.padStart(col)).join("")}${"%".padStart(7)}`);
  for (const [n, u, p] of filas) console.log(`  ${nombre(n)}${celdas(u)}${p.padStart(7)}`);
  console.log(`  ${nombre(tr`Total`)}${celdas(b.total)}\n`);
}

function nombreDeFila(b: QuotaBucket): string {
  if (b.kind === "project") return b.projectName;
  if (b.kind === "folder") return tr`sin proyecto · ${b.folder}`;
  return tr`sin carpeta`;
}

function comparacion(a: AgentQuota, now: Date): string {
  const c = a.comparison;
  if (c.status === "insufficient") {
    return tr`Sin historial suficiente para comparar: hacen falta ${HISTORY_WEEKS} semanas completas y hay ${c.completeWeeks}.`;
  }
  const tramo = tr`lunes → ${DAYS[getLang()][now.getDay()]} ${hhmm(now)}`;
  if (c.ratio === null) {
    return tr`Frente a tu historial: ${fmtTokens(c.current)} esta semana; en el mismo tramo (${tramo}) de las ${c.weeks} semanas anteriores no hubo consumo.`;
  }
  const diff = Math.round((c.ratio - 1) * 100);
  const cuanto = diff > 0 ? tr`un ${diff} % más` : diff < 0 ? tr`un ${-diff} % menos` : tr`lo mismo`;
  return tr`Frente a tu historial: ${fmtTokens(c.current)} esta semana, y una media de ${fmtTokens(c.average)} en el mismo tramo (${tramo}) de las ${c.weeks} semanas anteriores: ${cuanto}.`;
}

/** Tokens con el formato corto del idioma: "22,7 M" o "22.7M". */
function fmtTokens(n: number): string {
  return new Intl.NumberFormat(getLang() === "en" ? "en-US" : "es-ES",
    { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

function pct(share: number): string {
  return tr`${Math.round(share * 100)} %`;
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "lun 5 oct" o "Mon Oct 5". */
function diaCorto(d: Date): string {
  const dia = DAYS[getLang()][d.getDay()]!.slice(0, 3);
  const mes = MONTHS[getLang()][d.getMonth()]!.slice(0, 3);
  return getLang() === "en" ? `${dia} ${mes} ${d.getDate()}` : `${dia} ${d.getDate()} ${mes}`;
}

/** "a las 14:00" si fue hoy; si no, con su día. */
function cuando(d: Date, now: Date): string {
  return localDate(d) === localDate(now) ? tr`a las ${hhmm(d)}` : tr`el ${diaCorto(d)} a las ${hhmm(d)}`;
}

function cmdReceipt(args: Args, dbPath: string): void {
  const db = openDatabase(dbPath);
  try {
    const week = args.flags["week"] === true;
    // Hasta el final de hoy, en la hora de quien lo pide; con --week, desde
    // el principio del día de hace seis: siete días naturales contando hoy.
    const hoy = new Date();
    const to = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);
    const from = week ? new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6) : null;

    const projects = store.listProjects(db);
    const entries = projects.flatMap((p) => store.getTimeEntries(db, p.id));
    if (entries.length === 0) throw new UserError(tr`Sin bloques imputados. Ejecuta: estela import`);

    const turns = (db.prepare(
      `SELECT at, model, tok_cache_read, tok_cache_w5m, tok_cache_w1h FROM agent_turns
       WHERE at >= ? AND at < ?`,
    ).all((from ?? new Date(0)).toISOString(), to.toISOString()) as {
      at: string; model: string; tok_cache_read: number; tok_cache_w5m: number; tok_cache_w1h: number;
    }[]).map((t) => ({
      at: new Date(t.at), model: t.model,
      cacheRead: t.tok_cache_read, cacheWrite5m: t.tok_cache_w5m, cacheWrite1h: t.tok_cache_w1h,
    }));

    const data = receiptData({
      entries, turns, from, to, projectNames: new Map(projects.map((p) => [p.id, p.name])),
    });
    const out = resolve(str(args, "out") ??
      (week ? `estela-receipt-${localDate(hoy)}.png` : "estela-receipt.png"));
    const names = args.flags["names"] === true;
    writeFileSync(out, renderReceipt(data, { week, names }));
    console.log(tr`Recibo guardado en ${out}`);
    if (!names) console.log(tr`Sin nombres de proyectos ni ramas, para que puedas compartirlo. Con --names, se incluyen.`);
    console.log(tr`Se ha generado en tu máquina y no se ha enviado a ningún sitio.`);
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

    // Si va seguida de otra palabra, parseArgs la toma como su valor. Una opción
    // que protege no puede dejar de hacerlo por eso: se emitía el informe de verdad.
    const dryRun = "dry-run" in args.flags;
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
        withAmounts: !("no-amounts" in args.flags),
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

  // Igual de pronto: sin esto, "estela import --help" ignoraba la opción y
  // ejecutaba el comando de verdad. Pedir ayuda no puede tocar los datos.
  if ("help" in args.flags || argv.includes("-h")) {
    console.log(helpText());
    return;
  }

  setClientVersion(VERSION);

  const dbPath = str(args, "db") ?? DEFAULT_DB_PATH;
  // `estela unpublish <panel>` lleva el panel suelto, sin flag: no es un subcomando.
  const command = args._[0] === "unpublish" ? "unpublish"
    // `estela plan set max5`: el plan va suelto, como el panel de unpublish.
    : args._[0] === "plan" && args._[1] === "set" ? "plan set"
    : args._.join(" ");

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
    case "client alias":      cmdClientAlias(args, dbPath); break;
    case "project add":       cmdProjectAdd(args, dbPath); break;
    case "project close":     cmdProjectClose(args, dbPath); break;
    case "project reopen":    cmdProjectReopen(args, dbPath); break;
    case "project tracker":   cmdProjectTracker(args, dbPath); break;
    case "entry link":        cmdEntryLink(args, dbPath); break;
    case "rate set":          cmdRateSet(args, dbPath); break;
    case "budget":            cmdBudget(args, dbPath); break;
    case "subscription add":  cmdSubscriptionAdd(args, dbPath); break;
    case "ai-cost":           await cmdAiCost(args, dbPath); break;
    case "quota":             await cmdQuota(args, dbPath); break;
    case "statusline install":   cmdStatuslineInstall(args); break;
    case "statusline uninstall": cmdStatuslineUninstall(); break;
    case "badge":             await cmdBadge(args, dbPath); break;
    case "receipt":           cmdReceipt(args, dbPath); break;
    case "status":            cmdStatus(dbPath); break;
    case "doctor":            cmdDoctor(dbPath); break;
    case "entries":           cmdEntries(args, dbPath); break;
    case "log":               cmdLog(args, dbPath); break;
    case "author":            await cmdAuthor(args, dbPath); break;
    case "share":             cmdShare(args, dbPath); break;
    case "publish":           await cmdPublish(args, dbPath); break;
    case "unpublish":         await cmdUnpublish(args, dbPath); break;
    case "delivery":          await cmdDelivery(args, dbPath); break;
    case "summary":           await cmdSummary(args, dbPath); break;
    case "plan":              cmdPlan(args, dbPath); break;
    case "plan set":          cmdPlanSet(args, dbPath); break;
    case "export":            await cmdExport(args, dbPath); break;
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
