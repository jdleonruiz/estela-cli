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

## El coste de la IA

Con una cuota plana el gasto real no es la suma de los tokens: es la cuota
repartida entre lo que consumiste.

```sh
estela subscription add --id max --name "Claude Max" --fee 100
estela ai-cost
```

La caché se cuenta aparte porque suele ser la mayor parte de la factura —
ignorarla subestimaba el gasto cinco veces.

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
