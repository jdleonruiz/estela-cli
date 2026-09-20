---
description: Check billable hours, unbilled time, and AI cost for the current project, reconstructed by Estela from Claude Code session history and git. Use when the user asks how many hours they've worked, what they can bill a client, their time-tracking status, or how much their AI usage has cost — for this project or in general.
---

# Estela: hours and AI cost status

Estela reconstructs billable hours from two things that already exist on disk:
Claude Code's own session transcripts and git commit history — no timer, no
hooks. This skill reads that reconstruction; it never sends anything anywhere.

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

1. Run `estela status` in the repository root. If the command isn't found,
   run `npx estela status` instead — no need to ask the user to install
   anything first, `npx` fetches it transparently.
2. If the output says there are no clients configured yet, this is the
   user's first time. Don't try to interpret empty output as "no hours
   worked" — tell them clearly that Estela hasn't been set up in this
   repository yet, and offer to run `estela setup` (covered by this
   plugin's `estela:setup` skill) instead of guessing.
3. Otherwise, summarize the output in plain language: hours worked, days
   with activity, what's still unbilled, and AI cost if it's shown. Don't
   just paste the raw command output — explain what the numbers mean.
4. If the user wants more detail than `status` gives (a specific project,
   individual blocks of time, a document to hand a client), suggest the
   relevant follow-up rather than running it yourself without asking:
   `estela entries --project <id>` for the raw blocks, `estela report` for
   a document that backs up the hours, or `estela web` to open the
   dashboard.

Never run `estela report`, `estela publish`, `estela login`, or anything
that writes data or reaches getestela.dev without the user explicitly
asking for it. This skill only reads local status.
