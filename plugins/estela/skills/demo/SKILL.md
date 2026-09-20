---
description: Show what Estela's dashboard looks like using made-up example data, without touching the user's real history. Use when the user wants to see what Estela does before setting it up for real, asks what Estela is or how it looks, or wants an example before committing to `estela setup`.
---

# Estela: demo with made-up data

Before setting Estela up for real, someone can see the full dashboard
filled with invented data — a few fake clients, weeks of activity, AI
cost, a team view — without touching anything of their own.

## Before anything else: check Node

Estela needs Node 22.5 or later (it uses the built-in `node:sqlite`). Run
`node --version` first.

- If the command isn't found, or the version is older than 22.5, **stop**
  — don't try to work around it, and don't run any `estela` command yet.
  Tell the user plainly what to do: on macOS or Linux, `nvm install
  --lts`; on Windows, `winget install OpenJS.NodeJS.LTS` — **unless they
  already use nvm-windows** (`nvm version` works), in which case use
  `nvm install lts` then `nvm use lts` from an **administrator**
  terminal, and never install a second Node with winget or the
  installer: the two collide and leave several `npm` on the PATH. After
  installing they need a **new terminal** before trying again.
- This isn't the user doing anything wrong: Claude Code itself doesn't
  require Node, so having Claude Code without a recent Node is normal.

1. Run `npx estela demo` (add `--port <n>` only if the default port 4320
   is already taken; don't add it otherwise). This opens a dashboard at a
   local URL, backed by a separate database file — never the user's real
   one — seeded with invented projects and commits run through the same
   calculation the real product uses.
2. Tell the user plainly that what they're about to see is made up, not
   their own work, and that it doesn't read or change anything real on
   their machine.
3. The command keeps running until stopped (Ctrl+C); mention that so they
   know to end it when they're done looking, rather than leaving it
   running in the background unannounced.
4. Once they've seen it, point them at this plugin's `estela:setup` skill
   to set up their own real data instead.
