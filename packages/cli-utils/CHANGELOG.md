# @davstack/cli-utils

## 1.3.0

### Minor Changes

- Add `refresh --hard` to all three daemons for opt-in shutdown + detached re-serve.

  Soft `refresh` (the default, added in the previous release) re-inits in place
  and preserves the daemon PID, which is what the TUI's `davstack start` watcher
  needs. But it can't re-bind the listening socket or re-spawn the underlying
  runtime — so when you change `port`/`host`/`cors`, upgrade a peer dep, or the
  chromium/vitest internals get wedged, you need a real restart.

  `refresh --hard` is that escape hatch:

  1. Best-effort `POST /shutdown` (`/__shutdown` for logs-server) to the current
     daemon.
  2. Wait for the listening socket to release (Windows in particular can EADDRINUSE
     on immediate re-bind).
  3. Spawn a detached `<process.execPath> <argv[1]> serve …` so the runtime is
     inherited (node for playwright-server/vitest-server, bun for logs-server).
  4. Poll `/health` (`/__health` for logs-server) until the new daemon answers,
     then exit with `{ ok: true, pid, startupMs }`.

  The PID changes, so the TUI's watcher reattaches on its next health probe.

  The shutdown + spawn + poll loop now lives in `@davstack/cli-utils/restart` as
  `restartDaemon()` — three near-identical copies would have rotted out of sync.

  logs-server also gains a `POST /__shutdown` route so the helper has something
  to call; previously the only way to stop it was SIGINT/SIGTERM.

  The soft `refresh` verb is unchanged and remains the default. Use `--hard` only
  when soft is insufficient — you pay the full cold-boot cost of the daemon
  (several seconds for playwright-server, slower for vitest-server).

## 1.2.0

### Minor Changes

- 2c18da2: Daemons now auto-load `.env` on `serve`

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

## 1.1.1

### Patch Changes

- ade2196: Ship `.d.ts` declarations so consumers can import `ServerConfig` (and
  other public types) from `@davstack/{logs,vitest,playwright}-server/config`
  and `@davstack/cli-utils` without `TS2307: Cannot find module ... or its
corresponding type declarations`.

  Runtime output is byte-stable — only declarations are new. Non-breaking.

  See: 8065fc9 (`fix(daemons): ship .d.ts for @davstack/{cli-utils,logs-server,vitest-server,playwright-server}`)

## 1.0.0

### Major Changes

- Initial 1.0.0 release.
