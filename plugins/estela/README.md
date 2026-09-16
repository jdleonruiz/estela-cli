# Estela plugin for Claude Code

Turns your Claude Code session history into billable hours — read from the
transcripts Claude Code already writes to `~/.claude/projects/`, plus your
git history. No timer, no hooks.

## Install

```
/plugin marketplace add jdleonruiz/estela-cli
/plugin install estela@estela-cli
```

## What it does

Three skills, all model-invoked — you don't need to remember exact names,
just ask naturally:

- *"How many hours have I worked on this?"* / *"What can I bill for this
  month?"* → runs `estela status` and explains it.
- *"What does Estela look like?"* / *"Show me an example first"* → runs
  `npx estela demo`, a full dashboard filled with made-up data, nothing of
  yours touched.
- *"Set up time tracking"* / first mention of Estela with nothing
  configured yet → runs `estela setup` and explains what it found.

Every skill is a thin wrapper around the [Estela
CLI](https://github.com/jdleonruiz/estela-cli) (MIT, zero runtime
dependencies) — it teaches Claude Code when to reach for commands you'd
otherwise have to remember and run yourself. Nothing here uploads data or
touches your repository's files; publishing a report to a client still
needs `estela publish`, run explicitly.

More at [getestela.dev](https://getestela.dev).
