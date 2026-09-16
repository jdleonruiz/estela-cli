---
description: Set up Estela in this repository for the first time, to start reconstructing billable hours from Claude Code sessions and git history. Use when the user wants to start tracking hours, set up time tracking, install Estela, or mentions Estela without it being configured yet.
---

# Estela: first-time setup

1. Run `npx estela setup` from the repository root. It requires Node 22.5
   or later (for `node:sqlite`); if it fails because of an old Node
   version, the error message it prints already says so — relay that
   message rather than guessing at the cause, and suggest `nvm install
   --lts` or installing from https://nodejs.org.
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
