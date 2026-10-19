# Changelog

Cambios visibles de cada versión del paquete `estela`. Las anteriores a la
0.2.0 están en el historial de git, con una etiqueta por versión en
[github.com/jdleonruiz/estela-cli](https://github.com/jdleonruiz/estela-cli/tags).

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
