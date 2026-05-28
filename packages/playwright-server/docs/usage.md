# Usage

Two layers:

1. **`serve`** — heavy. Boots chromium + context + page. Run once per session, leave in the background.
2. **Client verbs** — cheap (~50 ms). Fetch the running daemon over HTTP; don't import chromium.

## CLI verbs

| Verb | Description |
|------|-------------|
| `serve` | Boot the long-lived warm-browser daemon (the heavy one). |
| `run <file>` | Execute a spec file's first `test()` body against the warm page. Returns `RunResult` JSON. |
| `goto <url>` | Navigate the live page. Returns `{ "url": "..." }`. |
| `refresh-auth` | Call the config's `refreshAuth`, write a new `storageStatePath`, reseed the live context. See [auth.md](./auth.md). |
| `health` | Liveness check. Returns `{ ok, pid, url }`. |
| `shutdown` | Gracefully close the browser and exit the daemon. |

### Routing this run's logs to a session DB

Pass `--db=<name>` to seed `window.__davstack_db` before the page boots:

```bash
playwright-server run --db=reorder-bug e2e/reorder-flow.spec.ts
```

When the consumer's `Sentry.init` stamps `davstack-logs.db` in its `beforeSendLog` (3-line addition — see `@davstack/logs-server` `docs/transmitter-wiring.md`), every log this spec emits lands in `.davstack/logs/reorder-bug.db` instead of `default.db`. Omit the flag and logs route to `default.db` as usual.

The daemon installs a context-level `addInitScript` so the value survives mid-spec navigations and re-seeds itself on every new document load. The value persists for subsequent runs until you pass a different `--db` or restart the daemon.

`run <file>` shape (from `RunResult`):

```json
{
  "ok": true,
  "durationMs": 842,
  "setupMs": 120,
  "file": "e2e/smoke.spec.ts",
  "error": null
}
```

On failure, `error` is `{ name, message, stack }`. Specs are loaded as real ES modules — the daemon installs a loader hook that redirects `@playwright/test` imports to an in-memory stub, captures every `test()` and `test.describe()` registration, and runs the captured blocks sequentially against the warm page. Full TypeScript, module-level imports/helpers, multiple `test()` blocks, `test.describe`, `test.beforeEach` / `afterEach`, and `test.use({ storageState })` all work. Custom `test.extend(...)` fixtures are the one current gap (the daemon fails fast and points at this limitation). Playwright's worker pool, global setup, and projects config are bypassed by design — runs share the single warm context.

## HTTP API

The daemon listens on `http://<host>:<port>` (default `127.0.0.1:5180`). Routes:

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/health` | — | `{ ok, pid, url }` |
| POST | `/run` | `{ file }` | `RunResult` |
| POST | `/goto` | `{ url }` | `{ url }` |
| POST | `/refresh-auth` | — | `{ ok, origin?, keys?, error? }` |
| POST | `/shutdown` | — | `{ ok: true }` (then exits) |

Use the CLI verbs unless you need to embed the daemon into a custom agent runner.

## Lifecycle

- **Boot once.** Recommended: `davstack start`. Standalone: `pnpm exec playwright-server serve`. Heavy: ~5–15s to launch chromium, load config, seed auth, open the page.
- **Drive cheaply** thereafter from the CLI or HTTP. Run lock in `session.ts` serialises concurrent `/run` calls — they queue, never interleave.
- **Shutdown** via `playwright-server shutdown`, `SIGINT`, or `SIGTERM`. All three close the context + browser cleanly; closing the chromium window directly is treated as a crash and exits the daemon with code 1.

## Agent integration pattern

The intended loop, e.g. for TDD-style e2e iteration:

1. Agent boots `playwright-server serve` once (background process).
2. Agent edits a spec under `e2e/`.
3. Agent calls `playwright-server run <file>` and reads the JSON exit. On `ok: false`, the `error.message` + `error.stack` go into the next turn.
4. Repeat 2–3 inside the same warm window — page heap, auth, scroll position, and React state all survive between runs.

For raw click-iteration (no spec file), drive the daemon directly via `goto` and Playwright's codegen — record a click sequence, paste into a spec, `run` against the same window the user just clicked in.

## Troubleshooting

See [troubleshooting.md](./troubleshooting.md) — port conflicts, missing chromium, profile corruption, stale auth, `test.extend` gap.
