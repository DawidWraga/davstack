# @davstack/init

One-shot bootstrap CLI for the `@davstack/*` daemons + their Claude Code skills.

## Why

- **One command to wire the stack.** Installs the daemons you pick, scaffolds `.davstack/config/*.config.ts`, patches `.gitignore`, and installs the matching Claude Code skills into `~/.claude/skills/` — single pass.
- **Idempotent for configs.** Existing `.davstack/config/*.config.ts` files are left untouched; only missing `.gitignore` lines are appended. Safe to re-run on a half-configured repo.
- **Overwrites skills.** Re-running init bumps `~/.claude/skills/<name>/SKILL.md` to the version shipped with the installed init — that's how you "update" skills.
- **Matches your stack.** Walks up for the git/workspace root, sniffs the lockfile, so install uses pnpm/yarn/bun/npm correctly (incl. `-w` for pnpm workspace roots).

## Install

```bash
# zero-install: run once, no dependency added
pnpm dlx @davstack/init --all
```

## Usage

```bash
# interactive — checkbox prompt picks which daemons to wire up
pnpm dlx @davstack/init

# non-interactive — everything (all daemons + every bundled skill)
pnpm dlx @davstack/init --all --all-skills

# non-interactive — subset of daemons; tool-tied skills only
pnpm dlx @davstack/init --tools=logs-server,vitest-server

# refresh ALL bundled skills without touching deps or configs
pnpm dlx @davstack/init --all-skills --skip-install --no-scaffold

# install daemons but don't touch the global skills dir
pnpm dlx @davstack/init --all --no-scaffold   # `--no-scaffold` also skips skills
```

## What gets installed where

| Selected tool | npm package added | Skills installed |
| --- | --- | --- |
| `logs-server` | `@davstack/logs-server` | `logs-server` |
| `vitest-server` | `@davstack/vitest-server` | `vitest-server` |
| `playwright-server` | `@davstack/playwright-server` | `playwright-server` |
| `open-agents` | `@davstack/open-agents` | `explore`, `fast-edit` |
| *(always)* | — | `diagnose` (orchestrator) |

Skills land in `~/.claude/skills/<name>/SKILL.md`. Configs land in `<repo-root>/.davstack/config/<name>.config.ts` (typed via `import type { ServerConfig } from '@davstack/<name>/config'`).

## Flags

| Flag | Description |
| --- | --- |
| `--all` | Select every tool without prompting. |
| `--tools <list>` | Comma-separated subset: `logs-server,vitest-server,playwright-server,open-agents`. |
| `--all-skills` | Install every bundled `SKILL.md` regardless of selected tools. Use to refresh skills from a previous init run without re-selecting all tools. |
| `--skip-install` | Scaffold only — skip the package manager step. Same as `DAVSTACK_INIT_SKIP_INSTALL=1`. |
| `--no-scaffold` | Install only — skip writing `.davstack/`, `.gitignore`, **and** skills. |
| `-h, --help` | Print help. |

## Next

After init, see each daemon's own README:

- [@davstack/logs-server](../logs-server/README.md) — local sqlite log sink
- [@davstack/vitest-server](../vitest-server/README.md) — warm Vitest daemon
- [@davstack/playwright-server](../playwright-server/README.md) — warm Playwright daemon
- [@davstack/open-agents](../open-agents/README.md) — `explore` + `fast-edit` cursor-agent jobs
