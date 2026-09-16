---
description: Show what Estela's dashboard looks like using made-up example data, without touching the user's real history. Use when the user wants to see what Estela does before setting it up for real, asks what Estela is or how it looks, or wants an example before committing to `estela setup`.
---

# Estela: demo with made-up data

Before setting Estela up for real, someone can see the full dashboard
filled with invented data — a few fake clients, weeks of activity, AI
cost, a team view — without touching anything of their own.

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
