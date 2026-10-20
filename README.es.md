# Estela

[English](https://github.com/jdleonruiz/estela-cli/blob/main/README.md) · **Español**

Registro de horas de desarrollo que **no hay que rellenar**. Lee lo que tus
agentes de IA y tu Git ya escribieron en disco y reconstruye en qué se te fue el
tiempo, con lo que costó de IA.

```sh
npx estela setup
```

Veinte segundos después tienes tu historial de los últimos meses. Sin cuenta,
sin tarjeta y sin que nada salga de tu máquina.

![El panel de Estela: las horas reconstruidas desde tus sesiones de IA y Git, lo que valen por cliente y lo que costó la IA](https://raw.githubusercontent.com/jdleonruiz/estela-cli/main/docs/dashboard.png)

<sub>El panel local (`estela web`), aquí con los datos inventados de `estela demo`.</sub>

---

## Por qué existe

Un cronómetro que hay que acordarse de arrancar siempre falla. Y con un agente
de IA el tiempo ya no se mide tecleando: se va en escribir el prompt, leer lo
que devuelve y probarlo.

Pero ese trabajo **deja rastro**. Claude Code guarda cada sesión en
`~/.claude/projects/`, Codex en `~/.codex/sessions/` y GitHub Copilot en el
`workspaceStorage` de VS Code, con su modelo y sus tokens. Git guarda cuándo
commiteaste y qué. Estela lo lee todo y lo cruza.

De Codex salen las horas **medidas** y el coste de IA real, igual que de
Claude Code. Un modelo que no esté en el catálogo de precios entra con coste
vacío en vez de con uno inventado, y `estela doctor` te dice cuántos turnos
están en ese caso.

GitHub Copilot en VS Code (chat y modo agente, en Windows, macOS y Linux) da
también horas medidas: cuándo empieza y cuándo acaba cada petición. No trae
coste de IA, porque Copilot se paga por suscripción, y el autocompletado en
línea no deja nada en disco, así que ese tiempo sale de tus commits.

Lo que no hace:

- **No instala hooks.** Tu `husky` y tu `lefthook` siguen intactos, y tus
  mensajes de commit no se tocan. Un identificador metido en el historial es
  irreversible una vez subido.
- **No inspecciona procesos ni la terminal.** Lee ficheros que ya existen.
- **No guarda el contenido de tus prompts.** Solo cuándo, cuánto y con qué
  modelo.
- **No manda nada a ningún sitio.** El plan gratuito es local entero.

### ¿Ya usas ccusage?

Sigue usándolo. [ccusage](https://github.com/ryoppippi/ccusage) lee los mismos
ficheros y te dice cuánto te costó la IA; Estela, cuántas horas trabajaste y
cuánto cobrarle al cliente. Las dos solo leen, así que conviven sin problema.
[Comparación lado a lado](https://getestela.dev/vs/ccusage).

## Empezar

Necesitas **Node 22.5 o superior** (por `node:sqlite`).

```sh
npx estela setup     # detecta agentes y repositorios, reconstruye tu historial
npx estela web       # abre el panel en http://localhost:4319
npx estela doctor    # revisa los datos y avisa de lo que está mal
npx estela --version
```

### Desde dentro de Claude Code

Si ya estás ahí, Estela se instala sin salir:

```
/plugin marketplace add jdleonruiz/estela-cli
/plugin install estela@estela-cli
```

Luego se pide con palabras normales —*"¿cuántas horas llevo en esto?"*, *"¿qué
puedo facturar este mes?"*, *"enséñame antes un ejemplo"*— y Claude Code busca
el comando por su cuenta. Las formas explícitas son `/estela:setup`,
`/estela:status` y `/estela:demo`.

La demo llena un panel entero con datos inventados y no toca nada tuyo, que es
la manera honesta de mirar un programa que quiere leerte los transcripts: ver
qué hace antes de dejarlo cerca de tu historial.

¿Sin Claude Code, Codex ni Copilot? Funciona igual: sin transcripts, Estela reconstruye
tu tiempo solo desde tus commits, y lo marca como estimado.

`npm` no actualiza instalaciones globales por su cuenta. Si la instalaste con
`npm install -g estela`, Estela avisa sola cuando hay una versión más nueva
(consulta npm como mucho una vez al día, en segundo plano, sin bloquear nada);
actualiza con `npm install -g estela@latest`.

`setup` no pregunta nada y no pisa lo que hayas configurado a mano: se puede
volver a ejecutar.

Estela habla español e inglés, según el idioma de tu sistema. Fuerza uno con
`--lang es` en cualquier comando, o con `ESTELA_LANG=es` para siempre.

### Windows

Estela funciona en Windows. Está probada a mano en un equipo real, no en CI, así
que si algo no cuadra, [abre una incidencia](https://github.com/jdleonruiz/estela-cli/issues).
Hay dos tropiezos que ocurren antes de que Estela llegue a arrancar:

- **`npm : ... no se puede cargar el archivo ... no está firmado`** — PowerShell
  bloquea por defecto los scripts del propio npm. Una vez, y solo para tu
  usuario: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **`npm error Class extends value undefined is not a constructor or null`** —
  tienes dos instalaciones de Node peleando por la misma carpeta, normalmente
  `nvm-windows` más un Node del instalador o de `winget`. Deja una sola:
  desinstala el Node suelto, y luego `nvm install lts` y `nvm use lts` desde una
  terminal de administrador. `where.exe npm` debe mostrar una única ruta.

Una sesión en una subcarpeta o en un worktree de git cuenta para el proyecto
de su repositorio. Si un import fuera a sumar horas a lo ya importado, Estela
te enseña cuántas por proyecto y pregunta antes (`estela import --yes` no
pregunta); nunca mueve horas entre proyectos ni toca un día aprobado.

## Informar a un cliente

Los proyectos se crean como internos y sin tarifa, porque inventarla daría
cifras falsas el primer minuto. Cuando uno sea de un cliente de verdad:

```sh
estela client add --id acme --name "ACME" --currency EUR
estela project add --id acme-web --client acme --name "Web de ACME" --repo ~/dev/acme-web
estela rate set --project acme-web --rate 50

estela author --project acme-web      # con qué correo commiteas ahí
estela report --project acme-web --cutoff 2026-08-31 --dry-run
```

**`estela author` importa más de lo que parece.** En el repositorio de un
cliente casi nunca commiteas con tu correo global, y sin decirlo se capturan
tres commits de mil setecientos.

**El idioma es el del cliente, no el de tu terminal.** Lo que recibe tu cliente
(el PDF, el CSV, el informe y el panel publicado) sale en el idioma que le fijes
a ese cliente, así que puedes usar Estela en español y facturarle a una empresa
en inglés:

```sh
estela client add --id acme --name "ACME" --currency EUR --language en
```

Sin eso Estela usa el idioma de tu terminal, y te avisa cuando lo hace. Volver a
ejecutar `client add` conserva el idioma que fijaste (`--language auto` lo
quita), y un `--lang en` suelto en un comando manda sobre todo. Un panel
publicado es un fichero estático: para cambiarle el idioma, se vuelve a publicar.

El informe respalda tu trabajo con horas y commits. No es una factura: Estela
no emite documentos fiscales, así que adjúntalo a la tuya.

**Un corte no te obliga a dejar de trabajar en el proyecto.** Sin
`--dry-run`, `estela report --cutoff <fecha>` marca esas horas como
facturadas y sigue dejando que se acumulen horas nuevas para el siguiente
corte:

```sh
estela report --project acme-web --cutoff 2026-08-31 --pdf agosto.pdf
# ...sigues trabajando normalmente...
estela report --project acme-web --cutoff 2026-09-30 --pdf septiembre.pdf
```

Cuando de verdad termines un proyecto, ciérralo — no borra nada, y si vuelve
a captar trabajo (un compañero, o tú sin acordarte), `estela doctor` avisa
en vez de perderlo en silencio:

```sh
estela project close --project acme-web
estela project reopen --project acme-web   # si hace falta volver a él
```

## Compartir el avance con tu cliente

```sh
estela login --email tu@correo.com    # una vez
estela publish --project acme-web
```

Sube un panel de solo lectura, con un enlace no adivinable, alojado en
getestela.dev — no hace falta servidor propio. Enseña horas y commits;
**nunca tu tarifa ni tu consumo de IA**, porque mientras la pagues tú ese
gasto es tuyo y un cliente que sabe qué parte generó una IA tiene un
argumento nuevo para negociar tu tarifa.

Volver a publicar desde la misma máquina reutiliza el enlace sola. Desde otra
máquina, pasa `--token` con el que ya existe, o tu cliente se queda con un
enlace muerto. El plan Free permite un panel publicado a la vez; Pro y Teams no
tienen límite.

El pie del panel dice "Horas rellenadas por Estela", con un enlace a
getestela.dev. En Pro y Teams, `--no-credit` quita esa línea.

Antes de subirlo, `estela publish` enseña lo que va a quedar público (autores,
ramas, rutas de ficheros, correos del cliente) y pide confirmación (`--yes` se
la salta). `estela unpublish <proyecto>` borra el panel del servidor y el enlace
deja de funcionar; `--all` los quita todos.

## Enseñar lo que has hecho

Un badge para el README del proyecto, con sus horas medidas y lo que costó la
IA:

```sh
estela badge                     # el proyecto del repositorio en el que estás
estela badge --project acme-web
```

Imprime una línea de Markdown con una imagen estática de
[shields.io](https://shields.io), del estilo `Built in 42 h · $18 of AI`. No
se aloja nada ni se consulta nada: las cifras van dentro de la URL, así que
para actualizarlas se vuelve a generar. Solo cuenta horas **medidas**, nunca las
estimadas desde commits.

Y un recibo de tu semana (o de toda tu historia) en PNG:

```sh
estela receipt --week
```

Horas medidas frente a estimadas, el coste de IA, lo que te ahorró la caché, y
el proyecto y la rama más caros. Se pinta en tu máquina y se queda ahí. Los
nombres de proyectos y ramas no salen por defecto, porque suelen ser de un
cliente; con `--names` se incluyen.

## El coste de la IA

Con una cuota plana el gasto real no es la suma de los tokens: es la cuota
repartida entre lo que consumiste.

```sh
estela subscription add --id max --name "Claude Max" --fee 100
estela ai-cost
```

La caché se cuenta aparte porque suele ser la mayor parte de la factura —
ignorarla subestimaba el gasto cinco veces.

## Qué proyecto se come tu cuota

Con Claude Max/Pro o Codex con suscripción, la cuota se acaba antes de lo que
esperas y nada te dice en qué se fue. `estela quota` la reparte por proyecto:

```sh
estela quota              # ventana de 5 h actual y esta semana, por proyecto
estela quota --weighted   # el % por precio de lista en vez de por tokens
estela quota --json       # lo mismo, para scripts
```

Tokens (entrada, salida, lectura y escritura de caché) por proyecto, en la
ventana de 5 h actual y en la semana (de lunes a hoy, en tu hora), y esta semana
frente a la media de tus 4 anteriores en el mismo tramo. Claude Code y Codex van
por separado: gastan cuotas distintas. También es una tarjeta en la pestaña
Resumen de `estela web`, y es gratis.

Una sesión en una subcarpeta o en un worktree de git cuenta para el proyecto
de su repo; una carpeta que no es de ningún proyecto sale con el nombre de su
raíz git. El % es por tokens; `--weighted` lo reparte por el precio de lista
de cada modelo, que no es cómo el proveedor cuenta tu límite. Con la status
line instalada (abajo), la ventana de 5 h es la que da Claude Code, no una
estimación.

Lo que nunca hace es decirte cuánto te queda: Anthropic y OpenAI no publican los
límites de sus planes, así que cualquier "te quedan X tokens" sería inventado. La
ventana de 5 h es una estimación: no se sabe cómo redondean su inicio, y lo que
uses en claude.ai u otro equipo también cuenta, pero no está en este. Copilot
queda fuera porque no guarda tokens fiables. Todo se calcula en tu máquina.

## ¿Te sirve tu plan de Claude?

```sh
estela plan set max5            # pro | max5 | max20; añade --since AAAA-MM-DD si ya lo tenías antes de hoy
estela plan                     # últimos 28 días; --days N, --json, --no-color
```

Responde a «¿el plan de Claude que pago me sobra o me falta?» con tus datos: los
porcentajes de 5 h y semana que Claude Code manda a la status line (guardados
desde la 0.2.4, solo en la terminal), y nada más. Ejemplo (datos inventados):

```
estela plan · Max 5x (desde 2026-10-01) · 26 días con datos

Ventanas de 5 h      41 ventanas · pico mediano 22 % · p90 38 % · máximo 61 %
Topes (≥95 %)        0
Semana               pico mediano 34 % · máximo 47 % · 0 semanas ≥ 90 %
Bloqueos (429)       0 de 5 h · 0 semanales, según los transcripts de Claude Code

Si estuvieras en…
  Pro (20 $)         p90 equivalente 190 % · te habría bloqueado en 29 de 41 ventanas
  Max 20x (200 $)    sin topes, igual que ahora

Recomendación        Tu plan actual encaja con tu uso.
```

- **Nunca inventa ni estima el límite de un plan.** Los otros planes se comparan
  solo en la ventana de 5 h, con el multiplicador por sesión que publica
  Anthropic (Max 5x = 5 × Pro, Max 20x = 20 × Pro;
  [fuente](https://support.claude.com/en/articles/11049741-what-is-the-max-plan)):
  el pico equivalente es tu pico × tu multiplicador ÷ el del otro plan. Anthropic
  no publica la relación del límite semanal entre planes, así que esa comparación
  no se hace. Nunca dice cuánto te queda.
- Una ventana con pico de 95 % o más es un tope. El tiempo parado tras un tope
  (desde la primera muestra al 99 % hasta el reinicio) es una cota superior: no
  sabemos si seguías trabajando.
- «Bloqueos (429)» son las respuestas de límite que Claude Code dejó en sus
  transcripts. Son oficiales y llegan a antes de la 0.2.4, pero no traen
  porcentaje: se enseñan aparte y no entran en el cálculo.
- Con menos de 7 días de datos no hay recomendación; de 7 a 13 es provisional.
  Tras un cambio de plan solo cuenta lo de después.
- Los precios son los de la web de Anthropic a la fecha que se indica:
  compruébalos. Anthropic puede cambiar los límites: repítelo cada mes.

`--json` da las mismas cifras con una estructura estable (`version: 1`). Los
campos están en la sección en inglés del [README](README.md#is-your-claude-plan-the-right-one).

## Una línea bajo cada sesión de Claude Code

```sh
npm install -g estela        # la status line necesita estela en tu PATH
estela statusline install
```

En un repositorio que aún no es un proyecto enseña `estela · web (sin proyecto) ·
estela setup`, y fuera de git solo `estela · sin proyecto`; en los dos casos,
también la semana y la 5 h si Claude Code las manda. En un proyecto,
cada sesión de Claude Code enseña una línea así:

```
estela · Brightside Health › brightside-portal · hoy 2h14 · este proyecto 21 % · semana 38 % · 5 h 62 %
```

Las horas medidas hoy en este proyecto (la misma cifra que dará el informe),
la parte de tu consumo de Claude Code de esta semana que es de este proyecto
y, solo si Claude Code los manda, sus propios porcentajes de límite de la
semana y de 5 h, tal cual. Estela nunca estima un límite ni hace cuenta atrás.
La cifra de 5 h se pone en ámbar desde el 80 %. Una sesión nueva enseña las
últimas cifras que mandó Claude Code hasta que lleguen otras, si esa ventana no
se ha reiniciado. En una terminal estrecha la
línea quita primero la 5 h, luego la semana, acorta el nombre, quita "este
proyecto" y después "hoy"; `estela` no se va nunca. Tarda unos 50 ms y solo
lee lo nuevo del transcript de la sesión actual.

`install` añade el bloque a `~/.claude/settings.json` sin tocar nada más, y
antes deja una copia. Si ya tienes una status line no la pisa: `--force` la
sustituye y `--append` enseña la tuya detrás de la de Estela. `estela
statusline uninstall` la quita (y te devuelve la tuya si usaste `--append`).

La status line solo se ejecuta en Claude Code en la terminal: la extensión de
VS Code no la enseña.

Desde la 0.2.4, la status line guarda en local tus porcentajes de 5 h y semana
(`~/.estela/rate-limits.jsonl`) para que `estela plan` pueda analizarlos. Nada
sale de tu máquina. Solo se guarda lo que manda Claude Code (cada porcentaje,
su reinicio y la versión de Claude Code), como mucho cada 5 minutos salvo que
una cifra se mueva, y durante 120 días. Los transcripts no traen estos
porcentajes, así que el historial empieza el día que instalas la 0.2.4.

## Horas que ningún import va a deducir

Reuniones, desplazamientos, investigación, y desarrollo sin agente que tampoco
dejó commits:

```sh
estela log --project acme-web --hours 1.5 --kind meeting --what "Seguimiento semanal"
```

Un import nunca las toca.

## Trabajo sin agente

Si programaste a mano, tus commits siguen siendo un rastro: Estela deduce el
tiempo de ellos y lo marca como **estimado**, para que sepas qué parte de tu
parte está medida y cuál supuesta. La estimación se queda corta a propósito:
estas horas acaban en un informe que alguien paga.

## Privacidad

En el plan gratuito, tus sesiones, tu código y tus horas no salen de tu
máquina: todo vive en `~/.estela/estela.db`, y el panel de `estela web` solo
escucha en `127.0.0.1`. Estela nunca guarda el texto de tus prompts, ni siquiera
en local.

La única conexión de red sin cuenta es una consulta a npm, como mucho una vez al
día, por si hay versión nueva. Dos variables de entorno:

| Variable | Efecto |
|---|---|
| `ESTELA_NO_UPDATE_CHECK=1` | No consulta la versión (tampoco se hace con `CI` definida). |
| `ESTELA_OFFLINE=1` | Ninguna conexión de red: ni versión, ni banner, ni cuenta. |

Con cuenta, solo sube lo que activas: un panel, sync, Teams. Qué manda cada
función, una por una: [getestela.dev/privacy](https://getestela.dev/privacy).

## Planes

| | Free | Pro | Teams |
|---|---|---|---|
| Todo lo de arriba, en local | ✓ | ✓ | ✓ |
| Sincronizar varias máquinas | — | ✓ | ✓ |
| Paneles alojados a la vez | 1 | ilimitados | ilimitados |
| Horas del equipo **medidas** | — | — | ✓ |
| Presupuesto de IA por proyecto | — | — | ✓ |
| Proyectos | ilimitados | ilimitados | ilimitados |

Pro es una persona en varias máquinas; Teams son varias personas.

Teams se paga **por persona medida** —10 $/mes, 10 € en la zona euro, con un
mínimo de tres—, no por
proyecto. Los proyectos son ilimitados a propósito: si cada uno costara dinero
acabarías midiendo solo dos o tres, que es justo lo contrario de para lo que
sirve. Alguien que está en varios proyectos se paga una vez.

El coste de IA se informa **por proyecto, nunca por persona**: lo que cada cual
gasta de su bolsillo es suyo. Pagar por asiento no cambia eso.

Más en [getestela.dev](https://getestela.dev).

## Desarrollo

```sh
npm install
npm test
```

Node 22 y **cero dependencias de runtime**, a propósito: nadie instala un
programa que lee sus transcripts si no puede auditarlo, y una lista de
dependencias vacía se audita en una tarde.

## Contribuir

Los issues y los pull requests son bienvenidos, y los
[good first issues](https://github.com/jdleonruiz/estela-cli/labels/good%20first%20issue)
son un buen sitio para empezar. Una cosa que conviene saber para que nadie se
desanime: este repositorio es el reflejo de la parte abierta de otro más grande,
donde también vive el servicio de pago, y por eso cada commit de aquí es una
versión. Reviso los PR aquí y los aplico en el repositorio principal
manteniéndote como autor, y el commit de la siguiente versión te nombra como
coautor. Los PR son bienvenidos: yo los integro en el repositorio principal.

## Código abierto, servicio cerrado

Todo el programa que se instala en tu máquina es abierto y está bajo licencia
MIT: el CLI, lo que lee tus transcripts y tu git, lo que calcula las horas y
el coste, y el panel que abre `estela web`. Es exactamente lo que descarga
`npm install estela`, y puedes leerlo en
[github.com/jdleonruiz/estela-cli](https://github.com/jdleonruiz/estela-cli).
Cada versión de npm tiene ahí su etiqueta.

Lo que **no** está aquí es el servicio de pago: el servidor que sincroniza
entre tus máquinas y el que sostiene los proyectos de equipo. Eso es cerrado,
y es de lo que vive el proyecto.

La división no es casual. El plan gratuito funciona entero sin cuenta, sin
tarjeta y sin red, y esa afirmación no vale nada si tienes que creértela: con
el código delante puedes comprobar tú mismo que nada sale de tu máquina.

Las fixtures de los tests son inventadas a propósito. Los casos vienen de
repositorios reales —por eso cubren líos que a nadie se le ocurrirían— pero
ni la plantilla de un cliente ni cuánto commitea cada persona de su equipo
son cosas que deban viajar en un repositorio público.
