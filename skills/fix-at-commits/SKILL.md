---
name: fix-at-commits
description: >-
  Strip the stray leading `@` from unpushed commit messages (a PowerShell
  here-string glitch that buries the real subject under a bare `@` line).
  Use when commits show up as `@ <subject>` in git log or the first line
  looks blank/invisible.
---

Run from the repo root (dry-run first, shows before/after):

    bun ~/.claude/skills/fix-at-commits/fix-at-commits.ts            # preview
    bun ~/.claude/skills/fix-at-commits/fix-at-commits.ts --apply    # rewrite

Safe by design: only touches UNPUSHED commits, refuses detached HEAD / merge
commits, never touches the working tree (pure `git commit-tree`), preserves
author + dates, backs up the tip first, and verifies the rewritten tree is
identical before moving the branch. Restore/cleanup commands are printed on apply.
