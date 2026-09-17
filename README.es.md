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

---

## Por qué existe

Un cronómetro que hay que acordarse de arrancar siempre falla. Y con un agente
de IA el tiempo ya no se mide tecleando: se va en escribir el prompt, leer lo
que devuelve y probarlo.

Pero ese trabajo **deja rastro**. Claude Code guarda cada sesión en
`~/.claude/projects/` con su modelo y sus tokens exactos. Git guarda cuándo
commiteaste y qué. Estela lee ambas cosas y las cruza.

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

¿Sin Claude Code? Funciona igual: sin transcripts, Estela reconstruye tu tiempo
solo desde tus commits, y lo marca como estimado.

`npm` no actualiza instalaciones globales por su cuenta. Si la instalaste con
`npm install -g estela`, Estela avisa sola cuando hay una versión más nueva
(consulta npm como mucho una vez al día, en segundo plano, sin bloquear nada);
actualiza con `npm install -g estela@latest`.

`setup` no pregunta nada y no pisa lo que hayas configurado a mano: se puede
volver a ejecutar.

Estela habla español e inglés, según el idioma de tu sistema. Fuerza uno con
`--lang es` en cualquier comando, o con `ESTELA_LANG=es` para siempre.

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

Pro es una persona en varias máquinas; Teams son varias personas. El coste de
IA se informa **por proyecto, nunca por persona**: lo que cada cual gasta de su
bolsillo es suyo.

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
