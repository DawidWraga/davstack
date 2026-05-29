---
"@davstack/logs-server": patch
"@davstack/vitest-server": patch
"@davstack/playwright-server": patch
---

Extract each daemon's `defineCli` argument into a side-effect-free
`src/cli-spec.ts` (`export const cliSpec`) and have `index.ts` import it.
Behavior is identical — this just lets the skill CLI-reference generator
import the spec without executing the CLI. The generated command-reference
block in each daemon's `skills/<server>/SKILL.md` is now produced
mechanically from this spec (run `pnpm gen:skill-cli`), so the verb/flag
list can't silently drift from the actual CLI.
