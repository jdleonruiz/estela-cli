/**
 * Traducciones de la terminal al inglés, con la frase en español como clave.
 * Ver i18n/index.ts.
 *
 * Una frase nueva marcada con tr`` en el código tiene que añadirse aquí, o el
 * test `i18n.test.ts` falla diciendo cuál falta. Si se cambia el texto en
 * español, cambia la clave: hay que actualizarla también.
 */
export const EN: Record<string, string> = {
  // ── server.ts (arranque del panel) ──
  "El puerto {0} ya está ocupado. Suele ser otro \"estela web\" abierto: ":
    "Port {0} is already in use. It's usually another \"estela web\" still open: ",
  "ciérralo, o abre este en otro con --port {0}.":
    "close it, or open this one elsewhere with --port {0}.",
  "No hay permiso para usar el puerto {0}. Prueba con --port {1}.":
    "No permission to use port {0}. Try --port {1}.",

  // ── watchers/agents.ts, watchers/codex.ts, cli.ts (escaneo por agente) ──
  "    {0} archivos · {1} registros":
    "    {0} files · {1} records",
  "    {0} turnos aceptados":
    "    {0} turns accepted",
  "    {0} duplicados descartados":
    "    {0} duplicates dropped",
  "    {0} registros internos ignorados · {1} malformados":
    "    {0} internal records ignored · {1} malformed",
  "    versiones: {0}":
    "    versions: {0}",
  "\n  No se han encontrado sesiones de Claude Code, Codex ni Copilot (VS Code),":
    "\n  No Claude Code, Codex or Copilot (VS Code) sessions found, and no Git",
  "  ni un repositorio de Git en esta carpeta. Corre esto de nuevo desde":
    "  repository in this folder. Run this again from inside your project,",
  "  {0} turnos · {1}":
    "  {0} turns · {1}",
  "  No se han encontrado sesiones de Claude Code, Codex ni Copilot (VS Code) —":
    "  No Claude Code, Codex or Copilot (VS Code) sessions found —",
  "  {0} turnos nuevos guardados":
    "  {0} new turns saved",
  "Codex puede haber cambiado su formato: revisa los totales antes de facturar.":
    "Codex may have changed its format: check the totals before billing.",

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
  "  dentro de tu proyecto, o trabaja un rato con tu agente y vuelve.\n":
    "  inside your project, or work with your agent for a while and come back.\n",
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
  " ({0}% de las filas)":
    " ({0}% of rows)",
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
  // ── export/invoice-pdf.ts (lo que recibe el cliente) ──
  "INFORME DE HORAS":
    "HOURS REPORT",
  "Emitido el {0}":
    "Issued {0}",
  "DE":
    "FROM",
  "PARA":
    "TO",
  "PROYECTO":
    "PROJECT",
  "PERIODO":
    "PERIOD",
  "{0}  al  {1}":
    "{0}  to  {1}",
  "1 concepto":
    "1 item",
  "VALOR":
    "VALUE",
  // ── export/panel.ts (lo que recibe el cliente) ──
  "Avance del proyecto":
    "Project progress",
  "Solo lectura":
    "Read-only",
  "En qué se fue el esfuerzo":
    "Where the effort went",
  "Detalle por día":
    "Day-by-day detail",
  "Esto es una foto del proyecto":
    "This is a snapshot of the project",
  "Se genera de la actividad real de Git y del editor, y se actualiza cuando quien lo publica lo vuelve a publicar.":
    "It is generated from real Git and editor activity, and it updates whenever whoever published it publishes it again.",
  "Verlo para un equipo":
    "See it for a team",
  "Horas rellenadas por Estela":
    "Hours filled in by Estela",
  "El grueso del trabajo fue **{0}**":
    "Most of the work went into **{0}**",
  "con **{0} entrega**":
    "with **{0} delivery**",
  "con **{0} entregas**":
    "with **{0} deliveries**",
  "y **{0} frente abierto**":
    "and **{0} open workstream**",
  "y **{0} frentes abiertos**":
    "and **{0} open workstreams**",
  "del {0} al {1}":
    "from {0} to {1}",
  "frente de trabajo":
    "workstream",
  "frentes de trabajo":
    "workstreams",
  "integrado":
    "merged",
  "en curso":
    "in progress",
  "y {0} más":
    "and {0} more",
  "{0} día de trabajo, sin commits asociados.":
    "{0} day of work, no associated commits.",
  "{0} días de trabajo, sin commits asociados.":
    "{0} days of work, no associated commits.",
  "{0} commit":
    "{0} commit",
  "{0} commits":
    "{0} commits",
  "{0} rama":
    "{0} branch",
  "{0} ramas":
    "{0} branches",
  "hasta {0}":
    "until {0}",
  "medido":
    "measured",
  "Se mide con Teams":
    "Measured with Teams",
  "tú":
    "you",
  "Horas medidas de tu equipo":
    "Measured hours for your team",
  "Las de tu gente pueden estimarse desde sus commits, pero medirlas exige que instalen Estela. Con **Teams** se miden, y dejan de ser una suposición que alguien pueda discutir.":
    "Your team's hours can be estimated from their commits, but measuring them requires them to install Estela. With **Teams** they are measured, and stop being an assumption anyone can dispute.",
  "El coste de IA se informa **por proyecto**, nunca por persona, y solo la que paga la empresa. Lo que cada cual gasta de su bolsillo es suyo.":
    "AI cost is reported **per project**, never per person, and only what the company pays for. What each person spends out of their own pocket is theirs.",
  "Ver qué incluye Teams →":
    "See what Teams includes →",
  "Equipo del proyecto":
    "Project team",
  "{0} persona con actividad. Salen de los commits del repositorio, con sus identidades de git ya unificadas.":
    "{0} person with activity. They come from the repository's commits, with their git identities already merged.",
  "{0} personas con actividad. Salen de los commits del repositorio, con sus identidades de git ya unificadas.":
    "{0} people with activity. They come from the repository's commits, with their git identities already merged.",
  "Ritmo":
    "Pace",
  "jornada típica":
    "typical day",
  "día la pausa más larga":
    "day, longest break",
  "días la pausa más larga":
    "days, longest break",
  "Pendiente de integrar":
    "Waiting to be merged",
  "Trabajo terminado que aún no está en la rama principal.":
    "Finished work that isn't on the main branch yet.",
  "hoy":
    "today",
  "ayer":
    "yesterday",
  "hace {0} d":
    "{0} d ago",
  "Dónde costó más":
    "Where it cost the most",
  "Ficheros retocados varias veces en pocos días. Suele señalar requisitos que se afinaron sobre la marcha.":
    "Files reworked several times within a few days. It usually points to requirements that were refined along the way.",
  "en {0} d":
    "in {0} d",
  "{0} día":
    "{0} day",
  "Todo":
    "All",
  "Sin actividad en este periodo.":
    "No activity in this period.",
  // ── metrics/index.ts ──
  "Trabajo general":
    "General work",
  // ── idioma de los documentos de cada cliente ──
  "español":
    "Spanish",
  "inglés":
    "English",
  "\n  Sale en {0}, el idioma de tu terminal: a este cliente no se le fijó ninguno.":
    "\n  It comes out in {0}, your terminal's language: no language was set for this client.",
  "  Para fijarlo: {0}":
    "  To set it: {0}",
  "--language admite es, en o auto, y recibí \"{0}\".":
    "--language accepts es, en or auto, and I got \"{0}\".",
  "  Sus documentos salen en {0}.":
    "  Its documents come out in {0}.",

  // ── cli.ts (gestor de tareas y tickets) ──
  "\"{0}\" usa {1}{2}.":
    "\"{0}\" uses {1}{2}.",
  "\"{0}\" no tiene gestor de tareas. Solo se reconocen AB#1234 y claves de Jira en mayúscula en la rama.":
    "\"{0}\" has no issue tracker. Only AB#1234 and uppercase Jira keys in the branch are recognised.",
  "\"{0}\" ya no tiene gestor de tareas.":
    "\"{0}\" no longer has an issue tracker.",
  "Gestor desconocido: {0}. Usa jira, azure, github, gitlab o none.":
    "Unknown tracker: {0}. Use jira, azure, github, gitlab or none.",
  "Prefijo inválido: tienen que ser letras y números, como PROJ u OPS.":
    "Invalid prefix: it has to be letters and numbers, like PROJ or OPS.",
  "Para aplicarlo a lo ya capturado:  estela import":
    "To apply it to what's already captured:  estela import",
  "No existe el bloque \"{0}\". Los ids salen con: estela entries --project <id> --ids":
    "There's no block \"{0}\". Ids are shown by: estela entries --project <id> --ids",
  "Tickets de \"{0}\" devueltos a lo que detecte el import.":
    "Tickets of \"{0}\" returned to whatever the import detects.",
  "No sé de qué gestor es \"{0}\". Escríbelo como PROJ-12, AB#1234, o configura el del proyecto con: estela project tracker":
    "I can't tell which tracker \"{0}\" belongs to. Write it as PROJ-12 or AB#1234, or set the project's with: estela project tracker",
  // ── cli.ts (export con formato y rango) ──
  "Formato desconocido: {0}. Usa csv o clockify.":
    "Unknown format: {0}. Use csv or clockify.",
  "Exportar a Clockify":
    "Exporting to Clockify",
  "Falta --email: el correo de tu cuenta de Clockify.":
    "Missing --email: your Clockify account's email.",
  "--date-format admite {0}.":
    "--date-format accepts {0}.",
  "--time-format admite 12h o 24h.":
    "--time-format accepts 12h or 24h.",
  "  {0} bloques. En Clockify: Settings → Import → Timesheets.":
    "  {0} blocks. In Clockify: Settings → Import → Timesheets.",
  "  La fecha y la hora tienen que coincidir con el formato de tu perfil de Clockify;":
    "  The date and time have to match your Clockify profile's format;",
  "  si no, repítelo con --date-format DD/MM/YYYY o --time-format 24h.":
    "  if they don't, run it again with --date-format DD/MM/YYYY or --time-format 24h.",
  "--month va como YYYY-MM.":
    "--month goes as YYYY-MM.",
  "{0} es de Pro. Vincula tu cuenta con: estela login --email tu@correo.com":
    "{0} is a Pro feature. Link your account with: estela login --email you@email.com",
  "{0} es de Pro. Actualiza con: estela upgrade --plan pro":
    "{0} is a Pro feature. Upgrade with: estela upgrade --plan pro",

  // ── watchers/copilot.ts ──
  "{0} de {1} peticiones de Copilot venían malformadas ":
    "{0} of {1} Copilot requests were malformed ",
  "VS Code puede haber cambiado su formato: revisa los totales antes de facturar.":
    "VS Code may have changed its format: check the totals before billing.",

  // ── cli.ts (setup: la estrella, una vez) ──
  "\n  ¿Te sirve? Una estrella en GitHub ayuda a que otros lo encuentren:":
    "\n  Is Estela useful? A star on GitHub helps others find it:",

  // ── cli.ts (badge) ──
  "Este directorio no es de ningún proyecto. Indica cuál con --project <id>.":
    "This directory doesn't belong to any project. Say which one with --project <id>.",
  "\"{0}\" no tiene horas medidas todavía: el badge solo cuenta las de sesiones de agente.":
    "\"{0}\" has no measured hours yet: the badge only counts hours from agent sessions.",
  "Vista previa: {0}": "Preview: {0}",
  "El coste es a tarifa API. Si pagas cuota fija, regístrala para que salga lo que pagas de verdad:":
    "That cost is at API rates. If you pay a flat subscription, add it so the badge shows what you actually pay:",
  "Es una imagen estática: para actualizar las cifras, vuelve a generarlo.":
    "It's a static image: to update the numbers, generate it again.",

  // ── cli.ts y export/receipt.ts (receipt) ──
  "Recibo guardado en {0}": "Receipt saved to {0}",
  "Sin nombres de proyectos ni ramas, para que puedas compartirlo. Con --names, se incluyen.":
    "No project or branch names, so you can share it. Add --names to include them.",
  "Se ha generado en tu máquina y no se ha enviado a ningún sitio.":
    "It was generated on your machine and hasn't been sent anywhere.",
  "RECIBO DE LA SEMANA": "RECEIPT FOR THE WEEK",
  "RECIBO DE TU HISTORIAL": "RECEIPT FOR YOUR HISTORY",
  "HORAS MEDIDAS": "MEASURED HOURS",
  "HORAS ESTIMADAS": "ESTIMATED HOURS",
  "AÑADIDAS A MANO": "ADDED BY HAND",
  "TOTAL": "TOTAL",
  "{0} MEDIDO": "{0} MEASURED",
  "COSTE DE IA": "AI COST",
  "(A TARIFA API)": "(AT API RATES)",
  "AHORRO POR CACHÉ": "SAVED BY CACHING",
  "PROYECTO MÁS CARO": "MOST EXPENSIVE PROJECT",
  "RAMA MÁS CARA": "MOST EXPENSIVE BRANCH",
  "SIN CONSUMO DE IA": "NO AI USAGE",
  "HORAS QUE NO TUVISTE QUE RELLENAR": "HOURS YOU DIDN'T HAVE TO FILL IN",
  // ── estela quota ──
  "(No se pudieron leer los transcripts de esta semana; se usa lo ya guardado.)":
    "(Couldn't read this week's transcripts; using what's already stored.)",
  "\nConsumo de cuota · lo calcula Estela en tu máquina; no es el límite de tu plan\n":
    "\nQuota usage · calculated by Estela on your machine; it isn't your plan's limit\n",
  "Sin consumo de Claude Code ni Codex esta semana.":
    "No Claude Code or Codex usage this week.",
  "Sin turnos de agente guardados. Empieza con: estela setup":
    "No agent turns stored. Start with: estela setup",
  "{0} — ventana de 5 h actual (estimada): desde las {1}, termina a las {2}":
    "{0} — current 5-hour window (estimated): from {1}, ends at {2}",
  "{0} — sin ventana de 5 h abierta ahora; la última terminó {1}.\n":
    "{0} — no 5-hour window open right now; the last one ended {1}.\n",
  "{0} — esta semana ({1} → hoy)":
    "{0} — this week ({1} → today)",
  "Copilot no guarda tokens fiables y queda fuera de este cálculo.":
    "Copilot doesn't record reliable tokens and is left out of this calculation.",
  "La ventana de 5 h es una estimación: no se publica cómo se redondea su inicio, y lo que":
    "The 5-hour window is an estimate: how its start is rounded isn't public, and anything",
  "uses en claude.ai u otro equipo también consume cuota y Estela no lo ve.":
    "you use on claude.ai or another machine also uses quota and Estela can't see it.",
  "Proyecto":
    "Project",
  "Total":
    "Total",
  "Entrada":
    "Input",
  "Salida":
    "Output",
  "Lect. caché":
    "Cache read",
  "Escr. caché":
    "Cache write",
  "sin proyecto · {0}":
    "no project · {0}",
  "sin carpeta":
    "no folder",
  "Sin historial suficiente para comparar: hacen falta {0} semanas completas y hay {1}.":
    "Not enough history to compare: it takes {0} complete weeks and there are {1}.",
  "lunes → {0} {1}":
    "Monday → {0} {1}",
  "Frente a tu historial: {0} esta semana; en el mismo tramo ({1}) de las {2} semanas anteriores no hubo consumo.":
    "Against your history: {0} this week; over the same stretch ({1}) of the previous {2} weeks there was no usage.",
  "un {0} % más":
    "{0}% more",
  "un {0} % menos":
    "{0}% less",
  "lo mismo":
    "about the same",
  "Frente a tu historial: {0} esta semana, y una media de {1} en el mismo tramo ({2}) de las {3} semanas anteriores: {4}.":
    "Against your history: {0} this week, and an average of {1} over the same stretch ({2}) of the previous {3} weeks: {4}.",
  "{0} %":
    "{0}%",
  "a las {0}":
    "at {0}",
  "el {0} a las {1}":
    "on {0} at {1}",
  // ── estela statusline ──
  "{0} no es un JSON válido. No lo toco: arréglalo y vuelve a intentarlo.":
    "{0} isn't valid JSON. I'm not touching it: fix it and try again.",
  "La status line de Estela ya está instalada en {0}.":
    "Estela's status line is already installed in {0}.",
  "Ya tienes otra status line en {0}:\n":
    "You already have another status line in {0}:\n",
  "No la toco. Elige:":
    "I won't touch it. Choose:",
  "  estela statusline install --append   enseña las dos, la de Estela primero":
    "  estela statusline install --append   show both, Estela's first",
  "  estela statusline install --force    sustituye la tuya por la de Estela":
    "  estela statusline install --force    replace yours with Estela's",
  "Copia de seguridad: {0}":
    "Backup: {0}",
  "Status line de Estela instalada, con la tuya detrás: {0}":
    "Estela's status line installed, with yours after it: {0}",
  "Status line de Estela instalada en lugar de: {0}":
    "Estela's status line installed instead of: {0}",
  "Status line de Estela instalada en {0}.":
    "Estela's status line installed in {0}.",
  "Se verá en la próxima sesión de Claude Code (o al reiniciar la actual).":
    "You'll see it in your next Claude Code session (or after restarting the current one).",
  "\nAviso: \"estela\" no está en tu PATH, así que Claude Code no podrá ejecutarla.":
    "\nWarning: \"estela\" isn't on your PATH, so Claude Code won't be able to run it.",
  "Instálala de forma global: npm install -g estela":
    "Install it globally: npm install -g estela",
  "No hay status line de Estela que quitar.":
    "There's no Estela status line to remove.",
  "La status line de {0} no es la de Estela, así que no la toco:\n\n  {1}":
    "The status line in {0} isn't Estela's, so I won't touch it:\n\n  {1}",
  "Status line de Estela quitada; vuelve a estar la que tenías: {0}":
    "Estela's status line removed; your previous one is back: {0}",
  "Status line de Estela quitada.":
    "Estela's status line removed.",
  "sin proyecto":
    "no project",
  "hoy {0}":
    "today {0}",
  "este proyecto {0} %":
    "this project {0}%",
  "semana {0} %":
    "week {0}%",
  "5 h {0} %":
    "5h {0}%",
  // ── quota: ventana oficial y --weighted ──
  "{0} — ventana de 5 h actual: desde las {1}, termina a las {2}":
    "{0} — current 5-hour window: from {1}, ends at {2}",
  "Ponderado por precio de lista; no es cómo el proveedor cuenta tu límite.":
    "Weighted by list price; this is not how the provider counts your limit.",
  "{0} turnos de modelos sin precio de lista cuentan como 0 en ese %.":
    "{0} turns from models without a list price count as 0 in that %.",
  "La ventana de 5 h es la que da Claude Code; el reparto solo incluye lo usado en esta máquina.":
    "The 5-hour window is the one Claude Code reports; the split only includes what was used on this machine.",
  // ── import: horas de subcarpetas y worktrees ──
  "\n  Sin tocar, porque ese día ya está aprobado o facturado:":
    "\n  Left alone, because that day is already approved or invoiced:",
  "    {0} · {1}: {2} recuperables. Revísalo con: estela entries --project {3}":
    "    {0} · {1}: {2} recoverable. Review it with: estela entries --project {3}",
  "  {0} imputaciones retiradas: sus horas ya estaban en otra rama del mismo día":
    "  {0} entries removed: their hours were already in another branch that day",
  "\n{0} imputaciones aprobadas o ajustadas repiten horas de otra rama. Revísalas antes de facturar:":
    "\n{0} approved or adjusted entries repeat hours from another branch. Review them before invoicing:",
  "Archiva el proyecto antes de eliminarlo.":
    "Archive the project before deleting it.",
  "El nombre no coincide: no se ha eliminado nada.":
    "The name doesn't match: nothing was deleted.",
  "Tiene horas facturadas: se puede archivar, pero no eliminar.":
    "It has invoiced hours: it can be archived, but not deleted.",
  "Está publicado o sincronizado: se puede archivar, pero no eliminar.":
    "It's published or synced: it can be archived, but not deleted.",
  "Ya hay un proyecto archivado con ese nombre: restáuralo.":
    "There's already an archived project with that name: restore it.",
  "  {0} recuperadas de sesiones en subcarpetas y worktrees":
    "  {0} recovered from sessions in subfolders and worktrees",
  "{0} (sin proyecto)":
    "{0} (no project)",
  // ── publish: resumen antes de subir, y unpublish ──
  "No se ha publicado nada. Sin terminal no se puede confirmar: añade --yes para publicar.":
    "Nothing was published. Without a terminal there's no way to confirm: add --yes to publish.",
  "¿Publicar? [s/N] ":
    "Publish? [y/N] ",
  "\nNo se ha publicado nada.":
    "\nNothing was published.",
  "{0} y {1} más":
    "{0} and {1} more",
  "\nEsto va a quedar público. Quien tenga el enlace lo ve todo:\n":
    "\nThis will become public. Anyone with the link sees all of it:\n",
  "Trabajo":
    "Work",
  "{0} días, {1} bloques, {2} mensajes de commit":
    "{0} days, {1} blocks, {2} commit messages",
  "Autores":
    "Authors",
  "Ramas":
    "Branches",
  "Ficheros":
    "Files",
  "Importes":
    "Amounts",
  "sí (--with-amounts)":
    "yes (--with-amounts)",
  "no":
    "no",
  "Clientes":
    "Clients",
  "{0} (recibirán un correo)":
    "{0} (they'll get an email)",
  "No tienes ningún panel publicado.":
    "You have no published dashboards.",
  "No se ha despublicado nada. Sin terminal no se puede confirmar: añade --yes.":
    "Nothing was unpublished. Without a terminal there's no way to confirm: add --yes.",
  "\n¿Despublicar estos {0} paneles? Los enlaces dejarán de funcionar. [s/N] ":
    "\nUnpublish these {0} dashboards? The links will stop working. [y/N] ",
  "\nNo se ha despublicado nada.":
    "\nNothing was unpublished.",
  "\n{0} paneles despublicados. Sus enlaces ya no funcionan.":
    "\n{0} dashboards unpublished. Their links no longer work.",
  "Tus paneles publicados:\n":
    "Your published dashboards:\n",
  "\nPara despublicar uno: estela unpublish <proyecto o token>. Todos: estela unpublish --all":
    "\nTo unpublish one: estela unpublish <project or token>. All of them: estela unpublish --all",
  "Panel de {0} despublicado. El enlace ya no funciona.":
    "{0} dashboard unpublished. The link no longer works.",
  "No hay ningún panel publicado de \"{0}\". Míralos con: estela unpublish":
    "There's no published dashboard for \"{0}\". See them with: estela unpublish",
  // ── ESTELA_OFFLINE ──
  "ESTELA_OFFLINE=1: Estela no se conecta a la red. Quita la variable para usar tu cuenta.":
    "ESTELA_OFFLINE=1: Estela doesn't connect to the network. Unset it to use your account.",
  // ── statusline install: VS Code ──
  "Solo en Claude Code en la terminal: la extensión de VS Code no enseña la status line.":
    "Only in Claude Code in the terminal: the VS Code extension doesn't show the status line.",
  // ── estela plan ──
  "--days tiene que ser un número entero de 1 a {0}.":
    "--days has to be a whole number from 1 to {0}.",
  "Plan desconocido: \"{0}\". Usa pro, max5 o max20.":
    "Unknown plan: \"{0}\". Use pro, max5 or max20.",
  "--since tiene que ser una fecha AAAA-MM-DD.":
    "--since has to be a YYYY-MM-DD date.",
  "Plan declarado: {0}, desde {1}. El análisis solo usa lo guardado desde esa fecha.":
    "Plan declared: {0}, since {1}. The analysis only uses what was stored from that date.",
  "Si ya lo tenías antes, indica desde cuándo: estela plan set {0} --since AAAA-MM-DD":
    "If you had it before, say since when: estela plan set {0} --since YYYY-MM-DD",
  "Ventanas de 5 h":
    "5-hour windows",
  "ninguna completa todavía":
    "none yet",
  "{0} ventanas · pico mediano {1} % · p90 {2} % · máximo {3} %":
    "{0} windows · median peak {1}% · p90 {2}% · max {3}%",
  "Topes (≥95 %)":
    "Caps (≥95%)",
  "Parado tras topes":
    "Stopped after caps",
  "hasta {0} (estimado: no sabemos si seguías trabajando)":
    "up to {0} (estimated: we don't know if you kept working)",
  "Semana":
    "Week",
  "sin datos de la semana":
    "no weekly data",
  "pico mediano {0} % · máximo {1} % · {2} semanas ≥ 90 %":
    "median peak {0}% · max {1}% · {2} weeks ≥ 90%",
  "Bloqueos (429)":
    "Blocks (429)",
  "{0} de 5 h · {1} semanales, según los transcripts de Claude Code":
    "{0} 5-hour · {1} weekly, from Claude Code's transcripts",
  "Si estuvieras en…":
    "If you were on…",
  "Datos de {0} días. La recomendación necesita al menos 14.":
    "{0} days of data. The recommendation needs at least 14.",
  "Recomendación (provisional, {0} días)":
    "Recommendation (provisional, {0} days)",
  "Recomendación":
    "Recommendation",
  "Límite semanal entre planes: Anthropic no publica la relación. No lo estimamos.":
    "Weekly limit between plans: Anthropic doesn't publish the ratio. We don't estimate it.",
  "Basado en el multiplicador por sesión publicado por Anthropic:":
    "Based on the per-session multiplier published by Anthropic:",
  "Anthropic puede cambiar los límites; repite el análisis cada mes.":
    "Anthropic may change the limits; run this again every month.",
  "Precios según la web de Anthropic a {0}; compruébalo: {1}":
    "Prices from Anthropic's website as of {0}; check them: {1}",
  "Esa fecha tiene más de {0} días: los precios pueden estar desactualizados.":
    "That date is more than {0} days old: prices may be out of date.",
  "(desde {0})":
    "(since {0})",
  "{0} días con datos":
    "{0} days with data",
  "sin topes, igual que ahora":
    "no caps, same as now",
  "p90 equivalente {0} % · habrías evitado {1} de {2} topes (con el uso que llegó a registrarse)":
    "equivalent p90 {0}% · you'd have avoided {1} of {2} caps (with the usage that got recorded)",
  "p90 equivalente {0} % · no te habría bloqueado en ninguna de las {1} ventanas":
    "equivalent p90 {0}% · wouldn't have blocked you in any of the {1} windows",
  "p90 equivalente {0} % · te habría bloqueado en {1} de {2} ventanas":
    "equivalent p90 {0}% · would have blocked you in {1} of {2} windows",
  "Vas justo con tu plan. Con {0} habrías evitado {1} de {2} topes.":
    "Your plan is tight for you. With {0} you'd have avoided {1} of {2} caps.",
  "Vas justo con tu plan.":
    "Your plan is tight for you.",
  "Con los datos de estas {0} semanas, el plan {1} te habría bastado en todas las ventanas de 5 h.":
    "Based on these {0} weeks of data, the {1} plan would have been enough in every 5-hour window.",
  "El plan {0} te habría bastado casi siempre: te habría bloqueado {1} veces en estas semanas.":
    "The {0} plan would have been enough almost always: it would have blocked you {1} times in these weeks.",
  "Tu plan actual encaja con tu uso.":
    "Your current plan fits your usage.",
  "{0} menos al mes, según la web de Anthropic a {1}; compruébalo.":
    "{0} less per month, per Anthropic's website as of {1}; check it.",
  "{0} más al mes, según la web de Anthropic a {1}; compruébalo.":
    "{0} more per month, per Anthropic's website as of {1}; check it.",
  "estela plan compara tu uso real de Claude con los otros planes. Primero dime cuál pagas:":
    "estela plan compares your real Claude usage with the other plans. First tell it which one you pay for:",
  "Si ya lo tenías antes de hoy, añade desde cuándo: --since AAAA-MM-DD":
    "If you had it before today, add since when: --since YYYY-MM-DD",
  "Este análisis solo funciona con planes Pro o Max.":
    "This analysis only works with Pro or Max plans.",
  "Aún no hay datos. Instala la status line (estela statusline install) y vuelve en unos días.":
    "No data yet. Install the status line (estela statusline install) and come back in a few days.",
  "Solo se recogen en Claude Code en la terminal: la extensión de VS Code no ejecuta la status line.":
    "They're only collected in Claude Code in the terminal: the VS Code extension doesn't run the status line.",
  "{0} $":
    "${0}",

  // ── cli.ts, metrics/spend.ts (ai-cost --by) ──
  "--by va como branch o item.": "--by takes branch or item.",
  "No existe el cliente \"{0}\".": "There's no client \"{0}\".",
  "Falta el fichero: --csv <fichero.csv>": "Missing the file: --csv <file.csv>",
  "CSV guardado en {0}": "CSV saved to {0}",
  "todo el historial": "all history",
  "rama anotada por el agente": "branch recorded by the agent",
  "rama del commit, aproximada": "commit's branch, approximate",
  "número en el nombre de la rama": "number in the branch name",
  "referencia en un commit": "reference in a commit",
  "puesto a mano": "set by hand",
  "commit de merge del PR": "the PR's merge commit",
  "Sin atribuir (sin rama)": "Unattributed (no branch)",
  "Sin atribuir (sin ticket ni PR)": "Unattributed (no ticket or PR)",
  "PR {0}": "PR {0}",
  "MR {0}": "MR {0}",
  "Coste de IA por rama": "AI cost by branch",
  "Coste de IA por ticket o PR": "AI cost by ticket or PR",
  "\nNo hay horas en ese periodo.": "\nNo hours in that period.",
  "Horas": "Hours",
  "API": "API",
  "Real": "Real",
  "ramas: {0}": "branches: {0}",
  "según: {0}": "based on: {0}",
  "\nAPI es lo que costaría a precio de API: mide el uso, no es dinero pagado.":
    "\nAPI is what it would cost at API prices: it measures usage, it isn't money paid.",
  "Real es tu cuota repartida por consumo: esto sí es dinero pagado.":
    "Real is your subscription split by usage: this is money actually paid.",
  "Sin suscripciones registradas no hay dinero real. Si pagas cuota fija: estela subscription add":
    "With no subscriptions recorded there's no real money. If you pay a flat fee: estela subscription add",
  "Lo que no se puede atribuir va a \"Sin atribuir\" y no se reparte entre lo demás.":
    "What can't be attributed goes to \"Unattributed\" and isn't spread over the rest.",
  "* Incluye trabajo con Copilot: sus horas cuentan, pero su coste no se conoce y no está sumado.":
    "* Includes Copilot work: its hours count, but its cost is unknown and not added.",
  "† Algún mes no tenía suscripción registrada: el dinero real solo cuenta los meses con cuota.":
    "† Some month had no subscription recorded: real money only counts the months with a fee.",
  "Sin gestor configurado solo se reconocen tickets inequívocos (AB#12, PROJ-12) y los PR de los merges.":
    "With no tracker set, only unambiguous tickets (AB#12, PROJ-12) and the PRs in merges are recognised.",
  "Para leer #12 y feat/12-login: estela project tracker --project <id> --system github":
    "To read #12 and feat/12-login: estela project tracker --project <id> --system github",
  "Suscripciones en monedas distintas en el periodo ({0} y {1}). ":
    "Subscriptions in different currencies in the period ({0} and {1}). ",

  // ── cli.ts (ai-cost --undelivered) ──
  "--by y --undelivered van por separado: son dos informes distintos.":
    "--by and --undelivered go separately: they're two different reports.",
  "--stale-days va como un número entero de días, 1 o más.":
    "--stale-days takes a whole number of days, 1 or more.",
  "Gasto de IA sin entrega · {0} · ramas sin fusionar tras {1} días":
    "Undelivered AI spend · {0} · branches unmerged after {1} days",
  "Es una señal para revisar, no un juicio: explorar, probar y descartar también es trabajo.":
    "It's a signal to review, not a verdict: exploring, trying and discarding is work too.",
  "\nNo hay gasto de IA en ese periodo.": "\nNo AI spend in that period.",
  "% gasto": "% spend",
  "Gasto del periodo": "Spend in the period",
  "Sesiones sin commit ({0})": "Sessions without a commit ({0})",
  "      {0} con commit después en su rama ({1}) · {2} sin commit después":
    "      {0} with a later commit on their branch ({1}) · {2} with none later",
  "      No cuentan otras {0} ({1}): son de antes de tu primer commit reconocido en el repo.":
    "      {0} more don't count ({1}): they predate your first recognised commit in the repo.",
  "Ramas sin fusionar tras {0} días ({1})": "Branches unmerged after {0} days ({1})",
  "      {0} · sin actividad hace {1} días · {2}": "      {0} · idle for {1} days · {2}",
  "      … y {0} más (--json para verlas todas)": "      … and {0} more (--json to see them all)",
  "Sin entrega en total": "Undelivered in total",
  "  No cuenta: {0} ramas abiertas hace menos de {1} días ({2}).":
    "  Not counted: {0} branches active within the last {1} days ({2}).",
  "  No cuenta: {0} ramas borradas sin merge registrado ({1}): {2}{3}":
    "  Not counted: {0} branches deleted with no recorded merge ({1}): {2}{3}",
  "\nSesión sin commit: un rato de un chat (sin pausas de más de 30 min) sin ningún commit tuyo en ese repo durante él ni en los 30 min siguientes.":
    "\nSession without a commit: a stretch of one chat (no breaks over 30 min) with no commit of yours in that repo during it or in the 30 min after.",
  "Rama sin fusionar: existe, no está integrada y lleva {0} días sin turnos ni commits. Cambia el plazo con --stale-days.":
    "Unmerged branch: it exists, isn't integrated, and has had no turns or commits for {0} days. Change the period with --stale-days.",
  "Una sesión sin commit no se cuenta otra vez en su rama. Las ramas principales (main, develop…) ya son entrega.":
    "A session without a commit isn't counted again in its branch. Main branches (main, develop…) count as delivered.",
  "API es lo que costaría a precio de API: mide el uso, no es dinero pagado. Real es tu cuota repartida por consumo.":
    "API is what it would cost at API prices: it measures usage, it isn't money paid. Real is your subscription split by usage.",
  "Antes de tu primer commit reconocido no se sabe si commiteabas con otro correo: esas sesiones no cuentan. Revisa tus correos con estela author.":
    "Before your first recognised commit there's no telling whether you committed with another email: those sessions don't count. Check your emails with estela author.",
  "Una rama borrada sin merge pudo fusionarse con squash, que no deja rastro en git: por eso no cuenta.":
    "A branch deleted with no merge may have been squash-merged, which leaves no trace in git: that's why it doesn't count.",
  "Un squash también hace que una rama que sigue existiendo parezca sin fusionar: revisa la lista antes de sacar conclusiones.":
    "A squash also makes a branch that still exists look unmerged: check the list before drawing conclusions.",
  "Incluye trabajo con Copilot: no guarda tokens, así que su coste no se conoce y no está sumado.":
    "Includes Copilot work: it doesn't store tokens, so its cost is unknown and not added.",

  // ── cli.ts (delivery, project tracker --plan-label) ──
  "Primero el gestor: estela project tracker --project {0} --system github":
    "Set the tracker first: estela project tracker --project {0} --system github",
  "Lo planificado de \"{0}\" es lo que lleva la etiqueta \"{1}\".":
    "What's planned for \"{0}\" is whatever carries the \"{1}\" label.",
  "\"{0}\" ya no tiene etiqueta de plan.":
    "\"{0}\" no longer has a plan label.",
  "Falta la etiqueta: --plan-label <etiqueta> (o none para quitarla).":
    "Missing the label: --plan-label <label> (or none to remove it).",
  "--label y --milestone van por separado: elige una forma de marcar el plan.":
    "--label and --milestone go separately: pick one way to mark the plan.",
  "Este proyecto no tiene GitHub ni GitLab como gestor, así que no se lee el plan. Para leerlo:":
    "This project uses neither GitHub nor GitLab as its tracker, so the plan isn't read. To read it:",
  "  estela project tracker --project {0} --system github|gitlab --plan-label <etiqueta>":
    "  estela project tracker --project {0} --system github|gitlab --plan-label <label>",
  "La carpeta del repo de este proyecto ya no existe: {0} no tiene dónde mirar.":
    "This project's repo folder no longer exists: {0} has nowhere to look.",
  "--offline: no se consulta {0}.":
    "--offline: {0} isn't queried.",
  "{0} ({1}), leído ahora":
    "{0} ({1}), read just now",
  "{0}, lo guardado el {1} (sin conexión)":
    "{0}, as saved on {1} (offline)",
  "glab no está instalado: sin él no se puede leer el plan de GitLab. Instálalo desde https://gitlab.com/gitlab-org/cli y ejecuta: glab auth login":
    "glab isn't installed: without it the GitLab plan can't be read. Install it from https://gitlab.com/gitlab-org/cli and run: glab auth login",
  "glab no tiene sesión iniciada. Ejecuta: glab auth login":
    "glab isn't logged in. Run: glab auth login",
  "glab no reconoce un proyecto de GitLab en la carpeta del proyecto ({0}).":
    "glab doesn't recognise a GitLab project in the project's folder ({0}).",
  "MR !{0}":
    "MR !{0}",
  "git: los PR de los commits de merge y de los squash con (#N)":
    "git: the PRs from merge commits and from squashes ending in (#N)",
  "Sin etiqueta ni milestone de plan solo se enseña lo entregado. Indícalo con --label o --milestone,":
    "With no plan label or milestone only what was delivered is shown. Set one with --label or --milestone,",
  "o déjalo fijo: estela project tracker --project {0} --plan-label <etiqueta>":
    "or keep it: estela project tracker --project {0} --plan-label <label>",
  "Con --to hace falta --from.":
    "--to needs --from.",
  "gh no está instalado: sin él no se puede leer el plan de GitHub. Instálalo desde https://cli.github.com y ejecuta: gh auth login":
    "gh isn't installed: without it the GitHub plan can't be read. Install it from https://cli.github.com and run: gh auth login",
  "gh no tiene sesión iniciada. Ejecuta: gh auth login":
    "gh isn't logged in. Run: gh auth login",
  "gh no reconoce un repo de GitHub en la carpeta del proyecto ({0}).":
    "gh doesn't recognise a GitHub repo in the project folder ({0}).",
  "sin plan":
    "no plan",
  "etiqueta \"{0}\"":
    "label \"{0}\"",
  "milestone \"{0}\"":
    "milestone \"{0}\"",
  "PR #{0}":
    "PR #{0}",
  "Planificado frente a entregado · {0} · {1} → {2}":
    "Planned versus delivered · {0} · {1} → {2}",
  "Plan: {0} · Fuente: {1}":
    "Plan: {0} · Source: {1}",
  "  (nada)":
    "  (nothing)",
  "fusionado {0}":
    "merged {0}",
  "abierto":
    "open",
  "cerrado sin fusionar":
    "closed without merging",
  "entregada por {0}":
    "delivered by {0}",
  "cerrada {0}":
    "closed {0}",
  "abierta":
    "open",
  "cerrada sin hacer":
    "closed as not done",
  "coste según: {0}":
    "cost based on: {0}",
  "rama del PR":
    "the PR's branch",
  "número en rama o commit":
    "number in a branch or commit",
  "sin horas unidas":
    "no hours linked",
  "Total del bloque":
    "Block total",
  "Planificado y entregado ({0} de {1})":
    "Planned and delivered ({0} of {1})",
  "Planificado sin entregar ({0})":
    "Planned, not delivered ({0})",
  "Entregado sin planificar ({0})":
    "Delivered, not planned ({0})",
  "Entregado ({0})":
    "Delivered ({0})",
  "\nEl coste de cada línea es el de las horas unidas a ella: la rama del PR y su número en ramas, commits o a mano.":
    "\nEach line's cost is that of the hours linked to it: the PR's branch, and its number in branches, commits or set by hand.",
  "Incluye lo trabajado antes del periodo para esa entrega. Si una hora se une a dos líneas, el total del bloque la cuenta una vez.":
    "It includes work done before the period for that delivery. If an hour is linked to two lines, the block total counts it once.",

  // ── cli.ts (delivery --by client, client alias) ──
  "Las peticiones de clientes de \"{0}\" llevan la etiqueta \"{1}<nombre>\".":
    "Client requests in \"{0}\" carry the \"{1}<name>\" label.",
  "Falta el prefijo: --client-label <prefijo> (o none para volver a \"cliente:\").":
    "Missing the prefix: --client-label <prefix> (or none to go back to \"cliente:\").",
  "Falta --label <nombre>":
    "Missing --label <name>",
  "\"{0}\" ya no apunta a ningún cliente.":
    "\"{0}\" no longer points to any client.",
  "\"{0}\" no tenía alias.":
    "\"{0}\" had no alias.",
  "Sin alias. Las etiquetas se comparan con el id y el nombre de cada cliente.":
    "No aliases. Labels are matched against each client's id and name.",
  "Hacen falta --client <id> y --label <nombre>.":
    "Both --client <id> and --label <name> are needed.",
  "La etiqueta necesita al menos una letra o un número.":
    "The label needs at least one letter or digit.",
  "La etiqueta \"{0}\" es {1}.":
    "The \"{0}\" label is {1}.",
  "--by en delivery solo admite client.":
    "--by in delivery only takes client.",
  "Sin GitHub ni GitLab no hay etiquetas: no se sabe qué pidió cada cliente, y todo va al resto.":
    "Without GitHub or GitLab there are no labels: there's no telling what each client asked for, so it all goes to the rest.",
  "Peticiones de clientes · {0} · {1} → {2}":
    "Client requests · {0} · {1} → {2}",
  "Etiqueta: \"{0}<nombre>\" · Fuente: {1}":
    "Label: \"{0}<name>\" · Source: {1}",
  "Estela no conoce ingresos ni contratos: esto solo une el gasto de IA con quién pidió el trabajo.":
    "Estela knows nothing about revenue or contracts: this only links AI spend to who asked for the work.",
  "\"{0}\" (sin mapear)":
    "\"{0}\" (unmapped)",
  "Varios: {0}":
    "Several: {0}",
  " · y {0} más":
    " · and {0} more",
  "  (ninguna petición de cliente con horas en el periodo)":
    "  (no client request with hours in the period)",
  "Resto (sin petición de cliente)":
    "Rest (no client request)",
  "Total del periodo":
    "Period total",
  "\nUna hora cuenta para quien pidió la issue o el PR al que se une (rama del PR, su número en ramas, commits o a mano).":
    "\nAn hour counts for whoever asked for the issue or PR it's linked to (the PR's branch, its number in branches, commits or set by hand).",
  "Si sirvió a peticiones de varios clientes va a \"Varios\", sin repartirla. Un PR hereda las etiquetas de las issues que cierra.":
    "If it served requests from several clients it goes to \"Several\", unsplit. A PR inherits the labels of the issues it closes.",
  "Para unir \"{0}\" con un cliente de Estela: estela client alias --client <id> --label \"{1}\"":
    "To link \"{0}\" to an Estela client: estela client alias --client <id> --label \"{1}\"",

  // ── export/finance.ts, cli.ts (summary) ──
  "--format va como md, csv o json.":
    "--format takes md, csv or json.",
  "Informe guardado en {0}":
    "Report saved to {0}",
  "# Gasto en IA · {0}":
    "# AI spend · {0}",
  "## Resumen":
    "## Summary",
  "- **Pagado en IA:** {0}, la cuota de las herramientas de IA repartida según su uso.":
    "- **Paid for AI:** {0}, the AI tools' subscription split by how it was used.",
  "- **Gasto en IA:** {0} a precio de lista. No hay cuota registrada, así que es una estimación, no lo pagado.":
    "- **AI spend:** {0} at list price. No subscription is recorded, so this is an estimate, not what was paid.",
  "1 cliente":
    "1 client",
  "{0} clientes":
    "{0} clients",
  "- **Horas de trabajo con IA:** {0} en {1} de {2}.":
    "- **Hours of AI-assisted work:** {0} across {1} for {2}.",
  "- **Fuera de proyectos:** {0} ({1}) en trabajo que no es de ningún proyecto registrado.":
    "- **Outside projects:** {0} ({1}) on work that belongs to no registered project.",
  "- **Sin entregar todavía:** {0} del gasto en proyectos. Es una señal para revisar, no un juicio: explorar y descartar también es trabajo.":
    "- **Not delivered yet:** {0} of project spend. It's a signal to review, not a verdict: exploring and discarding is work too.",
  "## Por cliente":
    "## By client",
  "| Cliente | Proyecto | Horas | Gasto | % del total |":
    "| Client | Project | Hours | Spend | % of total |",
  "| **{0}** | **total** | **{1}** | **{2}** | **{3}** |":
    "| **{0}** | **total** | **{1}** | **{2}** | **{3}** |",
  "| Fuera de proyectos | — | — | {0} | {1} |":
    "| Outside projects | — | — | {0} | {1} |",
  "| **Total** | | **{0}** | **{1}** | **100 %** |":
    "| **Total** | | **{0}** | **{1}** | **100 %** |",
  "## Qué se entregó":
    "## What was delivered",
  "Del plan ({0}) se entregaron {1} de {2}. Lo pendiente lleva {3} de gasto; lo entregado fuera del plan, {4}.":
    "Of the plan ({0}), {1} of {2} were delivered. What's pending has {3} of spend; what was delivered outside the plan, {4}.",
  "| Entrega | Horas | Gasto |":
    "| Delivery | Hours | Spend |",
  "| … y {0} más | | |":
    "| … and {0} more | | |",
  "_Fuente: {0}, leído el {1} con estela delivery._":
    "_Source: {0}, read on {1} with estela delivery._",
  "_Fuente: el historial de git (PR fusionados). Sin GitHub ni GitLab no se sabe qué estaba planificado._":
    "_Source: the git history (merged PRs). Without GitHub or GitLab there's no telling what was planned._",
  "## Trabajo pedido por clientes":
    "## Work requested by clients",
  "Qué parte del gasto fue a peticiones concretas de un cliente. No incluye ingresos ni contratos: Estela no los conoce.":
    "How much of the spend went to a client's specific requests. It includes no revenue or contracts: Estela doesn't know them.",
  "| Proyecto | Quién lo pidió | Horas | Gasto |":
    "| Project | Requested by | Hours | Spend |",
  "{0} (sin identificar)":
    "{0} (unidentified)",
  "| {0} | sin petición de cliente | {1} | {2} |":
    "| {0} | no client request | {1} | {2} |",
  "## Gasto que no ha llegado a entregarse":
    "## Spend that hasn't been delivered",
  "Trabajo que todavía no está en la versión principal del producto. Es una señal para revisar, no un juicio: explorar, probar y descartar también es trabajo, y parte llegará más adelante.":
    "Work that isn't in the main version of the product yet. It's a signal to review, not a verdict: exploring, trying and discarding is work too, and some of it will land later.",
  "| Proyecto | Sin entregar | % del proyecto | Trabajo sin consolidar | Líneas de trabajo paradas |":
    "| Project | Not delivered | % of project | Work not consolidated | Stalled lines of work |",
  "## Cómo se calcula":
    "## How it's calculated",
  "- Las herramientas de IA (Claude Code, Codex, Copilot) dejan en el ordenador un registro de cada conversación. Estela lo lee junto con git, sin enviar nada fuera.":
    "- AI tools (Claude Code, Codex, Copilot) leave a log of each conversation on the computer. Estela reads it together with git, without sending anything out.",
  "- **Gasto:** la cuota mensual de las suscripciones registradas, repartida según el uso (tokens a precio de lista) de cada proyecto ese mes. El precio de lista sirve solo para repartir: con cuota fija no es lo que se paga.":
    "- **Spend:** the monthly fee of the recorded subscriptions, split by each project's usage (tokens at list price) that month. List price is only used to split: with a flat fee it isn't what's paid.",
  "- **Gasto:** tokens a precio de lista de cada modelo. Si se paga una cuota fija, el gasto real es la cuota: regístrala con estela subscription add.":
    "- **Spend:** tokens at each model's list price. If a flat fee is paid, the real spend is the fee: record it with estela subscription add.",
  "- **Valor de uso a precio de lista:** {0} en todo el periodo.":
    "- **Usage value at list price:** {0} for the whole period.",
  "- **Horas:** el tiempo entre mensajes de cada sesión de trabajo, sin contar pausas de más de 30 minutos. Dos tareas a la vez se reparten el mismo rato.":
    "- **Hours:** the time between messages in each work session, leaving out breaks over 30 minutes. Two tasks at once share the same stretch of time.",
  "- **Entregas:** las horas se unen a una issue o un PR (una MR en GitLab) por la rama del PR y por su número en ramas o commits. Lo que no se une a nada no se reparte.":
    "- **Deliveries:** hours are linked to an issue or PR (an MR on GitLab) by the PR's branch and by its number in branches or commits. Whatever links to nothing isn't spread around.",
  "- **Sin entregar:** sesiones sin ningún commit y ramas sin fusionar tras {0} días. Lo que no se puede saber (una rama borrada que pudo fusionarse con squash) no cuenta.":
    "- **Not delivered:** sessions with no commit and branches unmerged after {0} days. What can't be known (a deleted branch that may have been squash-merged) isn't counted.",
  "- Copilot no registra tokens: sus horas cuentan, pero su coste no se conoce y no está sumado.":
    "- Copilot doesn't record tokens: its hours count, but its cost is unknown and not added.",
  "- † Algún mes no tenía cuota registrada: el importe solo cuenta los meses con cuota.":
    "- † Some month had no subscription recorded: the amount only counts the months with a fee.",
};
