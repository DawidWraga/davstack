# Usage

## CLI verbs

| Verb | Description |
|------|-------------|
| `serve` | Boot the long-lived daemon. Heavy (~50s cold). Holds the process; SIGINT / SIGTERM trigger a graceful `session.shutdown()`. |
| `run <file>` | POST to a running daemon; rerun one file and print the JSON `RunResult`. Exit `0` on pass, `1` on fail. |
| `health` | GET `/health`. Prints `{ ok, pid }`. |
| `shutdown` | POST `/shutdown`. Best-effort — the daemon may close the socket before responding. |

Common flags (`--help` on each verb prints the full list):

- `serve`: `--port` `--host` `--cwd` `--project` `--prime`
- `run`: `--port` `--host` `--grep <pattern>` (forwards to vitest's `testNamePattern`)
- `health` / `shutdown`: `--port` `--host`

## HTTP API

The daemon listens on `http://<host>:<port>` (default `127.0.0.1:5179`).

| Method | Path | Body | Response |
|--------|------|------|----------|
| `GET` | `/health` | — | `{ ok: true, pid: number }` |
| `POST` | `/run` | `{ file: string, testNamePattern?: string }` | `RunResult` (see below) |
| `POST` | `/shutdown` | — | `{ ok: true }` then process exits |

Unknown routes return `404 { ok: false, error: "not found" }`. Handler exceptions return `500` with `{ ok, error, stack }`.

### `RunResult` shape

```ts
{
  ok: boolean              // false if any test failed OR run-level errors present
  durationMs: number
  file: string             // echoes the request
  summary: { total: number, passed: number, failed: number, skipped: number }
  tests: TestEntry[]       // per-test entries; full shape in src/format.ts
  errors: unknown[]        // run-level: vitest crashes, setup throws, unhandled rejections
}
```

`POST /run` is serialised — the session holds a single `runLock` so concurrent requests queue rather than racing the same Vitest instance. Expect 3-15s typical, longer on the first warm rerun after a config edit.

## Agent TDD loop

```bash
# Boot once. Recommended: `davstack start` (TUI-supervised).
# Standalone alternative: `pnpm exec vitest-server serve &`.
davstack start

# Per iteration: edit, rerun. Exit code drives the loop.
pnpm exec vitest-server run src/foo/bar.test.tsx
if [ $? -eq 0 ]; then echo "green"; else echo "red — read JSON errors"; fi
```

The CLI prints the full `RunResult` JSON to stdout; pipe to `jq` to slice `tests[] | select(.state=="failed")`.

For programmatic use, hit the HTTP API directly — `client.ts` (`runFile`, `health`, `shutdown`) is the reference. It's an internal module but the shapes are stable.

## Lifecycle

- **Boot.** Recommended: `davstack start`. Standalone: `pnpm exec vitest-server serve &`, then poll `health` until `ok: true`.
- **Coexistence with `vitest watch`.** Don't run both against the same project — they'll both invalidate Vite caches and fight for the playwright workers. Pick one.
- **Config edits.** Editing `vitest.config.ts` / `vite.config.ts` / `vitest-server.config.ts` while the daemon is running is not hot-reloaded. Restart `serve`.
- **Shutdown.** `pnpm exec vitest-server shutdown`, or SIGINT the `serve` process. Both call `session.shutdown()` → `vitest.close()`.

## Troubleshooting

See [troubleshooting.md](./troubleshooting.md) — `(0 test)` bug, version mismatch, port conflicts, Bun-on-Windows, config-edit crashes.
