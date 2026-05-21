# @davstack/init

One-shot bootstrap CLI for the `@davstack/*` daemons.

## Why

- **One command to wire the stack.** Installs the daemons you pick, scaffolds `.davstack/config/*.config.ts`, patches `.gitignore` — single pass.
- **Idempotent.** Existing config files are left untouched; only missing `.gitignore` lines are appended. Safe to re-run on a half-configured repo.
- **Matches your stack.** Walks up for the git/workspace root, sniffs the lockfile, so install uses pnpm/yarn/bun/npm correctly (incl. `-w` for pnpm workspace roots).

## Install

```bash
# zero-install: run once, no dependency added
pnpm dlx @davstack/init --all
```

## Usage Example

```bash
# interactive — checkbox prompt picks which daemons to wire up
pnpm dlx @davstack/init

# non-interactive — everything
pnpm dlx @davstack/init --all

# non-interactive — subset
pnpm dlx @davstack/init --tools=logs-server,vitest-server
```

## Flags

| Flag | Description |
| --- | --- |
| `--all` | Select every tool without prompting. |
| `--tools <list>` | Comma-separated subset: `logs-server,vitest-server,playwright-server,open-agents`. |
| `--skip-install` | Scaffold only — skip the package manager step. Same as `DAVSTACK_INIT_SKIP_INSTALL=1`. |
| `--no-scaffold` | Install only — skip writing `.davstack/` and `.gitignore`. |
| `-h, --help` | Print help. |

## Next

After init, see each daemon's own README:

- [@davstack/logs-server](../logs-server/README.md) — local sqlite log sink
- [@davstack/vitest-server](../vitest-server/README.md) — warm Vitest daemon
- [@davstack/playwright-server](../playwright-server/README.md) — warm Playwright daemon
