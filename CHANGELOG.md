# Changelog

Cambios visibles de cada versión del paquete `estela`. Las anteriores a la
0.2.0 están en el historial de git, con una etiqueta por versión en
[github.com/jdleonruiz/estela-cli](https://github.com/jdleonruiz/estela-cli/tags).

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
