---
name: playwright-server
description: >-
  Run a Playwright spec or drive a live browser against a warm long-lived
  chromium daemon — spec iteration drops from ~15-25s cold to ~1-3s warm.
  Use when the user asks to run / rerun an e2e spec, click through a flow,
  reproduce a bug in-browser, or you've just edited a spec and want a
  fast pass/fail cycle. Auth persists across runs via `storageStatePath`.
  Skip for full-suite CI runs (use `playwright test` directly) or when
  configuring playwright itself.
---

<!-- GENERATED from skills/playwright-server/SKILL.md by scripts/sync-init-skills.ts — DO NOT EDIT BY HAND -->

> Doc links in this skill are written relative to your project root (where `node_modules/` lives), not to this file.

Boot once per session, then drive cheaply. First run `davstack check` to
confirm the daemon is running.

> If `davstack check` reports a daemon down, ask the user to run `davstack start` in a **separate terminal** — this makes the whole session faster. Claude can't run it for you; it must live in its own terminal. Do not run `serve` yourself.

Once the daemon is up, drive it with the per-daemon CLI:

    playwright-server run <file>             # warm rerun (~1-3s); JSON RunResult
    playwright-server goto <url>             # navigate live page (returns { url })
    playwright-server refresh-auth           # mint a fresh session, reseed context

Exit `0` = pass, `1` = fail. Specs are loaded as real ES modules — full
TypeScript, multiple `test()` blocks, `test.describe`, `beforeEach` /
`afterEach`, and `test.use({ storageState })` all work. Custom
`test.extend(...)` fixtures are the one current gap. See
[`usage.md`](node_modules/@davstack/playwright-server/docs/usage.md) for details.

If results look wrong (blank window, cold-boot crash, `no test() block found`, 401 redirects, daemon exit 1), the failure is usually in the daemon, not your code — check `troubleshooting.md` before iterating, or fall back to `playwright test`.

## Reference

- [`README.md`](node_modules/@davstack/playwright-server/README.md) — overview, install, why
- [`docs/setup.md`](node_modules/@davstack/playwright-server/docs/setup.md) — config file, defaults, peer-dep, sanity check
- [`docs/usage.md`](node_modules/@davstack/playwright-server/docs/usage.md) — CLI verbs, HTTP API, codegen-paste workflow, agent-loop pattern
- [`docs/auth.md`](node_modules/@davstack/playwright-server/docs/auth.md) — `refreshAuth` seam + `storageStatePath` lifecycle
- [`docs/troubleshooting.md`](node_modules/@davstack/playwright-server/docs/troubleshooting.md) — the daemon-vs-code triage tree

## CLI reference

<!-- BEGIN cli-reference (generated — do not edit by hand) -->

`playwright-server` — Long-lived warm-browser daemon + CLI client for fast e2e iteration.

| Command | Description | Positionals & flags |
| --- | --- | --- |
| `playwright-server serve` | Boot the long-lived warm-browser daemon | `--port <number>` (default: `5180`, env: `PLAYWRIGHT_SERVER_PORT`) — HTTP listen port<br>`--host <string>` (default: `"127.0.0.1"`, env: `PLAYWRIGHT_SERVER_HOST`) — HTTP listen host<br>`--cwd <string>` (default: `(current directory)`) — Consumer project root (where playwright-server.config.ts lives) |
| `playwright-server run` | Execute a spec file against the running daemon | `<file>` — Spec path<br>`--port <number>` (default: `5180`, env: `PLAYWRIGHT_SERVER_PORT`)<br>`--host <string>` (default: `"127.0.0.1"`, env: `PLAYWRIGHT_SERVER_HOST`)<br>`--db <string>` — Route this run's logs to .davstack/logs/<db>.db via the davstack-logs.db attribute (logs-server 2.0+) |
| `playwright-server goto` | Navigate the live page to a URL | `<url>`<br>`--port <number>` (default: `5180`, env: `PLAYWRIGHT_SERVER_PORT`)<br>`--host <string>` (default: `"127.0.0.1"`, env: `PLAYWRIGHT_SERVER_HOST`) |
| `playwright-server refresh` | Flush spec-module ESM cache and re-read config without restarting (keeps the warm browser + daemon PID alive). Pass --hard for a full shutdown + detached re-serve when soft refresh is insufficient (port/host change, wedged browser). | `--port <number>` (default: `5180`, env: `PLAYWRIGHT_SERVER_PORT`)<br>`--host <string>` (default: `"127.0.0.1"`, env: `PLAYWRIGHT_SERVER_HOST`)<br>`--hard <boolean>` (default: `false`) — Full shutdown + detached re-serve (loses daemon PID).<br>`--cwd <string>` (default: `(current directory)`) — Consumer project root passed to the re-spawned serve (--hard only). |
| `playwright-server refresh-auth` | Mint a fresh session and reseed the live context | `--port <number>` (default: `5180`, env: `PLAYWRIGHT_SERVER_PORT`)<br>`--host <string>` (default: `"127.0.0.1"`, env: `PLAYWRIGHT_SERVER_HOST`) |
| `playwright-server health` | Daemon liveness check | `--port <number>` (default: `5180`, env: `PLAYWRIGHT_SERVER_PORT`)<br>`--host <string>` (default: `"127.0.0.1"`, env: `PLAYWRIGHT_SERVER_HOST`) |
| `playwright-server shutdown` | Stop the running daemon | `--port <number>` (default: `5180`, env: `PLAYWRIGHT_SERVER_PORT`)<br>`--host <string>` (default: `"127.0.0.1"`, env: `PLAYWRIGHT_SERVER_HOST`) |
| `playwright-server doctor` | Validate local install (node, peer dep, chromium, config, daemon liveness) | `--port <number>` (default: `5180`, env: `PLAYWRIGHT_SERVER_PORT`)<br>`--host <string>` (default: `"127.0.0.1"`, env: `PLAYWRIGHT_SERVER_HOST`)<br>`--cwd <string>` (default: `(current directory)`)<br>`--json <boolean>` (default: `false`) — JSON output for agent parsing |
| `playwright-server check` | Validate local install (deprecated alias for 'doctor') | `--port <number>` (default: `5180`, env: `PLAYWRIGHT_SERVER_PORT`)<br>`--host <string>` (default: `"127.0.0.1"`, env: `PLAYWRIGHT_SERVER_HOST`)<br>`--cwd <string>` (default: `(current directory)`)<br>`--json <boolean>` (default: `false`) — JSON output for agent parsing |

<!-- END cli-reference -->
