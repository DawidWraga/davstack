---
'@davstack/cli-utils': minor
'@davstack/playwright-server': patch
'@davstack/vitest-server': patch
'@davstack/logs-server': patch
---

Daemons now auto-load `.env` on `serve`

The three daemons (`playwright-server`, `vitest-server`, `logs-server`)
now walk up from their `cwd` looking for a `.env` file at boot and fold
it into `process.env` before loading config or starting heavy work.
This fixes the long-standing surprise where `npx <daemon> serve` (or a
launch from the TUI) saw an empty env, breaking config files and
helpers like `refreshAuth` that read `process.env.E2E_USER_EMAIL` etc.

- Walks from `cwd` up to the repo root (`pnpm-workspace.yaml` / `turbo.json` / `package.json#workspaces` / `.git`), capped at 8 levels.
- Existing `process.env` values win (`dotenv` `override: false`).
- Single startup log line: `[<daemon>] loaded .env from <abs-path> (N keys)`. Silent when nothing is found.
- Opt out with `DAVSTACK_NO_DOTENV=1` (e.g. CI).

New `@davstack/cli-utils/dotenv` subpath export (`loadDotenv`,
`findDotenv`) so any future daemon can adopt the same behavior in one
line.
