# Troubleshooting

## `(0 test)` on every rerun

The storybook addon-vitest plugin is half-initialised. Cause: `primeFile` is missing, doesn't exist, or doesn't match the configured `project`.

Fix: point `primeFile` at a real story file that the project picks up. See [setup.md §2](./setup.md).

## `Vitest failed to find the current suite`

Workspace has two `vitest` versions resolved — the daemon's worker imports one, the consumer's test file imports another.

Fix: add `resolve.alias.vitest` in `vite.config.ts` pinning to a single copy, or `pnpm dedupe vitest`.

## `could not resolve 'vitest/node' from <cwd>`

`vitest` not installed in the consumer project, or `--cwd` points at a workspace without it. Install in the right project or pass `--cwd <path>`.

## Port already in use

Another daemon (or any process) is bound. `pnpm exec vitest-server shutdown` if it's an orphaned daemon; otherwise pass `--port <n>` or set `VITEST_SERVER_PORT`.

## `No test files found`

On Windows the file path was passed with backslashes. The session normalises to forward slashes internally, but if you're calling `POST /run` directly, send forward slashes — vitest's `_isCachedTestFile` does literal `.includes()` against a tinyglobby list, always forward-slash.

## Daemon crashes after a config edit

Vitest watches `vite.config.ts` and reloads — the addon-vitest preset re-runs and may diverge from warm state. Restart `serve` after touching any config.

## Bun on Windows hangs on boot

Known broken (storybook 10.3 emits malformed `file:/C:/…` URLs). Use Node. See [setup.md §3](./setup.md#3-runtime-matrix).
