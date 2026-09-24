"use strict";

/* Textos de la interfaz, en español e inglés.
 *
 * Una tabla, no dos copias de la página. La landing sí va duplicada porque es
 * texto casi sin lógica; aquí hay 1.600 líneas de comportamiento, y dos copias
 * de eso se separan en el primer arreglo que se haga en una sola.
 *
 * El idioma se decide una vez, al cargar: el que se eligió a mano (guardado en
 * el navegador) o, si no, el del navegador. Cambiarlo recarga la página: así
 * todo lo que se pinta al arrancar sale ya en el idioma nuevo, sin tener que
 * repintar cada pantalla a mano.
 *
 * Plurales: una entrada con { one, other } elige por `n`. En español y en
 * inglés basta con eso; "1 día trabajados" era justo el fallo de concatenar
 * una "s" condicional a una frase que tenía más de una palabra que concordar.
 *
 * Se carga como script normal en el navegador y con require() en los tests. */

(function (root) {
  const STORAGE_KEY = "estela.lang";
  const SUPPORTED = ["es", "en"];

  const dict = {
    es: {
      // ── Cabecera ──
      "tab.summary": "Resumen",
      "tab.day": "Mi día",
      "tab.team": "Equipo",
      "tab.reports": "Informes",
      "tab.projects": "Proyectos",
      "sync.now": "Sincronizar",
      "sync.now.title": "Sube tus horas a la nube y baja lo de tus otras máquinas",
      "sync.syncing": "Sincronizando…",
      "sync.partial": "{ok} sincronizados · {project}: {detail}",
      "sync.done": { one: "1 proyecto sincronizado", other: "{n} proyectos sincronizados" },
      "sync.none": "No hay proyectos con sync activado",
      "refresh.label": "Actualizar",
      "refresh.title": "Buscar trabajo nuevo (R)",
      "refresh.searching": "Buscando…",
      "refresh.failed": "No se pudo actualizar",
      "upgrade.btn": "Actualizar a Pro o Teams",
      "upgrade.cycle": "Ciclo de facturación",
      "upgrade.monthly": "Mensual",
      "upgrade.yearly": "Anual",
      "upgrade.saving": "Anual: 2 meses gratis",
      "upgrade.pro.monthly": "9€/mes · paneles y sync ilimitados",
      "upgrade.pro.yearly": "90€/año · paneles y sync ilimitados",
      "upgrade.teams.monthly": "10€/persona/mes · horas de equipo medidas",
      "upgrade.teams.yearly": "100€/persona/año · horas de equipo medidas",
      "upgrade.needsLogin": "Vincula tu cuenta primero: estela login --email tu@correo.com",
      "banner.more": "Ver más →",
      "banner.close": "Cerrar",
      "lang.switch": "EN",
      "lang.switch.title": "Switch to English",

      // ── Comunes ──
      "common.cancel": "Cancelar",
      "common.save": "Guardar",
      "common.showLess": "Ver menos",
      "common.perHour": "/h",
      "period.week": "Esta semana",
      "period.month": "Este mes",
      "period.quarter": "3 meses",
      "period.all": "Todo lo pendiente",
      "when.today": "hoy",
      "when.yesterday": "ayer",
      "when.daysAgo": "hace {n} días",
      "blocks": { one: "1 bloque", other: "{n} bloques" },
      "blocks.new": { one: "1 bloque nuevo", other: "{n} bloques nuevos" },
      "needsLogin.cmd": "Hace falta vincular una cuenta: estela login --email tu@correo.com",

      // ── Tipos de trabajo ──
      "kind.development": "Desarrollo",
      "kind.meeting": "Reunión",
      "kind.research": "Investigación",
      "kind.review": "Revisión",
      "kind.travel": "Desplazamiento",
      "kind.support": "Soporte",
      "kind.other": "Otro",
      "kind.employment": "nómina",
      "kind.internal": "interno",

      // ── Mi día ──
      "day.prev": "Día anterior",
      "day.next": "Día siguiente",
      "day.goToday": "Volver a hoy",
      "day.worked": "trabajadas",
      "day.recorded": "registradas",
      "day.inBlocks": { one: "en 1 bloque", other: "en {n} bloques" },
      "day.toInvoiceByCurrency": "por facturar (por moneda)",
      "day.toInvoice": "por facturar",
      "day.noRate": "sin tarifa definida",
      "day.noBillable": "sin trabajo facturable",
      "day.pending": {
        one: "Queda 1 bloque por revisar — llévame a él",
        other: "Quedan {n} bloques por revisar — llévame al primero",
      },
      "day.approve": "Aprobar el día",
      "day.emptyToday.title": "Todavía nada por aquí",
      "day.emptyToday.body": "En cuanto trabajes con un agente en un repositorio configurado, aparecerá solo. Si ya trabajaste, trae lo de hoy:",
      "day.empty.title": "Sin actividad este día",
      "day.empty.body": "No hay ningún bloque de trabajo registrado.",
      "row.manual": "añadido a mano",
      "row.fromCommits": "deducido de commits",
      "row.noRate": "sin tarifa",
      "row.notBillable": "no facturable",
      "row.ai": "Consumo de IA: <b>{amount}</b> en tarifa API equivalente.",
      "day.split": "{invoiced} ya facturadas · {pending} por facturar",
      "day.alreadyInvoiced": "+ {amount} ya facturado",
      "row.invoicedIn": "Este bloque entró en la factura {number}, así que no se puede editar.",
      "row.invoiced": "Este bloque ya está facturado, así que no se puede editar.",
      "row.billableOn": "Facturable",
      "row.billableOff": "No facturable",
      "field.what": "Qué hiciste",
      "field.project": "Proyecto",
      "field.minutes": "Minutos",
      "add.toggle": "+ Añadir horas sin código",
      "add.hint": "Desarrollo sin agente, reuniones, desplazamientos, investigación. Un import nunca las toca.",
      "add.kind": "Tipo",
      "add.whatPlaceholder": "Seguimiento semanal con el cliente",
      "add.submit": "Añadir",
      "toast.hoursAdded": "Horas añadidas",
      "toast.saved": "Guardado",
      "toast.blocksApproved": { one: "1 bloque aprobado", other: "{n} bloques aprobados" },

      // ── Resumen ──
      "summary.projects": { one: "1 proyecto con actividad", other: "{n} proyectos con actividad" },
      "summary.days": { one: "1 día trabajado", other: "{n} días trabajados" },
      "summary.value": "valor del trabajo",
      "summary.valueByCurrency": "valor del trabajo (por moneda)",
      "summary.kpiHours": "horas registradas",
      "summary.kpiBillable": "de ellas facturables",
      "summary.kpiPending": { one: "bloque por revisar", other: "bloques por revisar" },
      "summary.kpiAi": "consumo de IA",
      "summary.empty.title": "Sin actividad en este periodo",
      "summary.empty.body": "Prueba con un rango más amplio, o comprueba que tus repositorios estén asignados a un proyecto.",
      "summary.approveAll": "Hay <b>{n}</b> bloques de trabajo <b>tuyo</b> sin revisar en este periodo. Al configurar un proyecto entra de golpe todo su histórico. Pulsa el aviso de cada proyecto para ir a ellos.",
      "summary.approveAll.btn": "Aprobar el periodo",
      "summary.activity": "Actividad reciente",
      "summary.nothingLeft": "Ya no queda nada por revisar ahí",
      "summary.pendingHere": "{blocks} por revisar aquí · {more}",
      "summary.moreDays": { one: "1 día más con pendientes", other: "{n} días más con pendientes" },
      "summary.lastPending": "{blocks} por revisar — es el último día pendiente",
      "project.pendingTag": "{n} por revisar →",
      "project.pendingTitle": "Ir al día más reciente con bloques sin revisar",
      "project.days": { one: "1 día", other: "{n} días" },
      "project.lastSeen": "última vez {date}",

      // ── Equipo ──
      "team.people": { one: "1 persona", other: "{n} personas" },
      "team.activeDays": { one: "1 día con actividad", other: "{n} días con actividad" },
      "team.allProjects": "Todos los proyectos",
      "team.byProject": "Por proyecto",
      "team.th.project": "Proyecto",
      "team.th.composition": "Composición",
      "team.th.hours": "Horas",
      "team.th.aiCost": "Coste IA",
      "team.th.value": "Valor",
      "team.th.status": "Estado",
      "team.th.person": "Persona",
      "team.th.precision": "Precisión",
      "team.th.branches": "Ramas",
      "team.th.lastSeen": "Última vez",
      "team.legend.agent": "medido con agente",
      "team.legend.commit": "estimado de commits",
      "team.legend.manual": "anotado a mano",
      "team.peopleTitle": "Personas",
      "team.byRecent": "por actividad reciente",
      "team.note": "Las horas de tus compañeros se estiman desde sus commits y <b>no entran</b> en los totales de arriba, que cuentan solo tu trabajo imputado. Si alguien instala Estela, su fila pasa a medida.",
      "team.showMore": { one: "Ver 1 persona más", other: "Ver {n} personas más" },
      "team.empty.body": "Prueba con un rango más amplio.",
      "team.alert.budgetOver": "{project} ha superado su presupuesto de IA",
      "team.alert.budgetNear": "{project} ha consumido el {pct}% de su presupuesto de IA",
      "team.alert.budgetDetail": "{spent} de {budget} en este periodo.",
      "team.alert.stale": {
        one: "1 rama sin integrar desde hace más de dos semanas",
        other: "{n} ramas sin integrar desde hace más de dos semanas",
      },
      "team.alert.staleDetail": "La más antigua, {name}, lleva {days} días. Puede ser trabajo parado o una revisión pendiente en el otro lado.",
      "team.alert.pending": { one: "1 bloque sin revisar", other: "{n} bloques sin revisar" },
      "team.alert.pendingDetail": "Hasta revisarlos no deberían salir en un informe.",
      "team.kpi.hours": "horas del periodo",
      "team.kpi.delta": "{delta} frente al periodo anterior",
      "team.kpi.noPrevious": "sin periodo anterior con el que comparar",
      "team.kpi.aiCost": "coste de IA",
      "team.kpi.perHour": "{amount} por hora trabajada",
      "team.kpi.billable": "facturable",
      "team.kpi.ofTotal": "{part} de {total}",
      "team.kpi.unmerged": { one: "rama sin integrar", other: "ramas sin integrar" },
      "team.kpi.oldest": "la más antigua, {n} días",
      "team.kpi.allMerged": "todo integrado",
      "team.composition": "agente {agent} · commits {commit} · a mano {manual}",
      "team.status.pending": "por revisar",
      "team.status.ready": "listo",
      "team.you": "tú",
      "team.measured": "medido",
      "team.estimated": "estimado",

      // ── Proyectos ──
      "projects.sub": "Qué repositorios pertenecen a quién y a qué tarifa. Subir un precio no reescribe lo ya trabajado: la tarifa nueva empieza el día que digas.",
      "projects.stale.head": {
        one: "Un panel compartido está desactualizado.",
        other: "{n} paneles están desactualizados.",
      },
      "projects.stale.body": "Tu cliente está viendo datos anteriores a tu último trabajo. Esto no tiene que ver con los bloques por revisar: aquí solo salen los proyectos que has compartido, y cuenta lo que cambió desde que lo publicaste, no lo que te falta por aprobar.",
      "projects.stale.item": "{name} — {blocks} desde que lo publicaste {when}",
      "projects.stale.fix": "Pulsa <b>Actualizar lo compartido</b> en cada uno para volver a subirlo.",
      "projects.meta": "{client} · {duration} en {blocks}",
      "projects.noRepo": "Sin repositorio: no se le imputa nada todavía.",
      "projects.orphanOption": "{name} — {turns} turnos, hasta {last}",
      "projects.link": "Vincular",
      "projects.noOrphans": "No hemos detectado ningún repositorio sin asignar. Trabaja un rato con tu agente y vuelve, o vincúlalo con <code>estela team repo --project {id} --add &lt;ruta&gt;</code>.",
      "projects.empty.title": "Todavía no hay proyectos",
      "projects.empty.body": "Crea el primero abajo y asígnale el repositorio donde trabajas.",
      "projects.orphanMeta": "{turns} turnos · hasta {last}",
      "share.update": "Actualizar lo compartido",
      "share.share": "Compartir con el cliente",
      "share.hintNew": "Genera un panel de solo lectura con enlace no adivinable.",
      "share.hintStale": "<b class=\"stale-mark\">{blocks}</b> desde que lo publicaste.",
      "share.hintFresh": "Publicado {when} · al día.",
      "share.message": "Te comparto el avance del proyecto: {url}",
      "share.subject": "Avance del proyecto",
      "share.copy": "Copiar enlace",
      "share.email": "Correo",
      "share.byEmail": "O dáselo por su correo y se lo mandamos nosotros — además le aparece en su cuenta",
      "share.emailsPlaceholder": "cliente@empresa.com, otro@empresa.com",
      "share.hasAccount": "<b>ya tiene cuenta</b>, lo ve al entrar",
      "share.notYet": "aún no ha entrado en getestela.dev/app",
      "rate.changeTo": "Cambiar tarifa a",
      "rate.historyItem": "{amount}/h desde {date}",
      "rate.from": "{currency}/h desde",
      "newProject.title": "Nuevo proyecto",
      "newProject.orphans": {
        one: "Tienes 1 repositorio con trabajo capturado y sin proyecto. Son horas que ya registraste pero todavía no puedes informar. Púlsalo para empezar:",
        other: "Tienes {n} repositorios con trabajo capturado y sin proyecto. Son horas que ya registraste pero todavía no puedes informar. Pulsa uno para empezar:",
      },
      "newProject.repo": "Repositorio",
      "newProject.pickRepo": "— elegir uno de los detectados —",
      "newProject.name": "Nombre del proyecto",
      "newProject.namePlaceholder": "App de Acme",
      "newProject.rate": "Tarifa por hora",
      "newProject.client": "Cliente existente",
      "newProject.newClientOption": "— cliente nuevo —",
      "newProject.newClient": "…o cliente nuevo",
      "newProject.clientPlaceholder": "Acme S.L.",
      "newProject.currency": "Moneda",
      "newProject.submit": "Crear proyecto",
      "newProject.note": "Tras crear el proyecto, ejecuta <code>estela import</code> para que el trabajo ya capturado de ese repositorio se impute.",
      "author.ask": "¿Con cuál de estos correos commiteas tú en este repositorio? Si eliges mal, se capturarán los commits de otra persona.",
      "toast.identitySaved": "Identidad guardada — ejecuta estela import",
      "toast.projectCreated": "Proyecto creado",
      "toast.linkedImporting": "Vinculado · importando, aparecerá en unos segundos",
      "toast.linkedBlocks": "Vinculado · {blocks} imputados",
      "toast.repoLinked": "Repositorio vinculado",
      "toast.linkCopied": "Enlace copiado",
      "toast.copyFailed": "No se pudo copiar",
      "toast.sharedByEmail": "Compartido — le llega un correo",
      "toast.sharedWithNobody": "Ya no se comparte con nadie",
      "toast.linkedToAccount": "Vinculado a tu cuenta",
      "toast.enterRate": "Escribe una tarifa",
      "toast.rateSaved": "Tarifa guardada — lo ya trabajado conserva la anterior",
      "publish.linked": "Panel vinculado",
      "publish.published": "Panel publicado",
      "publish.link": "Enlace:",
      "publish.noPassword": "Quien tenga el enlace, entra: no hay contraseña.",
      "publish.needsLogin.title": "Hace falta vincular una cuenta",
      "publish.needsLogin.why": "Publicar aloja el panel en getestela.dev, y eso exige sesión:",
      "publish.needsLogin.cmd": "estela login --email tu@correo.com",
      "publish.needsLogin.once": "Se ejecuta una vez, en la terminal. Luego vuelve a pulsar aquí.",

      // ── Informes ──
      "reports.sub": "Respaldo del trabajo hecho: horas y commits, para adjuntar a tu factura o compartir con quien dirige el proyecto.",
      "reports.outside": "Hay además <b>{duration}</b> pendientes fuera de este periodo, en {blocks}. Pulsa <b>{all}</b> para incluirlos.",
      "reports.empty.title": "Nada que informar todavía",
      "reports.empty.body": "Aquí aparecerán los proyectos con horas aprobadas y sin informar.",
      "reports.search": "Buscar proyecto o cliente…",
      "adjust.reasonLabel": "Motivo del cambio",
      "adjust.reasonPlaceholder": "Reunión con el cliente, investigación…",
      "adjust.save": "Guardar ajuste",
      "adjust.cancel": "Cancelar",
      "adjust.shown": "{measured} medidas · ajustado a {adjusted}",
      "adjust.clear": "Quitar el ajuste",
      "reports.allbilled.title": "Todo facturado",
      "reports.allbilled.body": "No queda nada pendiente en este periodo. Lo ya emitido está abajo, y se puede volver a descargar.",
      "invoices.title": "Ya facturado",
      "invoices.note": "Se reimprime tal y como se emitió: los importes y el reparto de IA quedaron congelados ese día.",
      "invoices.upto": "Hasta el {date}",
      "invoices.download": "Descargar",
      "reports.noMatch": "Ningún proyecto coincide con «{q}».",
      "reports.client": "{client} · {blocks} · todo lo pendiente desde {date}",
      "reports.from": "Desde",
      "reports.to": "Hasta",
      "reports.author": "Tu nombre",
      "reports.authorPlaceholder": "Ana García",
      "reports.amounts": "Incluir importes",
      "reports.download": "Descargar informe",
      "reports.cutoff": "Cortar hasta esta fecha y facturar",
      "reports.cutoff.confirm": "Esto marca como facturadas todas las horas de \"{project}\" hasta el {date}. No se puede deshacer desde aquí. ¿Seguro?",
      "toast.invoiced": "Facturado — descargando el PDF",
      "reports.more": { one: "Ver 1 proyecto más", other: "Ver {n} proyectos más" },
      "reports.note": "El informe recoge horas y commits. No es una factura: Estela no emite documentos fiscales, adjunta este respaldo a la tuya.",
      "toast.reportDownloaded": "Informe descargado",
    },

    en: {
      // ── Header ──
      "tab.summary": "Summary",
      "tab.day": "My day",
      "tab.team": "Team",
      "tab.reports": "Reports",
      "tab.projects": "Projects",
      "sync.now": "Sync",
      "sync.now.title": "Upload your hours and pull in what your other machines recorded",
      "sync.syncing": "Syncing…",
      "sync.partial": "{ok} synced · {project}: {detail}",
      "sync.done": { one: "1 project synced", other: "{n} projects synced" },
      "sync.none": "No projects have sync enabled",
      "refresh.label": "Refresh",
      "refresh.title": "Look for new work (R)",
      "refresh.searching": "Looking…",
      "refresh.failed": "Couldn't refresh",
      "upgrade.btn": "Upgrade to Pro or Teams",
      "upgrade.cycle": "Billing cycle",
      "upgrade.monthly": "Monthly",
      "upgrade.yearly": "Yearly",
      "upgrade.saving": "Yearly: 2 months free",
      "upgrade.pro.monthly": "$9/month · unlimited panels and sync",
      "upgrade.pro.yearly": "$90/year · unlimited panels and sync",
      "upgrade.teams.monthly": "$10/person/month · measured team hours",
      "upgrade.teams.yearly": "$100/person/year · measured team hours",
      "upgrade.needsLogin": "Link your account first: estela login --email you@example.com",
      "banner.more": "Learn more →",
      "banner.close": "Close",
      "lang.switch": "ES",
      "lang.switch.title": "Cambiar a español",

      // ── Common ──
      "common.cancel": "Cancel",
      "common.save": "Save",
      "common.showLess": "Show less",
      "common.perHour": "/h",
      "period.week": "This week",
      "period.month": "This month",
      "period.quarter": "3 months",
      "period.all": "Everything pending",
      "when.today": "today",
      "when.yesterday": "yesterday",
      "when.daysAgo": "{n} days ago",
      "blocks": { one: "1 block", other: "{n} blocks" },
      "blocks.new": { one: "1 new block", other: "{n} new blocks" },
      "needsLogin.cmd": "You need to link an account: estela login --email you@example.com",

      // ── Kinds of work ──
      "kind.development": "Development",
      "kind.meeting": "Meeting",
      "kind.research": "Research",
      "kind.review": "Review",
      "kind.travel": "Travel",
      "kind.support": "Support",
      "kind.other": "Other",
      "kind.employment": "payroll",
      "kind.internal": "internal",

      // ── My day ──
      "day.prev": "Previous day",
      "day.next": "Next day",
      "day.goToday": "Back to today",
      "day.worked": "worked",
      "day.recorded": "recorded",
      "day.inBlocks": { one: "in 1 block", other: "in {n} blocks" },
      "day.toInvoiceByCurrency": "to invoice (by currency)",
      "day.toInvoice": "to invoice",
      "day.noRate": "no rate set",
      "day.noBillable": "no billable work",
      "day.pending": {
        one: "1 block left to review — take me there",
        other: "{n} blocks left to review — take me to the first",
      },
      "day.approve": "Approve the day",
      "day.emptyToday.title": "Nothing here yet",
      "day.emptyToday.body": "As soon as you work with an agent in a configured repository, it shows up on its own. If you've already worked, pull in today's work:",
      "day.empty.title": "No activity on this day",
      "day.empty.body": "No work blocks recorded.",
      "row.manual": "added by hand",
      "row.fromCommits": "inferred from commits",
      "row.noRate": "no rate",
      "row.notBillable": "not billable",
      "row.ai": "AI usage: <b>{amount}</b> at equivalent API pricing.",
      "day.split": "{invoiced} already invoiced · {pending} to invoice",
      "day.alreadyInvoiced": "+ {amount} already invoiced",
      "row.invoicedIn": "This block went into invoice {number}, so it can't be edited.",
      "row.invoiced": "This block has already been invoiced, so it can't be edited.",
      "row.billableOn": "Billable",
      "row.billableOff": "Not billable",
      "field.what": "What you did",
      "field.project": "Project",
      "field.minutes": "Minutes",
      "add.toggle": "+ Add hours without code",
      "add.hint": "Development without an agent, meetings, travel, research. An import never touches them.",
      "add.kind": "Type",
      "add.whatPlaceholder": "Weekly check-in with the client",
      "add.submit": "Add",
      "toast.hoursAdded": "Hours added",
      "toast.saved": "Saved",
      "toast.blocksApproved": { one: "1 block approved", other: "{n} blocks approved" },

      // ── Summary ──
      "summary.projects": { one: "1 project with activity", other: "{n} projects with activity" },
      "summary.days": { one: "1 day worked", other: "{n} days worked" },
      "summary.value": "value of work",
      "summary.valueByCurrency": "value of work (by currency)",
      "summary.kpiHours": "hours recorded",
      "summary.kpiBillable": "of which billable",
      "summary.kpiPending": { one: "block to review", other: "blocks to review" },
      "summary.kpiAi": "AI usage",
      "summary.empty.title": "No activity in this period",
      "summary.empty.body": "Try a wider range, or check that your repositories are assigned to a project.",
      "summary.approveAll": "There are <b>{n}</b> blocks of <b>your</b> work unreviewed in this period. Setting up a project brings in its whole history at once. Click each project's notice to go to them.",
      "summary.approveAll.btn": "Approve the period",
      "summary.activity": "Recent activity",
      "summary.nothingLeft": "Nothing left to review there",
      "summary.pendingHere": "{blocks} to review here · {more}",
      "summary.moreDays": { one: "1 more day with pending blocks", other: "{n} more days with pending blocks" },
      "summary.lastPending": "{blocks} to review — this is the last pending day",
      "project.pendingTag": "{n} to review →",
      "project.pendingTitle": "Go to the most recent day with unreviewed blocks",
      "project.days": { one: "1 day", other: "{n} days" },
      "project.lastSeen": "last {date}",

      // ── Team ──
      "team.people": { one: "1 person", other: "{n} people" },
      "team.activeDays": { one: "1 day with activity", other: "{n} days with activity" },
      "team.allProjects": "All projects",
      "team.byProject": "By project",
      "team.th.project": "Project",
      "team.th.composition": "Composition",
      "team.th.hours": "Hours",
      "team.th.aiCost": "AI cost",
      "team.th.value": "Value",
      "team.th.status": "Status",
      "team.th.person": "Person",
      "team.th.precision": "Precision",
      "team.th.branches": "Branches",
      "team.th.lastSeen": "Last seen",
      "team.legend.agent": "measured with an agent",
      "team.legend.commit": "estimated from commits",
      "team.legend.manual": "logged by hand",
      "team.peopleTitle": "People",
      "team.byRecent": "by recent activity",
      "team.note": "Your teammates' hours are estimated from their commits and <b>aren't included</b> in the totals above, which count only your own assigned work. If someone installs Estela, their row becomes measured.",
      "team.showMore": { one: "Show 1 more person", other: "Show {n} more people" },
      "team.empty.body": "Try a wider range.",
      "team.alert.budgetOver": "{project} has gone over its AI budget",
      "team.alert.budgetNear": "{project} has used {pct}% of its AI budget",
      "team.alert.budgetDetail": "{spent} of {budget} in this period.",
      "team.alert.stale": {
        one: "1 branch unmerged for more than two weeks",
        other: "{n} branches unmerged for more than two weeks",
      },
      "team.alert.staleDetail": "The oldest, {name}, has been open for {days} days. It may be stalled work or a review waiting on the other side.",
      "team.alert.pending": { one: "1 unreviewed block", other: "{n} unreviewed blocks" },
      "team.alert.pendingDetail": "Until they're reviewed, they shouldn't go into a report.",
      "team.kpi.hours": "hours this period",
      "team.kpi.delta": "{delta} vs. the previous period",
      "team.kpi.noPrevious": "no previous period to compare with",
      "team.kpi.aiCost": "AI cost",
      "team.kpi.perHour": "{amount} per hour worked",
      "team.kpi.billable": "billable",
      "team.kpi.ofTotal": "{part} of {total}",
      "team.kpi.unmerged": { one: "unmerged branch", other: "unmerged branches" },
      "team.kpi.oldest": "oldest: {n} days",
      "team.kpi.allMerged": "everything merged",
      "team.composition": "agent {agent} · commits {commit} · by hand {manual}",
      "team.status.pending": "to review",
      "team.status.ready": "ready",
      "team.you": "you",
      "team.measured": "measured",
      "team.estimated": "estimated",

      // ── Projects ──
      "projects.sub": "Which repositories belong to whom, and at what rate. Raising a price doesn't rewrite past work: the new rate starts on the day you choose.",
      "projects.stale.head": {
        one: "One shared panel is out of date.",
        other: "{n} shared panels are out of date.",
      },
      "projects.stale.body": "Your client is looking at data from before your latest work. This has nothing to do with blocks to review: only projects you've shared show up here, and it counts what changed since you published, not what you still have to approve.",
      "projects.stale.item": "{name} — {blocks} since you published it {when}",
      "projects.stale.fix": "Click <b>Update shared panel</b> on each one to upload it again.",
      "projects.meta": "{client} · {duration} in {blocks}",
      "projects.noRepo": "No repository: nothing is assigned to it yet.",
      "projects.orphanOption": "{name} — {turns} turns, until {last}",
      "projects.link": "Link",
      "projects.noOrphans": "We haven't detected any unassigned repository. Work with your agent for a while and come back, or link it with <code>estela team repo --project {id} --add &lt;path&gt;</code>.",
      "projects.empty.title": "No projects yet",
      "projects.empty.body": "Create the first one below and assign it the repository you work in.",
      "projects.orphanMeta": "{turns} turns · until {last}",
      "share.update": "Update shared panel",
      "share.share": "Share with the client",
      "share.hintNew": "Creates a read-only panel with an unguessable link.",
      "share.hintStale": "<b class=\"stale-mark\">{blocks}</b> since you published it.",
      "share.hintFresh": "Published {when} · up to date.",
      "share.message": "Here's the progress on the project: {url}",
      "share.subject": "Project progress",
      "share.copy": "Copy link",
      "share.email": "Email",
      "share.byEmail": "Or give us their email and we'll send it — it also shows up in their account",
      "share.emailsPlaceholder": "client@company.com, another@company.com",
      "share.hasAccount": "<b>already has an account</b>, sees it when signing in",
      "share.notYet": "hasn't signed in to getestela.dev/app yet",
      "rate.changeTo": "Change rate to",
      "rate.historyItem": "{amount}/h from {date}",
      "rate.from": "{currency}/h from",
      "newProject.title": "New project",
      "newProject.orphans": {
        one: "You have 1 repository with captured work and no project. Those are hours you've already recorded but can't report yet. Click it to start:",
        other: "You have {n} repositories with captured work and no project. Those are hours you've already recorded but can't report yet. Click one to start:",
      },
      "newProject.repo": "Repository",
      "newProject.pickRepo": "— pick one of the detected ones —",
      "newProject.name": "Project name",
      "newProject.namePlaceholder": "Acme app",
      "newProject.rate": "Hourly rate",
      "newProject.client": "Existing client",
      "newProject.newClientOption": "— new client —",
      "newProject.newClient": "…or new client",
      "newProject.clientPlaceholder": "Acme Inc.",
      "newProject.currency": "Currency",
      "newProject.submit": "Create project",
      "newProject.note": "After creating the project, run <code>estela import</code> so the work already captured from that repository gets assigned.",
      "author.ask": "Which of these emails do you commit with in this repository? Pick the wrong one and you'll capture someone else's commits.",
      "toast.identitySaved": "Identity saved — run estela import",
      "toast.projectCreated": "Project created",
      "toast.linkedImporting": "Linked · importing, it'll show up in a few seconds",
      "toast.linkedBlocks": "Linked · {blocks} assigned",
      "toast.repoLinked": "Repository linked",
      "toast.linkCopied": "Link copied",
      "toast.copyFailed": "Couldn't copy",
      "toast.sharedByEmail": "Shared — they'll get an email",
      "toast.sharedWithNobody": "No longer shared with anyone",
      "toast.linkedToAccount": "Linked to your account",
      "toast.enterRate": "Enter a rate",
      "toast.rateSaved": "Rate saved — past work keeps the previous one",
      "publish.linked": "Panel linked",
      "publish.published": "Panel published",
      "publish.link": "Link:",
      "publish.noPassword": "Anyone with the link can get in: there's no password.",
      "publish.needsLogin.title": "You need to link an account",
      "publish.needsLogin.why": "Publishing hosts the panel on getestela.dev, which requires signing in:",
      "publish.needsLogin.cmd": "estela login --email you@example.com",
      "publish.needsLogin.once": "You only run it once, in the terminal. Then click here again.",

      // ── Reports ──
      "reports.sub": "Evidence of the work done: hours and commits, to attach to your invoice or share with whoever runs the project.",
      "reports.outside": "There's also <b>{duration}</b> pending outside this period, in {blocks}. Click <b>{all}</b> to include it.",
      "reports.empty.title": "Nothing to report yet",
      "reports.empty.body": "Projects with approved, unreported hours will show up here.",
      "reports.search": "Search project or client…",
      "adjust.reasonLabel": "Reason for the change",
      "adjust.reasonPlaceholder": "Client meeting, research…",
      "adjust.save": "Save adjustment",
      "adjust.cancel": "Cancel",
      "adjust.shown": "{measured} measured · adjusted to {adjusted}",
      "adjust.clear": "Remove adjustment",
      "reports.allbilled.title": "All invoiced",
      "reports.allbilled.body": "Nothing pending in this period. What you already issued is below, and can be downloaded again.",
      "invoices.title": "Already invoiced",
      "invoices.note": "Reprinted exactly as issued: amounts and the AI split were frozen that day.",
      "invoices.upto": "Up to {date}",
      "invoices.download": "Download",
      "reports.noMatch": "No project matches “{q}”.",
      "reports.client": "{client} · {blocks} · everything pending since {date}",
      "reports.from": "From",
      "reports.to": "To",
      "reports.author": "Your name",
      "reports.authorPlaceholder": "Jane Doe",
      "reports.amounts": "Include amounts",
      "reports.download": "Download report",
      "reports.cutoff": "Cut off through this date and invoice",
      "reports.cutoff.confirm": "This marks all hours for \"{project}\" through {date} as invoiced. It can't be undone from here. Are you sure?",
      "toast.invoiced": "Invoiced — downloading the PDF",
      "reports.more": { one: "Show 1 more project", other: "Show {n} more projects" },
      "reports.note": "The report covers hours and commits. It isn't an invoice: Estela doesn't issue tax documents, so attach it as backup to your own.",
      "toast.reportDownloaded": "Report downloaded",
    },
  };

  /** El idioma guardado a mano gana; si no hay, el del navegador; si no, inglés. */
  function detectLang(stored, navigatorLangs) {
    if (SUPPORTED.includes(stored)) return stored;
    for (const tag of navigatorLangs || []) {
      const base = String(tag).toLowerCase().split("-")[0];
      if (SUPPORTED.includes(base)) return base;
    }
    return "en";
  }

  let lang = "es";

  /**
   * Texto de una clave, con sus variables sustituidas.
   *
   * Una clave que falta en inglés cae al español en vez de enseñar la clave
   * pelada: mejor una frase en el otro idioma que "team.kpi.oldest" en
   * pantalla. El test comprueba que no falte ninguna, así que esto es solo la
   * red de seguridad.
   */
  function t(key, vars) {
    let entry = dict[lang][key];
    if (entry === undefined) entry = dict.es[key];
    if (entry === undefined) return key;
    if (typeof entry === "object") {
      entry = vars && Number(vars.n) === 1 ? entry.one : entry.other;
    }
    return entry.replace(/\{(\w+)\}/g, (m, name) =>
      vars && vars[name] !== undefined ? String(vars[name]) : m);
  }

  function setLang(next) {
    lang = SUPPORTED.includes(next) ? next : "es";
    return lang;
  }

  function getLang() { return lang; }

  /**
   * Traduce lo que viene escrito en el HTML de partida.
   *
   *   data-i18n="clave"               → el texto del elemento
   *   data-i18n-title / -aria-label / -placeholder → ese atributo
   *   data-i18n-monthly / -yearly     → los data-monthly/yearly del menú de planes
   */
  function applyStatic(doc) {
    doc.documentElement.lang = lang;
    doc.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
    for (const attr of ["title", "aria-label", "placeholder"]) {
      doc.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
        el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
      });
    }
    doc.querySelectorAll("[data-i18n-monthly]").forEach((el) => {
      el.dataset.monthly = t(el.dataset.i18nMonthly);
      el.dataset.yearly = t(el.dataset.i18nYearly);
    });
  }

  const api = { dict, SUPPORTED, detectLang, t, setLang, getLang, applyStatic };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  // En el navegador: decidir el idioma, avisar a lib.js para fechas e
  // importes, y traducir la página de partida antes de que app.js pinte nada.
  let stored = null;
  try { stored = root.localStorage.getItem(STORAGE_KEY); } catch { /* sin almacenamiento */ }
  setLang(detectLang(stored, root.navigator && root.navigator.languages));
  if (typeof root.setLocale === "function") root.setLocale(lang);

  // `tr` y no `t` en la página: app.js usa `t` como nombre de variable en
  // varias funciones (`const t = state.team`), y ahí taparía a esta.
  Object.assign(root, { tr: t, getLang });
  root.switchLang = function switchLang() {
    const next = lang === "es" ? "en" : "es";
    try { root.localStorage.setItem(STORAGE_KEY, next); } catch { /* sin almacenamiento */ }
    root.location.reload();
  };

  applyStatic(root.document);
})(typeof globalThis !== "undefined" ? globalThis : this);
