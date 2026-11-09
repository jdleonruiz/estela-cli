# Changelog

Cambios visibles de cada versión del paquete `estela`. Las anteriores a la
0.2.0 están en el historial de git, con una etiqueta por versión en
[github.com/jdleonruiz/estela-cli](https://github.com/jdleonruiz/estela-cli/tags).

## 0.4.2 — 2026-11-09

### Nuevo
- **`estela project list`.** Tus proyectos con su id, que es lo que piden todos
  los `--project`, junto a su cliente, su gestor de tareas y sus repos. Los
  archivados salen aparte. Hasta ahora el id solo se veía al crear el proyecto.

### Cambiado
- **Los dólares de la IA, con los separadores de tu idioma.** En español el
  coste a precio de API salía con punto ("$12.86") y la cuota con coma
  ("$71,67"), a veces en la misma tabla. Ahora todo sale con coma en español y
  con punto en inglés, igual que en el panel. También el presupuesto de IA y el
  recibo compartible. El CSV no cambia: lleva números sin formato.

### Corregido
- **`ESTELA_OFFLINE=1` también apaga `gh` y `glab`.** Prometía "ninguna
  conexión de red", pero `estela delivery` solo hacía caso a `--offline` y
  seguía consultando GitHub o GitLab. Ahora no los llama y usa lo guardado. La
  ayuda, los README y la página de privacidad cuentan esa conexión, que faltaba
  en la lista desde la 0.4.0.
- **`--month` acaba el último día real del mes.** Noviembre salía como
  "2026-11-01 → 2026-11-31". Las cifras eran las mismas, pero la fecha se veía
  en pantalla y en el informe, y se mandaba así a la búsqueda de GitHub.
- **GitLab propio sin sesión: ahora se dice en qué servidor.** Con sesión de
  `glab` en gitlab.com y el repo en un GitLab de empresa, `estela delivery`
  decía "(ERROR  )". Ahora dice "glab no tiene sesión en gitlab.tuempresa.com"
  y da el comando exacto: `glab auth login --hostname gitlab.tuempresa.com`.

## 0.4.1 — 2026-11-07

### Nuevo
- **GitLab en `estela delivery`.** Con `--system gitlab`, lo planificado frente
  a lo entregado, lo pedido por cada cliente y el informe de `estela summary`
  salen de GitLab, leído con `glab` (también en un servidor propio). Como con
  GitHub, es la única llamada fuera de tu máquina, `--offline` la evita, y sin
  `glab` se explica y se usa lo guardado o lo que dice git. GitLab no distingue
  una issue cerrada hecha de una cerrada sin hacer: cerrada cuenta como
  entregada, salvo si se movió a otro proyecto. Qué issues cierra una MR se lee
  de su descripción ("Closes #12").

### Corregido
- **El Resumen del panel ya cuadra a la vista con Informes.** Cada proyecto dice
  ahora qué parte de lo trabajado en el periodo ya está facturada (y en qué
  factura) y cuánto falta por facturar, con la misma cifra que da Informes. Y
  la cabecera lleva las fechas del periodo.
- **Resumen e Informes ya no comparten periodo.** Elegir "Todo lo pendiente" en
  Informes cambiaba en silencio el Resumen a 3 meses, con "Este mes" todavía
  marcado.
- **Las merge requests de GitLab ya no se confunden con las issues.** GitLab
  numera aparte la issue #45 y la MR !45, y Estela las guardaba con la misma
  clave, así que `ai-cost --by item` podía juntar el coste de las dos. Ahora una
  MR es `!45`. La migración reescribe solo los merges guardados (se leen de git);
  ninguna imputación cambia.

## 0.4.0 — 2026-11-06

### Nuevo
- **Coste de IA por entrega.** `estela ai-cost --by branch|item` reparte el coste
  y las horas por rama, o por ticket y PR, con filtros de proyecto, cliente y
  periodo, y salida en `--json` o `--csv`. Cada fila separa el coste a precio de
  API de la cuota realmente pagada, y dice en qué se basa la atribución. Lo que
  no tiene base va a "Sin atribuir", sin repartirlo. Sin `--by`, `ai-cost` sale
  igual que antes.
- **Gasto sin entrega.** `estela ai-cost --undelivered` suma, por proyecto, el
  coste de las sesiones sin ningún commit y el de las ramas sin fusionar tras
  N días (`--stale-days`, 14 por defecto), en cifra y en % del gasto. Es una
  señal para revisar, no un juicio: lo que no se puede saber (una rama borrada
  que pudo ser un squash, sesiones de antes de tu primer commit en el repo) se
  enseña aparte y no cuenta.
- **Planificado frente a entregado.** `estela delivery` compara lo planificado
  en GitHub (una etiqueta o un milestone) con lo entregado en el periodo, y pone
  al lado de cada bloque su coste de IA. Lee GitHub con `gh`, solo en proyectos
  con `--system github`, y guarda lo leído para repetirlo sin conexión. Sin
  `gh`, lo explica y enseña lo entregado según git. La etiqueta del plan se fija
  con `estela project tracker --plan-label`.
- **Lo que pidió cada cliente.** `estela delivery --by client` da el gasto de IA
  del periodo en las peticiones de cada cliente (issues y PRs con la etiqueta
  `cliente:<nombre>`) frente al resto, sin repartir a ojo lo que sirvió a
  varios. `estela client alias` une cada nombre de etiqueta con un cliente de
  Estela, y `estela project tracker --client-label` cambia el prefijo. Sin
  ingresos ni contratos: solo une el gasto con quién lo pidió.
- **Informe para finanzas.** `estela summary` junta en Markdown, CSV o JSON lo
  pagado en IA por cliente y proyecto, lo entregado, lo pedido por cada cliente
  y lo que no llegó a entregarse, con los detalles técnicos al final. Un mes
  cerrado suma exactamente su cuota: los meses son los de tu reloj, no los de
  UTC. No llama a nada fuera de tu máquina.
- **Los PR se reconocen por su merge.** El import guarda los commits de merge
  ("Merge pull request #31 from …", y los de GitLab), que unen cada rama con su
  PR aunque la rama ya se haya borrado.

### Arreglos
- **Una rama fusionada con squash ya no cuenta como sin fusionar** en
  `--undelivered`, si `estela delivery` leyó su PR de GitHub.
- **Una sesión que cambia de rama ya no se apunta entera a la última.** El
  bloque se parte en el momento del cambio, y cada rama se lleva sus horas y su
  coste. El total del día no cambia. Los días aprobados, facturados o ajustados
  se quedan como estaban.

### Al actualizar
La base gana tres tablas (los commits de merge, lo leído de GitHub y los alias de
cliente), y el primer import rellena la de merges. Lo ya imputado no cambia,
salvo en días abiertos donde una sesión cambió de rama sin pausa: ahí ese rato se
reparte entre sus ramas, con el mismo total del día. Lo aprobado, facturado o
ajustado se queda como estaba. Antes de instalar, copia la base:
`cp ~/.estela/estela.db ~/.estela/estela.db.antes-0.4.0`.

## 0.3.4 — 2026-11-04

### Nuevo
- **Quitar proyectos desde el panel.** Cada proyecto tiene un botón Archivar: sale
  del panel y deja de captar horas, sin borrar nada. Si tiene horas sin facturar,
  avisa antes. Mientras esté archivado, esas horas no se pueden facturar.
- **Restaurar.** Los archivados quedan en una sección plegada. Al restaurar uno
  vuelve al panel con lo que trabajaste mientras tanto.
- **Eliminar definitivamente.** Solo desde un archivado y escribiendo su nombre
  exacto. Borra el proyecto y sus imputaciones; las sesiones y los commits se
  conservan, y su repo vuelve a aparecer como repo sin proyecto. No se puede
  eliminar un proyecto con facturas, publicado o sincronizado con un equipo: esos
  solo se archivan, y sus facturas se siguen descargando. Archivar no retira un
  panel ya publicado: sigue en línea hasta `estela unpublish`.

## 0.3.3 — 2026-11-04

### Cambios
- **Dos ramas a la vez cuentan tiempo real.** Si dos chats trabajan al mismo
  tiempo en ramas distintas de un proyecto, ese rato se reparte entre las dos: una
  hora de reloj son 30 min en cada rama, no una hora en cada una. Lo aprobado o
  facturado conserva su cifra, y las demás no cobran ese rato. Si cobras un precio
  pactado, ajusta la imputación con su motivo: lo medido se queda al lado.
- **Las sesiones en worktrees y subcarpetas cuentan sin confirmar.** `estela
  import --yes` ya no hace falta, y el panel las cuenta igual que la terminal.

### Arreglos
- **Un cambio de rama a mitad de sesión ya no cobra dos veces.** La imputación
  cuyas horas pasaron a otra rama se retira. Si está aprobada, ajustada o
  facturada no se toca y `estela import` avisa para que la revises.
- **Borrar un transcript ya no reduce horas.** Con un commit fuera de la sesión,
  4 h medidas se convertían en 25 min estimados. Lo mismo pasaba con `--since`.
- **Un commit hecho desde un worktree no suma horas a un día ya medido.**
- **`--help` y `-h` ya no ejecutan el comando.** Y `--dry-run` y `--no-amounts`
  siguen protegiendo aunque les siga otra palabra: antes se ignoraban, y podía
  emitirse un informe de verdad o un PDF con importes.

### Al actualizar
La primera importación recalcula lo que no está aprobado ni facturado, y las
imputaciones retiradas no se recuperan. Antes de instalar, copia la base:
`cp ~/.estela/estela.db ~/.estela/estela.db.antes-0.3.3`. Revisa también las horas
pendientes antes del siguiente informe.

## 0.3.2 — 2026-11-02

### Nuevo
- **Informes sin importes.** Lo ya emitido se vuelve a descargar con o sin tarifa
  e importes, desde "Ya facturado" en el panel. Al cortar, la casilla de importes
  ahora también decide cómo sale ese PDF. En la terminal, `estela report --pdf`
  acepta `--no-amounts`.

### Arreglos
- **Un commit de una sesión cuyo transcript ya se borró no genera horas otra
  vez.** Claude Code limpia sus transcripts antiguos, y al reimportar sus commits
  parecían trabajo sin agente: se sumaban horas estimadas a un trabajo ya medido
  e incluso ya facturado. Si has facturado desde la 0.3.0, revisa los bloques de
  commits sin facturar antes del siguiente informe.

## 0.3.1 — 2026-10-23

### Cambios
- **Un import ya no cambia un día aprobado.** Aprobar es dar la cifra por buena
  (y a menudo ya se ha compartido): un cambio en cómo se calculan las horas se
  aplica a lo que viene. Lo facturado ya estaba protegido. Para recalcular un
  día, se desaprueba.

### Arreglos
- **Un commit hecho en la raíz del repositorio ya no suma tiempo estimado
  encima de una sesión abierta en una subcarpeta.** Al descartar los bloques
  deducidos de commits que se solapan con una sesión de agente se exigía la
  misma ruta exacta; ahora cuenta como el mismo repositorio una subcarpeta,
  igual que al asociar commits a sesiones. Se sumaban 25 minutos de más.

## 0.3.0 — 2026-10-19

### Nuevo
- **`estela plan`**: ¿el plan de Claude que pagas te sobra o te falta? Con el
  historial de la status line (0.2.4) y el multiplicador por sesión que publica
  Anthropic: ventanas de 5 h (pico mediano, p90, máximo, topes ≥95 %, tiempo
  parado estimado como cota superior), semanas, y cuánto te habría bloqueado
  cada otro plan en la ventana de 5 h. El límite semanal entre planes no se
  compara: Anthropic no lo publica. Recomendación con reglas conservadoras;
  provisional con 7–13 días de datos y ninguna con menos de 7. `--days`,
  `--json` con estructura estable y `--no-color`.
- **`estela plan set pro|max5|max20 [--since AAAA-MM-DD]`**: declara tu plan.
  Se guarda el historial de cambios; el análisis solo usa lo de después del
  último.
- **Bloqueos 429**: `estela plan` cuenta, aparte, las respuestas de límite que
  Claude Code dejó en sus transcripts, también de antes de la 0.2.4. Los lee una
  vez y luego solo lo nuevo (`~/.estela/plan-blocks.json`).
- Precios de los planes en un solo fichero, con fuente y fecha; avisa si la
  fecha tiene más de 90 días.

## 0.2.4 — 2026-10-19

### Nuevo
- **Historial de límites**: la status line guarda en local
  (`~/.estela/rate-limits.jsonl`) los porcentajes de 5 h y semana que manda
  Claude Code, con su reinicio y la versión de Claude Code. Nada más: ni sesión,
  ni rutas, ni proyectos. Una muestra como mucho cada 5 minutos, salvo que un
  porcentaje se mueva un punto o empiece una ventana nueva; se borran las de más
  de 120 días. Es lo que analizará `estela plan`. Nada sale de tu máquina.
  Los transcripts no traen estos porcentajes: el historial empieza hoy.

### Cambios
- `estela statusline install` avisa de que la status line solo se ve en Claude
  Code en la terminal: la extensión de VS Code no la enseña.

## 0.2.3 — 2026-10-16

### Nuevo
- **`estela unpublish <proyecto|token>`** borra un panel del servidor: el enlace
  deja de funcionar al momento. `--all` los quita todos (pide confirmación, o
  `--yes`). Sin argumentos, lista tus paneles publicados.
- **`estela publish` enseña antes de subir lo que va a quedar público**:
  autores, ramas, rutas de ficheros, mensajes de commit, si van importes y los
  correos del cliente. Pide confirmación; `--yes` se la salta. Sin terminal y
  sin `--yes` no publica. El botón «Compartir» del panel web hace lo mismo en
  dos pasos.
- **`ESTELA_OFFLINE=1`**: Estela no abre ninguna conexión de red (ni versión,
  ni banner, ni nada de la cuenta).

### Cambios
- **El aviso de versión nueva se puede apagar** con
  `ESTELA_NO_UPDATE_CHECK=1`, y no se hace nunca con `CI` definida.
- **Sin cuenta, el panel local no se conecta a nada**: el banner solo se pide
  si hiciste `estela login`.
- La ayuda tiene una sección «Red» con las dos variables, y el README una
  sección de privacidad. Detalle completo en
  [getestela.dev/privacy](https://getestela.dev/privacy).

## 0.2.2 — 2026-10-14

### Cambios
- **La status line no pierde los límites al arrancar una sesión.** Claude Code
  no manda `rate_limits` hasta la primera respuesta; mientras tanto, la línea
  enseña los últimos porcentajes de semana y de 5 h que mandó, si el reinicio
  de esa ventana aún no ha llegado. Cuando llega el dato nuevo, lo reemplaza.

## 0.2.1 — 2026-10-14

### Cambios
- **Paquete más ligero**: ya no incluye los tests ni los mapas de código de
  `dist`. De 701 kB a 458 kB (2,5 MB → 1,2 MB instalado), y de 436 ficheros a
  138.
- **Status line sin proyecto**: también enseña la semana y la 5 h cuando
  Claude Code manda `rate_limits` (la 5 h en ámbar desde el 80 %). Se recorta
  primero la pista `estela setup`, luego la 5 h, la semana y por último se
  acorta el nombre de la raíz.

## 0.2.0 — 2026-10-14

### Nuevo
- **`estela statusline`**: una línea bajo cada sesión de Claude Code con el
  proyecto (cliente › proyecto), las horas medidas hoy, la parte del consumo
  de la semana que es de este proyecto y, si Claude Code los manda, sus
  porcentajes de límite de la semana y de 5 h (en ámbar desde el 80 %). Nunca
  estima un límite ni hace cuenta atrás. Tarda unos 50 ms: solo lee lo nuevo
  del transcript de la sesión. Ante cualquier error imprime `estela` y sale
  con 0.
- **`estela statusline install` / `uninstall`**: añade o quita el bloque en
  `~/.claude/settings.json` sin tocar lo demás y con copia de seguridad. No
  pisa una status line que ya tengas: `--force` la sustituye y `--append` la
  encadena detrás.
- **`estela quota --weighted`**: el % por precio de lista del modelo en vez de
  por tokens, con una nota: no es cómo el proveedor cuenta tu límite.

### Cambios
- **Recupera horas de sesiones en subcarpetas y worktrees que antes no se
  imputaban.** `estela import` (y el import automático del panel) asigna a su
  proyecto lo que antes quedaba sin proyecto; nunca mueve horas ya asignadas
  a otro proyecto ni toca un día aprobado o facturado (avisa con la fecha, las
  horas y el comando para revisarlo). La primera vez enseña las horas que
  recuperaría por proyecto y pide confirmación; `--yes` la omite.
- **El proyecto de una sesión, por su raíz git**: una sesión en una subcarpeta
  o en un worktree cuenta para el proyecto de su repo, en `quota` y en la
  status line. Una carpeta sin proyecto sale con el nombre de su raíz git,
  nunca el de una subcarpeta.
- **La ventana de 5 h real**: si la status line vio el `resets_at` de Claude
  Code hace menos de 5 h, `quota` empieza la ventana ahí y deja de llamarla
  estimada.

## 0.1.40 — 2026-10-12

### Nuevo
- **`estela quota`**: qué proyecto se come tu cuota de Claude Code o Codex,
  en la ventana de 5 h y en la semana, frente a tus 4 semanas anteriores.
  También como tarjeta en el Resumen del panel.
- El panel local cabe en móvil y en tableta.
