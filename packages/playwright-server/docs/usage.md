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

On failure, `error` is `{ name, message, stack }`. The spec is parsed with a small AST-free extractor: only the **first** top-level `test('...', async ({ page, ... }) => { ... })` block runs, and it executes inside an `AsyncFunction` against the warm page — Playwright's worker pool, global setup, and fixture machinery are bypassed. Tradeoff: codegen-style single-test specs work; describe blocks, beforeEach hooks, and custom fixtures don't.

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

- **Boot once** with `serve`. Heavy: ~5–15s to launch chromium, load config, seed auth, open the page.
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

See [troubleshooting.md](./troubleshooting.md) — port conflicts, missing chromium, profile corruption, stale auth, extractor restrictions.
