# Estela

**English** · [Español](https://github.com/jdleonruiz/estela-cli/blob/main/README.es.md)

Development time tracking you **don't have to fill in**. Estela reads what your
AI agents and your Git already wrote to disk and rebuilds where your time went,
along with what the AI cost.

```sh
npx estela setup
```

Twenty seconds later you have the last few months of your history. No account,
no card, and nothing leaves your machine.

---

## Why it exists

A timer you have to remember to start always fails. And with an AI agent, time
isn't measured in keystrokes anymore: it goes into writing the prompt, reading
what comes back, and trying it out.

But that work **leaves a trail**. Claude Code saves every session in
`~/.claude/projects/` with its exact model and tokens. Git records when you
committed and what. Estela reads both and lines them up.

What it doesn't do:

- **It doesn't install hooks.** Your `husky` and `lefthook` stay untouched, and
  your commit messages aren't modified. An identifier written into history
  can't be taken back once it's pushed.
- **It doesn't inspect processes or your terminal.** It reads files that already
  exist.
- **It doesn't store the content of your prompts.** Only when, how much, and
  with which model.
- **It doesn't send anything anywhere.** The free plan is entirely local.

## Getting started

You need **Node 22.5 or later** (for `node:sqlite`).

```sh
npx estela setup     # detects agents and repositories, rebuilds your history
npx estela web       # opens the dashboard at http://localhost:4319
npx estela doctor    # checks your data and flags anything wrong
npx estela --version
```

No Claude Code? It still works: without transcripts, Estela rebuilds your time
from your commits alone, and marks it as estimated.

`npm` doesn't update global installs on its own. If you installed with
`npm install -g estela`, Estela tells you when there's a newer version (it asks
npm at most once a day, in the background, without blocking anything); update
with `npm install -g estela@latest`.

`setup` asks no questions and doesn't overwrite anything you've set up by hand:
you can run it again.

Estela speaks English and Spanish, following your system's language. Force one
with `--lang en` on any command, or `ESTELA_LANG=en` for good.

### Windows

Estela runs on Windows. It's tested by hand on a real machine, not in CI, so if
something looks off, [open an issue](https://github.com/jdleonruiz/estela-cli/issues).
Two things trip people up before Estela even starts:

- **`npm : ... cannot be loaded because running scripts is disabled`** —
  PowerShell blocks npm's own scripts by default. Once, and only for your user:
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **`npm error Class extends value undefined is not a constructor or null`** —
  you have two Node installs fighting over the same folder, usually
  `nvm-windows` plus a Node from the installer or `winget`. Keep one: uninstall
  the standalone Node, then `nvm install lts` and `nvm use lts` from an
  administrator terminal. `where.exe npm` should list a single path.

## Reporting to a client

Projects are created as internal and without a rate, because making one up
would produce fake numbers from the first minute. When one belongs to a real
client:

```sh
estela client add --id acme --name "ACME" --currency EUR
estela project add --id acme-web --client acme --name "ACME website" --repo ~/dev/acme-web
estela rate set --project acme-web --rate 50

estela author --project acme-web      # which email you commit with there
estela report --project acme-web --cutoff 2026-08-31 --dry-run
```

**`estela author` matters more than it looks.** In a client's repository you
almost never commit with your global email, and without telling Estela it
captures three commits out of seventeen hundred.

The report backs up your work with hours and commits. It isn't an invoice:
Estela doesn't issue tax documents, so attach it to your own.

**A cutoff doesn't mean you stop working on the project.** Without
`--dry-run`, `estela report --cutoff <date>` marks those hours as invoiced
and keeps letting new hours pile up for the next cutoff:

```sh
estela report --project acme-web --cutoff 2026-08-31 --pdf august.pdf
# ...keep working as usual...
estela report --project acme-web --cutoff 2026-09-30 --pdf september.pdf
```

When a project is genuinely done, close it — nothing gets deleted, and if
it captures work again (a teammate, or you without remembering), `estela
doctor` flags it instead of silently losing it:

```sh
estela project close --project acme-web
estela project reopen --project acme-web   # if you need to pick it up again
```

## Sharing progress with your client

```sh
estela login --email you@example.com    # once
estela publish --project acme-web
```

This uploads a read-only dashboard with an unguessable link, hosted on
getestela.dev — no server of your own needed. It shows hours and commits;
**never your rate or your AI usage**, because as long as you're the one paying
for it that spend is yours, and a client who knows which part an AI generated
has a new argument for negotiating your rate down.

Publishing again from the same machine reuses the link automatically. From a
different machine, pass `--token` with the existing one, or your client ends up
with a dead link. The Free plan allows one published dashboard at a time; Pro
and Teams have no limit.

## What the AI actually costs

On a flat subscription, your real spend isn't the sum of the tokens: it's the
fee split across what you used.

```sh
estela subscription add --id max --name "Claude Max" --fee 100
estela ai-cost
```

Cache is counted separately because it's usually most of the bill — ignoring it
underestimated spend fivefold.

## Hours no import will infer

Meetings, travel, research, and development without an agent that didn't leave
commits either:

```sh
estela log --project acme-web --hours 1.5 --kind meeting --what "Weekly check-in"
```

An import never touches them.

## Work without an agent

If you coded by hand, your commits are still a trail: Estela infers the time
from them and marks it as **estimated**, so you know which part of your hours is
measured and which is assumed. The estimate errs on the short side on purpose:
these hours end up in a report someone pays for.

## Plans

| | Free | Pro | Teams |
|---|---|---|---|
| Everything above, locally | ✓ | ✓ | ✓ |
| Sync across machines | — | ✓ | ✓ |
| Hosted dashboards at once | 1 | unlimited | unlimited |
| **Measured** team hours | — | — | ✓ |
| AI budget per project | — | — | ✓ |

Pro is one person on several machines; Teams is several people. AI cost is
reported **per project, never per person**: what each person spends out of their
own pocket is theirs.

More at [getestela.dev](https://getestela.dev/en/).

## Development

```sh
npm install
npm test
```

Node 22 and **zero runtime dependencies**, on purpose: nobody installs a program
that reads their transcripts if they can't audit it, and an empty dependency
list can be audited in an afternoon.

## Open source, closed service

Everything that installs on your machine is open source under the MIT license:
the CLI, what reads your transcripts and your git, what calculates hours and
cost, and the dashboard that `estela web` opens. It's exactly what
`npm install estela` downloads, and you can read it at
[github.com/jdleonruiz/estela-cli](https://github.com/jdleonruiz/estela-cli).
Each npm version has a matching tag there.

What **isn't** here is the paid service: the server that syncs your machines and
the one behind team projects. That part is closed, and it's what keeps the
project going.

The split isn't an accident. The free plan works entirely without an account,
a card, or a network connection, and that claim is worth nothing if you have to
take it on faith: with the code in front of you, you can check for yourself that
nothing leaves your machine.

The test fixtures are made up on purpose. The cases come from real repositories
— that's why they cover messes nobody would think of — but neither a client's
team roster nor how much each of its people commits belongs in a public
repository.
