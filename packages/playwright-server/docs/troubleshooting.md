# Troubleshooting

## Port already in use

Another `serve` is still running. `playwright-server shutdown` then retry, or pick a free port via `--port` / `PLAYWRIGHT_SERVER_PORT`.

## `could not resolve '@playwright/test' from <cwd>`

Peer dep missing. `pnpm add -D @playwright/test` in the consumer project.

## `browserType.launch: Executable doesn't exist`

Chromium not installed. `pnpm exec playwright install chromium`.

## Profile / cache corruption

Symptoms: cold-boot crashes, blank window, stale extensions.

Fix: `rm -rf .playwright-profile` and re-`serve`. The persistent-profile fallback only runs when no `storageStatePath` seed exists — if seeded, the profile is regenerated each boot.

## Storage state stale

Symptoms: logged out mid-run, 401 responses, redirect to login page.

Fix: `playwright-server refresh-auth`. If `refreshAuth` is unset in config, see [auth.md](./auth.md).

## `test.extend(...)` not supported

The runner loads specs as real ES modules and intercepts `@playwright/test` registrations, so full TypeScript, multiple `test()` blocks, `test.describe`, `beforeEach` / `afterEach`, and `test.use({ storageState })` all work. Custom `test.extend(...)` fixtures are the one current gap — the daemon fails fast with a pointer to this limitation. Workarounds: use `test.beforeEach` for shared setup, or call module-level helper functions.

## Daemon exits with code 1 after closing the chromium window

Treating the window-close as a crash is intentional: the warm context is gone, no recovery path. Re-`serve` to boot a fresh window.
