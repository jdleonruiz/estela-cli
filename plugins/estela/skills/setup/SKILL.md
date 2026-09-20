---
description: Set up Estela in this repository for the first time, to start reconstructing billable hours from Claude Code sessions and git history. Use when the user wants to start tracking hours, set up time tracking, install Estela, or mentions Estela without it being configured yet.
---

# Estela: first-time setup

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

1. Run `npx estela setup` from the repository root. If it still fails
   with a message about the Node version, relay that message as printed
   rather than guessing at the cause.
2. This is the entire setup: no account, no questions asked, about two
   minutes. It scans for Claude Code transcripts in `~/.claude/projects/`
   and for git repositories, and reconstructs hours from whichever it
   finds — it works even with no Claude Code history at all, from commits
   alone, marked as estimated rather than measured.
3. After it finishes, relay the summary it printed (hours reconstructed,
   projects found, date range) rather than re-running anything to check.
4. Mention `estela web` to see the dashboard, and `estela doctor` to catch
   anything that looks wrong before relying on the numbers.
5. If this repository is billed to a real client, mention that projects
   start with no rate on purpose — a guessed rate would show a fake
   amount — and that `estela rate set --project <id> --rate <amount>` sets
   it once they know the right number.

Nothing here sends any data anywhere. That only happens if the user later
runs `estela login` and `estela publish` themselves.
