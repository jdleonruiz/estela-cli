/**
 * Traducciones de la terminal al inglés, con la frase en español como clave.
 * Ver i18n/index.ts.
 *
 * Una frase nueva marcada con tr`` en el código tiene que añadirse aquí, o el
 * test `i18n.test.ts` falla diciendo cuál falta. Si se cambia el texto en
 * español, cambia la clave: hay que actualizarla también.
 */
export const EN: Record<string, string> = {
  // ── billing/amortize.ts ──
  "Suscripciones en monedas distintas en {0} ({1} y {2}). ":
    "Subscriptions in different currencies in {0} ({1} and {2}). ",
  "Unifica la moneda de las suscripciones: no se convierten automáticamente.":
    "Use a single currency for your subscriptions: they aren't converted automatically.",
  // ── billing/invoice.ts ──
  "No hay horas pendientes de facturar en \"{0}\" hasta {1}.":
    "No unbilled hours for \"{0}\" up to {1}.",
  "Sin tarifa vigente para \"{0}\" el {1}. ":
    "No rate in effect for \"{0}\" on {1}. ",
  "Define una con: estela rate set --project {0} --rate <importe> --currency {1}":
    "Set one with: estela rate set --project {0} --rate <amount> --currency {1}",
  "La tarifa de \"{0}\" está en {1} pero a {2} se le factura en ":
    "The rate for \"{0}\" is in {1}, but {2} is billed in ",
  "{0}. Corrige la tarifa o la moneda del cliente: no se convierte automáticamente.":
    "{0}. Fix the rate or the client's currency: it isn't converted automatically.",
  "Todas las entradas quedaron en cero tras redondear a {0} min.":
    "Every entry came out as zero after rounding to {0} min.",
  "\"{0}\" repercute el coste de IA ({1} USD) y se factura en ":
    "\"{0}\" passes the AI cost through ({1} USD) and is billed in ",
  "{0}. Indica el tipo de cambio del día con --fx <USD->{1}>.":
    "{0}. Give the day's exchange rate with --fx <USD->{1}>.",
  "INFORME DE HORAS {0}":
    "HOURS REPORT {0}",
  "Emitido: {0}":
    "Issued: {0}",
  "Cliente:   {0}":
    "Client:    {0}",
  "Proyecto:  {0}":
    "Project:   {0}",
  "Periodo:   {0}  ->  {1}":
    "Period:    {0}  ->  {1}",
  "CONCEPTO":
    "DESCRIPTION",
  "TIEMPO":
    "TIME",
  "TARIFA":
    "RATE",
  "IMPORTE":
    "AMOUNT",
  "{0} conceptos":
    "{0} items",
  "Coste de IA repercutido (1 USD = {0} {1})":
    "AI cost passed through (1 USD = {0} {1})",
  "VALOR DEL TRABAJO":
    "VALUE OF WORK",
  "Interno (no facturado): IA del periodo {0} USD ":
    "Internal (not billed): AI for the period {0} USD ",
  "en tarifa API equivalente.":
    "at equivalent API pricing.",
  // ── billing/sessionize.ts ──
  "{0} (+1 commit más)":
    "{0} (+1 more commit)",
  "{0} (+{1} commits más)":
    "{0} (+{1} more commits)",
  "Desarrollo en {0}":
    "Development on {0}",
  "Desarrollo":
    "Development",
  // ── billing.ts ──
  "Necesitas una cuenta para esto. Vincúlala con:\n\n":
    "You need an account for this. Link it with:\n\n",
  "  estela login --email tu@correo.com\n":
    "  estela login --email you@example.com\n",
  "Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n":
    "Your session is no longer valid. Link this machine again:\n\n",
  // ── bin.ts ──
  "\nEstela necesita Node {0} o superior — tienes {1} instalado.\n":
    "\nEstela needs Node {0} or later — you have {1} installed.\n",
  "Actualiza con \"{0}\" o desde https://nodejs.org, y vuelve a intentarlo en una terminal nueva.\n":
    "Upgrade with \"{0}\" or from https://nodejs.org, then try again in a new terminal.\n",
  // ── cli.ts ──
  "Falta --{0}":
    "Missing --{0}",
  "Reunión":
    "Meeting",
  "Investigación":
    "Research",
  "Revisión":
    "Review",
  "Desplazamiento":
    "Travel",
  "Soporte":
    "Support",
  "Otro":
    "Other",
  "\n  Estela  {0}":
    "\n  Estela  {0}",
  "  Datos:  {0}":
    "  Data:   {0}",
  "\n  Ctrl+C para parar.\n":
    "\n  Ctrl+C to stop.\n",
  "\n  Estela — demo con datos inventados  {0}":
    "\n  Estela — demo with made-up data  {0}",
  "  No es tu trabajo: no se ha tocado tu base ni se ha leído nada tuyo.":
    "  This isn't your work: nothing of yours was read, and your data wasn't touched.",
  "  Para el tuyo de verdad:  estela setup":
    "  For your real one:  estela setup",
  "\nEstela\n":
    "\nEstela\n",
  "Leyendo lo que tus agentes ya guardaron en disco…":
    "Reading what your agents already saved to disk…",
  "\n  No se han encontrado sesiones de Claude Code en ~/.claude, ni":
    "\n  No Claude Code sessions found in ~/.claude, and no",
  "  un repositorio de Git en esta carpeta. Corre esto de nuevo desde":
    "  Git repository in this folder. Run this again from",
  "  dentro de tu proyecto, o trabaja un rato con tu agente y vuelve.\n":
    "  inside your project, or work with your agent for a while and come back.\n",
  "  {0} turnos · ":
    "  {0} turns · ",
  "{0} versiones de Claude Code":
    "{0} Claude Code versions",
  "  No se han encontrado sesiones de Claude Code en ~/.claude —":
    "  No Claude Code sessions found in ~/.claude —",
  "  sin problema, se reconstruye igual desde tus commits de Git.":
    "  no problem, your history is rebuilt from your Git commits instead.",
  "\nBuscando repositorios… ({0})":
    "\nLooking for repositories… ({0})",
  "  (commiteas como {0})":
    "  (you commit as {0})",
  "  ⚠ sin autor claro":
    "  ⚠ no clear author",
  "  {0} ya estaban configurados y no se tocan":
    "  {0} were already set up and are left untouched",
  "\nReconstruyendo tu historial…":
    "\nRebuilding your history…",
  "  del {0} al {1}":
    "  from {0} to {1}",
  "  {0} personas han commiteado en esos repositorios":
    "  {0} people have committed to those repositories",
  "  ⚠ En {0} repositorio(s) no se ha podido saber con qué":
    "  ⚠ In {0} repositor(y/ies) we couldn't tell which email",
  "    correo commiteas, así que ahí no se ha capturado nada tuyo:":
    "    you commit with, so nothing of yours was captured there:",
  "      estela author --project {0}":
    "      estela author --project {0}",
  "  Ábrelo:        estela web":
    "  Open it:       estela web",
  "  Revísalo:      estela doctor":
    "  Check it:      estela doctor",
  "\n  Los proyectos se han creado como internos y sin tarifa. Si alguno":
    "\n  Projects were created as internal and without a rate. If any of them",
  "  es de un cliente al que facturas, ponle la suya y podrás emitir":
    "  belongs to a client you bill, give it its rate and you'll be able to issue",
  "  informes:  estela rate set --project <id> --rate 50\n":
    "  reports:   estela rate set --project <id> --rate 50\n",
  "Fecha inválida: {0}":
    "Invalid date: {0}",
  "Leyendo transcripts de agentes…":
    "Reading agent transcripts…",
  "  {0} archivos · {1} registros":
    "  {0} files · {1} records",
  "  {0} turnos aceptados · {1} nuevos":
    "  {0} turns accepted · {1} new",
  "  {0} duplicados descartados":
    "  {0} duplicates dropped",
  " ({0}% de las filas)":
    " ({0}% of rows)",
  "  {0} registros internos ignorados · {1} malformados":
    "  {0} internal records ignored · {1} malformed",
  "  versiones de Claude Code: {0}":
    "  Claude Code versions: {0}",
  "  {0} turnos de scratchpad devueltos a su repositorio":
    "  {0} scratchpad turns returned to their repository",
  "Git: 1 repositorio · {0} commits nuevos":
    "Git: 1 repository · {0} new commits",
  "Git: {0} repositorios · {1} commits nuevos":
    "Git: {0} repositories · {1} new commits",
  "  {0} bloques deducidos solo de commits (sin agente)":
    "  {0} blocks inferred from commits only (no agent)",
  "Bloques: {0} detectados → {1} tras agrupar por rama y día · ":
    "Blocks: {0} detected → {1} after grouping by branch and day · ",
  "{0} imputados · {1} sin proyecto":
    "{0} assigned · {1} without a project",
  "\nHay {0} bloques sin proyecto asignado. Regístralos con:":
    "\nThere are {0} blocks without an assigned project. Register them with:",
  "  estela project add --id <id> --client <id> --name <nombre> --repo <ruta>":
    "  estela project add --id <id> --client <id> --name <name> --repo <path>",
  "Cliente \"{0}\" guardado. Factura en {1}.":
    "Client \"{0}\" saved. Billed in {1}.",
  "No existe el cliente \"{0}\". Créalo primero con: estela client add":
    "Client \"{0}\" doesn't exist. Create it first with: estela client add",
  "Proyecto \"{0}\" guardado.":
    "Project \"{0}\" saved.",
  "  repositorio: {0}":
    "  repository: {0}",
  "No existe el proyecto \"{0}\".":
    "Project \"{0}\" doesn't exist.",
  "\"{0}\" ya estaba cerrado desde el {1}.":
    "\"{0}\" was already closed on {1}.",
  "  ⚠ \"{0}\" tiene {1} sin facturar en {2} bloques.":
    "  ⚠ \"{0}\" has {1} unbilled in {2} blocks.",
  "    Ciérralo igual, o factúralo primero con: estela report --project {0} --cutoff <fecha>":
    "    Close it anyway, or bill it first with: estela report --project {0} --cutoff <date>",
  "\n\"{0}\" cerrado. Los datos siguen ahí; si vuelve a captar":
    "\n\"{0}\" closed. The data is still there; if it captures",
  "trabajo, \"estela doctor\" avisa en vez de perderlo en silencio.":
    "work again, \"estela doctor\" flags it instead of silently losing it.",
  "Para reabrirlo:  estela project reopen --project {0}":
    "To reopen it:  estela project reopen --project {0}",
  "\"{0}\" ya estaba abierto.":
    "\"{0}\" was already open.",
  "\"{0}\" reabierto.":
    "\"{0}\" reopened.",
  "\"{0}\" no tiene presupuesto de IA.":
    "\"{0}\" has no AI budget.",
  "\"{0}\": ${1} al mes.":
    "\"{0}\": ${1} a month.",
  "Presupuesto de \"{0}\" retirado.":
    "Budget for \"{0}\" removed.",
  "Importe inválido: {0}":
    "Invalid amount: {0}",
  "Presupuesto de IA de \"{0}\": ${1} al mes.":
    "AI budget for \"{0}\": ${1} a month.",
  "Tarifa de \"{0}\": {1}/hora":
    "Rate for \"{0}\": {1}/hour",
  " desde {0}.":
    " from {0}.",
  " (aplica a todo el histórico).":
    " (applies to all past work).",
  "Base de datos: {0}\n":
    "Database: {0}\n",
  "Turnos de agente:  {0}":
    "Agent turns:       {0}",
  "Periodo:           {0} → {1}":
    "Period:            {0} → {1}",
  "Coste de IA total: {0}\n":
    "Total AI cost:     {0}\n",
  "Sin clientes configurados. Empieza con:":
    "No clients set up. Start with:",
  "  estela client add --id <id> --name <nombre> --currency EUR":
    "  estela client add --id <id> --name <name> --currency EUR",
  " (cerrado)":
    " (closed)",
  "    tarifa:          {0}":
    "    rate:            {0}",
  "— sin definir —":
    "— not set —",
  "    sin facturar:    {0} en {1} bloques":
    "    unbilled:        {0} in {1} blocks",
  "    importe:         {0}":
    "    amount:          {0}",
  "    coste de IA:     {0}":
    "    AI cost:         {0}",
  "Sin bloques imputados. Ejecuta: estela import":
    "No blocks assigned. Run: estela import",
  "facturado":
    "invoiced",
  "pendiente":
    "pending",
  "no facturable":
    "not billable",
  "\nInforme: {0}":
    "\nReport: {0}",
  "  {0} · {1} · {2} al {3}":
    "  {0} · {1} · {2} to {3}",
  "  Un solo fichero. Se abre sin instalar nada y sin depender de tu máquina.":
    "  A single file. It opens without installing anything and without depending on your machine.",
  "\n  Incluye horas y commits. Sin importes (añade --with-amounts) y sin":
    "\n  Includes hours and commits. No amounts (add --with-amounts) and no",
  "  consumo de IA, que es tuyo mientras la pagues tú.":
    "  AI usage, which is yours as long as you're the one paying for it.",
  "(ninguno)":
    "(none)",
  "No existe el proyecto \"{0}\". Los que hay: {1}":
    "Project \"{0}\" doesn't exist. The ones there are: {1}",
  "Tipo \"{0}\" no reconocido. Usa uno de: {1}":
    "Unknown kind \"{0}\". Use one of: {1}",
  "Indica --hours o --minutes":
    "Give --hours or --minutes",
  "Duración inválida: {0}":
    "Invalid duration: {0}",
  "\n  Registro manual: un import no lo va a tocar.  ({0})":
    "\n  Manual entry: an import won't touch it.  ({0})",
  "\nPanel publicado.\n":
    "\nPanel published.\n",
  "  Enlace: {0}\n":
    "  Link: {0}\n",
  "  Este panel ya existía y queda vinculado a tu cuenta desde ahora.\n":
    "  This panel already existed and is linked to your account from now on.\n",
  "  Compartido con: {0}":
    "  Shared with: {0}",
  "  Al entrar en getestela.dev/app con ese correo, lo verán ahí.\n":
    "  When they sign in to getestela.dev/app with that email, they'll see it there.\n",
  "  El token es lo único que protege la página: quien tenga el enlace, entra.":
    "  The token is the only thing protecting the page: anyone with the link can get in.",
  "  Al volver a publicar desde esta máquina, este enlace se reusa solo.":
    "  When you publish again from this machine, this link is reused automatically.",
  "  Desde otra máquina, pasa --token {0} o el cliente perderá su enlace.":
    "  From another machine, pass --token {0} or your client will lose their link.",
  "\"{0}\" ya está enlazado a un equipo y no puede sincronizarse también como personal.":
    "\"{0}\" is already linked to a team and can't also sync as a personal project.",
  "Sync activado para \"{0}\". Ejecuta \"estela sync\" para subir y bajar.":
    "Sync enabled for \"{0}\". Run \"estela sync\" to upload and download.",
  "Ningún proyecto sincroniza todavía. Actívalo con: estela sync enable --project <id>":
    "No project syncs yet. Turn it on with: estela sync enable --project <id>",
  "{0}: {1} totales enviadas":
    "{0}: {1} in total sent",
  "{0}: {1} subidas, {2} bajadas":
    "{0}: {1} uploaded, {2} downloaded",
  "--kind debe ser \"employee\" o \"freelancer\".":
    "--kind must be \"employee\" or \"freelancer\".",
  "\nInvitación creada para: {0}\n":
    "\nInvitation created for: {0}\n",
  "  Pásale esto (por el canal que uses con él, no hace falta correo):\n":
    "  Send them this (through whatever channel you use with them, no email needed):\n",
  "    estela login --email <su-correo>":
    "    estela login --email <their-email>",
  "    estela team accept --token {0} --as-id <id-que-elija>\n":
    "    estela team accept --token {0} --as-id <id-of-their-choice>\n",
  "Elige una: --allow para compartirlo, --deny para no hacerlo.":
    "Pick one: --allow to share it, --deny not to.",
  "\"{0}\" no es un proyecto de equipo.":
    "\"{0}\" isn't a team project.",
  "Vincula la máquina con \"estela login\" antes.":
    "Link this machine with \"estela login\" first.",
  "\nHecho. El coste de IA de \"{0}\" se sumará al del proyecto en el ":
    "\nDone. The AI cost of \"{0}\" will be added to the project's on the ",
  "siguiente \"estela sync\".\n\n  Nunca se enseña por persona, solo el total del proyecto.\n":
    "next \"estela sync\".\n\n  It's never shown per person, only as the project total.\n",
  "\nHecho. El coste de IA de \"{0}\" NO se comparte, y se avisa a quien lo pidió.\n\n":
    "\nDone. The AI cost of \"{0}\" is NOT shared, and whoever asked for it is told so.\n\n",
  "  Tus horas se siguen midiendo igual: esto solo afecta al gasto de IA.\n":
    "  Your hours are still measured the same way: this only affects AI spend.\n",
  "\nInvitación aceptada: \"{0}\"":
    "\nInvitation accepted: \"{0}\"",
  "  Declarada para: {0} ({1})":
    "  Issued for: {0} ({1})",
  "  Si no eres tú, avisa a quien te invitó.\n":
    "  If that isn't you, tell whoever invited you.\n",
  "En esta máquina se llama \"{0}\".\n":
    "On this machine it's called \"{0}\".\n",
  "Ahora vincula tu repositorio local y sincroniza:\n":
    "Now link your local repository and sync:\n",
  "  estela team repo --project {0} --add <ruta-de-tu-clon>":
    "  estela team repo --project {0} --add <path-to-your-clone>",
  "  estela import":
    "  estela import",
  "  estela sync\n":
    "  estela sync\n",
  "Repositorio vinculado a \"{0}\": {1}":
    "Repository linked to \"{0}\": {1}",
  "Nadie ha aceptado todavía en \"{0}\".":
    "Nobody has accepted on \"{0}\" yet.",
  "sincronizado {0}":
    "synced {0}",
  "sin sincronizar aún":
    "not synced yet",
  "Invitación revocada.":
    "Invitation revoked.",
  "--plan debe ser \"pro\" o \"teams\".":
    "--plan must be \"pro\" or \"teams\".",
  "\nAbre esto para completar el alta a {0}":
    "\nOpen this to finish signing up for {0}",
  "\nGestiona tu pago aquí:\n\n  {0}\n":
    "\nManage your payment here:\n\n  {0}\n",
  "Esta máquina no está vinculada a ninguna cuenta. Vincúlala con:\n\n":
    "This machine isn't linked to any account. Link it with:\n\n",
  "Tu sesión ya no vale. Vuelve a vincular la máquina:\n\n  estela login --email tu@correo.com\n":
    "Your session is no longer valid. Link this machine again:\n\n  estela login --email you@example.com\n",
  "\n{0} · plan {1}\n":
    "\n{0} · {1} plan\n",
  "  {0} · v{1} · visto {2}":
    "  {0} · v{1} · last seen {2}",
  "(sin nombre)":
    "(no name)",
  "nunca":
    "never",
  "El proyecto no tiene repositorio asignado.":
    "The project has no repository assigned.",
  "\nAutores en {0}:\n":
    "\nAuthors in {0}:\n",
  "  {0} {1} commits, hasta {2}":
    "  {0} {1} commits, until {2}",
  "\nConfigurado ahora: {0}":
    "\nCurrently set: {0}",
  "— nada —":
    "— nothing —",
  "\nElige el tuyo con:":
    "\nPick yours with:",
  "  estela author --project {0} --email tu@correo.com":
    "  estela author --project {0} --email you@example.com",
  "\n{0}: commits filtrados por {1}":
    "\n{0}: commits filtered by {1}",
  "Ejecuta \"estela import\" para recoger los que faltaban.":
    "Run \"estela import\" to pick up the ones that were missing.",
  "CSV: {0}":
    "CSV: {0}",
  "Suscripción \"{0}\": {1}/mes.":
    "Subscription \"{0}\": {1}/month.",
  "Se repartirá entre proyectos según lo que consumió cada uno.":
    "It will be split across projects by how much each one used.",
  "Sin consumo registrado. Ejecuta: estela import":
    "No usage recorded. Run: estela import",
  "Sin suscripciones registradas: el coste se muestra a tarifa API.\n":
    "No subscriptions recorded: cost is shown at API pricing.\n",
  "Si pagas cuota fija, regístrala para ver el gasto real:":
    "If you pay a flat fee, record it to see your real spend:",
  "  estela subscription add --id claude-max --name \"Claude Max\" --fee 200\n":
    "  estela subscription add --id claude-max --name \"Claude Max\" --fee 200\n",
  "\n{0}   (consumo total: {1} equiv. API)":
    "\n{0}   (total usage: {1} API equiv.)",
  "\nLa última columna es dinero real: tu cuota repartida por consumo.":
    "\nThe last column is real money: your fee split by usage.",
  "La primera es la tarifa API equivalente, útil solo como medida de uso.":
    "The first is equivalent API pricing, useful only as a measure of usage.",
  "Coste real de IA imputado desde tu suscripción: {0}":
    "Real AI cost assigned from your subscription: {0}",
  "\nSin suscripciones registradas. Si pagas cuota fija, el importe de arriba":
    "\nNo subscriptions recorded. If you pay a flat fee, the amount above",
  "es tarifa API equivalente, no lo que gastaste. Regístrala con:":
    "is equivalent API pricing, not what you spent. Record it with:",
  "  estela subscription add --id claude-max --name \"Claude Max\" --fee 200":
    "  estela subscription add --id claude-max --name \"Claude Max\" --fee 200",
  "\nMargen a tarifa API: {0} de {1} ":
    "\nMargin at API pricing: {0} of {1} ",
  "\nPDF: {0}  ({1} KB, {2} conceptos)":
    "\nPDF: {0}  ({1} KB, {2} items)",
  "\n[--dry-run] No se guardó nada. Repite sin --dry-run para emitirlo.":
    "\n[--dry-run] Nothing was saved. Run it again without --dry-run to issue it.",
  "\nInforme {0} emitido. {1} bloques marcados como informados.":
    "\nReport {0} issued. {1} blocks marked as reported.",
  "Comando desconocido: \"{0}\"\n{1}":
    "Unknown command: \"{0}\"\n{1}",
  // ── cloud/auth.ts ──
  "\nTe mandamos un enlace a {0}. Confírmalo para vincular esta máquina.":
    "\nWe've sent a link to {0}. Confirm it to link this machine.",
  "Código de verificación (debe coincidir con el del enlace): {0}":
    "Verification code (it must match the one in the link): {0}",
  "Esperando confirmación...\n":
    "Waiting for confirmation...\n",
  "El login caducó o el enlace ya se usó. Ejecuta \"estela login\" otra vez.":
    "The login expired or the link was already used. Run \"estela login\" again.",
  "Vinculado como {0}.":
    "Linked as {0}.",
  "No se confirmó el login a tiempo. Ejecuta \"estela login\" otra vez.":
    "The login wasn't confirmed in time. Run \"estela login\" again.",
  "Esta máquina ya era local.":
    "This machine was already local.",
  "Desvinculado. Tus datos locales no se tocaron.":
    "Unlinked. Your local data wasn't touched.",
  // ── cloud/client.ts ──
  "Sin respuesta de {0}. Puede ser tu conexión o que el servicio esté caído; ":
    "No response from {0}. It may be your connection or the service may be down; ",
  "en ambos casos, nada de lo tuyo se ha perdido: vuelve a intentarlo.":
    "either way, nothing of yours has been lost: try again.",
  "Error {0}":
    "Error {0}",
  // ── db/schema.ts ──
  "La base de datos usa el esquema v{0} y esta versión de Estela entiende hasta ":
    "The database uses schema v{0} and this version of Estela understands up to ",
  "v{0}. Actualiza Estela antes de continuar.":
    "v{0}. Update Estela before continuing.",
  "Falló la migración v{0} ({1}): ":
    "Migration v{0} failed ({1}): ",
  // ── demo.ts ──
  "Seguimiento semanal con Northwind":
    "Weekly sync with Northwind",
  // ── doctor.ts ──
  "No hay ningún proyecto configurado":
    "No project is set up",
  "Sin proyectos no se imputa nada, aunque se esté capturando trabajo.":
    "Without projects nothing gets assigned, even though work is being captured.",
  "Abre la pestaña Proyectos y registra el primero.":
    "Open the Projects tab and register the first one.",
  "\"{0}\" no sabe con qué correo commiteas":
    "\"{0}\" doesn't know which email you commit with",
  "Se filtra por la configuración global de git, que en el repositorio de ":
    "It filters by your global git config, which in a client's repository ",
  "un cliente casi nunca es la que usas. Estarás perdiendo casi todos tus commits.":
    "is almost never the one you use. You're probably missing most of your commits.",
  "\"{0}\" no tiene repositorio asignado":
    "\"{0}\" has no repository assigned",
  "Solo recibirá las horas que anotes a mano.":
    "It will only get the hours you log by hand.",
  "Asígnale uno en la pestaña Proyectos.":
    "Assign one in the Projects tab.",
  "\"{0}\" es facturable pero no tiene tarifa":
    "\"{0}\" is billable but has no rate",
  "Las horas se registran, pero no se puede calcular su valor.":
    "Hours are recorded, but their value can't be calculated.",
  "estela rate set --project {0} --rate <importe>":
    "estela rate set --project {0} --rate <amount>",
  "\"{0}\" tiene {1} deducidas solo de commits":
    "\"{0}\" has {1} inferred from commits only",
  "1 bloque sin sesión de agente que lo respalde.":
    "1 block with no agent session to back it.",
  "{0} bloques sin sesión de agente que los respalde.":
    "{0} blocks with no agent session to back them.",
  " El tiempo se estima a partir de la separación entre commits, así que es ":
    " The time is estimated from the gaps between commits, so it's ",
  "menos exacto que el resto del informe.":
    "less accurate than the rest of the report.",
  "Revísalos en Mi día y corrige los minutos antes de emitir el informe.":
    "Review them in My day and correct the minutes before issuing the report.",
  "\"{0}\" está cerrado pero volvió a captar trabajo":
    "\"{0}\" is closed but captured work again",
  "1 bloque nuevo":
    "1 new block",
  "{0} bloques nuevos":
    "{0} new blocks",
  " ({0}) desde que se cerró, el {1}.":
    " ({0}) since it was closed, on {1}.",
  "Factúralo y ciérralo otra vez, o si sigues trabajando en él: ":
    "Bill it and close it again, or if you're still working on it: ",
  "estela project reopen --project {0}":
    "estela project reopen --project {0}",
  "{0} imputaciones con la fecha descuadrada":
    "{0} entries with a mismatched date",
  "Su identificador lleva una fecha distinta a la del día al que están ":
    "Their identifier carries a different date from the day they're ",
  "asignadas. Suele significar que un día está contado dos veces.":
    "assigned to. It usually means a day is counted twice.",
  "{0} turnos con el modelo \"{1}\" sin precio":
    "{0} turns with model \"{1}\" and no price",
  "Es un valor interno de la herramienta, no un modelo real. Suman cero al coste.":
    "It's an internal value of the tool, not a real model. They add nothing to the cost.",
  "No está en el catálogo de precios, así que su coste no se cuenta.":
    "It isn't in the price catalog, so its cost isn't counted.",
  "No hace falta nada: no representa consumo facturable.":
    "Nothing to do: it doesn't represent billable usage.",
  "Añádelo a PRICE_CATALOG en packages/daemon/src/pricing/catalog.ts":
    "Add it to PRICE_CATALOG in packages/daemon/src/pricing/catalog.ts",
  "{0} repositorios con trabajo sin proyecto":
    "{0} repositories with work and no project",
  "De {0} repositorios con actividad capturada, {1} ":
    "Of {0} repositories with captured activity, {1} ",
  "no pertenecen a ningún proyecto. Son horas que ya tienes y no puedes informar.":
    "don't belong to any project. Those are hours you already have and can't report.",
  "Asígnalos en la pestaña Proyectos.":
    "Assign them in the Projects tab.",
  "{0} bloques de más de 10 horas":
    "{0} blocks longer than 10 hours",
  "El mayor es de {0}. Puede ser real, ":
    "The longest is {0}. It may be real, ",
  "pero también una sesión que quedó abierta.":
    "but it may also be a session that was left open.",
  "Revísalos en Mi día y corrige los minutos si no cuadran.":
    "Review them in My day and correct the minutes if they don't add up.",
  "El panel de \"{0}\" se ha quedado atrás":
    "The panel for \"{0}\" has fallen behind",
  "Hay 1 bloque de trabajo posterior a la última publicación ":
    "There's 1 block of work after the last publication ",
  "({0}). Tu cliente está viendo datos viejos.":
    "({0}). Your client is looking at old data.",
  "Hay {0} bloques de trabajo posteriores a la última publicación ":
    "There are {0} blocks of work after the last publication ",
  "El lector de transcripts avisó de algo":
    "The transcript reader flagged something",
  "Revisa los totales antes de publicar nada.":
    "Check the totals before publishing anything.",
  "\n  Todo en orden. Puedes publicar con tranquilidad.\n":
    "\n  All good. You can publish with confidence.\n",
  "  1 problema que conviene arreglar antes de enseñar esto.":
    "  1 problem worth fixing before you show this to anyone.",
  "  {0} problemas que conviene arreglar antes de enseñar esto.":
    "  {0} problems worth fixing before you show this to anyone.",
  "  Nada grave: 1 aviso.":
    "  Nothing serious: 1 warning.",
  "  Nada grave: {0} avisos.":
    "  Nothing serious: {0} warnings.",
  "  Solo notas informativas.":
    "  Only informational notes.",
  // ── export/share.ts ──
  "No hay trabajo registrado en este periodo.":
    "No work recorded in this period.",
  "valor del trabajo":
    "value of work",
  "Informe de horas de {0} para {1}":
    "Hours report by {0} for {1}",
  "Informe de horas para {0}":
    "Hours report for {0}",
  "{0} al {1}":
    "{0} to {1}",
  "horas trabajadas":
    "hours worked",
  "día con actividad":
    "day with activity",
  "días con actividad":
    "days with activity",
  "Generado con Estela a partir de la actividad real de Git y del editor.":
    "Generated with Estela from real Git and editor activity.",
  "Cada bloque está respaldado por sus commits.":
    "Every block is backed by its commits.",
  // ── publish.ts ──
  "Necesitas una cuenta para publicar. Vincúlala con:\n\n":
    "You need an account to publish. Link it with:\n\n",
  // ── server.ts ──
  "  · {0} bloques actualizados":
    "  · {0} blocks updated",
  "  ⚠ no se pudo importar:":
    "  ⚠ import failed:",
  "Vincula una cuenta para compartir.":
    "Link an account to share.",
  "Falta la ruta del repositorio.":
    "The repository path is missing.",
  "Vincula una cuenta para sincronizar.":
    "Link an account to sync.",
  "Ruta desconocida: {0}":
    "Unknown route: {0}",
  "No existe la imputación {0}":
    "Entry {0} doesn't exist",
  "Esta imputación ya está facturada y no se puede editar.":
    "This entry has already been invoiced and can't be edited.",
  "No existe el proyecto \"{0}\"":
    "Project \"{0}\" doesn't exist",
  "Indica cuántos minutos":
    "Say how many minutes",
  "Tipo de trabajo desconocido: {0}":
    "Unknown kind of work: {0}",
  "El proyecto necesita un nombre":
    "The project needs a name",
  "Elige un cliente o escribe uno nuevo":
    "Pick a client or type a new one",
  "Tarifa inválida":
    "Invalid rate",
  "Cuerpo de petición demasiado grande":
    "Request body too large",
  "  Import automático cada 5 min.":
    "  Automatic import every 5 min.",
  "  Datos:  {0}\n":
    "  Data:   {0}\n",
  "  Ctrl+C para parar.\n":
    "  Ctrl+C to stop.\n",
  // ── setup.ts ──
  "Sin clasificar":
    "Unsorted",
  "No se ha podido reconstruir ninguna hora todavía.":
    "No hours could be rebuilt yet.",
  "1 día":
    "1 day",
  "{0} días":
    "{0} days",
  "1 proyecto":
    "1 project",
  "{0} proyectos":
    "{0} projects",
  "{0} reconstruidas · {1} · {2}":
    "{0} rebuilt · {1} · {2}",
  // ── sync/team.ts ──
  "Necesitas una cuenta para sincronizar. Vincúlala con:\n\n":
    "You need an account to sync. Link it with:\n\n",
  "Este proyecto no es de equipo, o le falta la invitación. Actívalo con:\n\n":
    "This project isn't a team project, or it's missing the invitation. Turn it on with:\n\n",
  "  estela team accept --token <token> --as-id {0}\n":
    "  estela team accept --token <token> --as-id {0}\n",
  // ── sync.ts ──
  "Este proyecto no sincroniza. Actívalo con:\n\n":
    "This project doesn't sync. Turn it on with:\n\n",
  "  estela sync enable --project {0}\n":
    "  estela sync enable --project {0}\n",
  // ── team.ts ──
  "Ya existe un proyecto local con el id \"{0}\". ":
    "There's already a local project with the id \"{0}\". ",
  "Elige otro con --as-id.":
    "Pick another one with --as-id.",
  "Proyectos de equipo":
    "Team projects",
  // ── updateCheck.ts ──
  "\n  ↑ Hay una versión nueva de Estela ({0}, tienes {1}).":
    "\n  ↑ There's a new version of Estela ({0}, you have {1}).",
  "    Actualiza con: npm install -g estela@latest\n":
    "    Update with: npm install -g estela@latest\n",
  // ── watchers/claude.ts ──
  "{0} de {1} registros de tipo conocido venían malformados ":
    "{0} of {1} records of a known type were malformed ",
  "Claude Code puede haber cambiado su formato: revisa los totales antes de facturar.":
    "Claude Code may have changed its format: check the totals before billing.",
};
