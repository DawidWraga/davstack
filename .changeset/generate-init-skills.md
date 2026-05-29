---
"@davstack/init": minor
"@davstack/logs-server": patch
"@davstack/vitest-server": patch
"@davstack/playwright-server": patch
---

Generate init's shipped skill files from the canonical `skills/` instead of hand-forking them.

`packages/init/src/skills/<name>.md` is now a generated artifact derived from the canonical `skills/<name>/SKILL.md` via `scripts/sync-init-skills.ts` (`pnpm gen:init-skills`). Relative repo doc links (`../../packages/<pkg>/...`) are rewritten to `node_modules/@davstack/<pkg>/...` so the installed skill's links resolve against the user's locally-installed, version-matched package docs (offline, no GitHub fetch). This fixes drift where the frozen fork shipped removed APIs to users.

The three daemon packages now ship their `docs/**` and `README.md` so those rewritten links resolve inside `node_modules`.
