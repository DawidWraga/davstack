# @davstack/playwright-server

## 1.7.0

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

### Patch Changes

- Updated dependencies
  - @davstack/cli-utils@1.3.0

## 1.6.0

### Minor Changes

- Add `refresh` verb to all three daemons (#59). Flushes cached state in
  place without exiting the process, so an agent's cache-busting no longer
  steals the daemon PID out of a TUI session.

  **playwright-server**

  - New `POST /refresh` endpoint and `playwright-server refresh` CLI verb.
  - The spec-import URL now uses a per-session `?_pwsRev=<n>` cache-bust
    bumped only by `/refresh` (instead of `?t=<Date.now()>` on every run).
  - The Node loader hook (`spec-loader.mjs`) propagates that query string
    down to every transitively-imported `file://` module so edits to UI
    models, fixtures, and other non-spec helpers actually pick up after a
    refresh. Previously only the spec file itself was cache-busted; any
    module it imported was pinned in Node's ESM cache forever.
  - `node_modules`, `node:` builtins, and the `@playwright/test` stub
    redirect are excluded from rev propagation.
  - `GET /health` and `health` CLI verb now include `refreshedAt` (ISO
    timestamp of the last successful refresh, or `null`).
  - The browser, context, page, persistent profile, and HTTP socket all
    stay alive across a refresh — the same PID, no chromium flash.
  - Config drift (`baseUrl`, `storageStatePath`) is surfaced as flags on
    the response but NOT auto-applied; follow up with shutdown + serve if
    you need those reseated.

  **vitest-server**

  - New `POST /refresh` endpoint and `vitest-server refresh` CLI verb.
  - Invalidates every plausible Vite module-graph + vite-node module-cache
    surface so an edit to a non-test source file picks up on the next
    `run`. Tolerates Vitest's version drift across 1.x / 2.x / 3.x / 4.x
    by walking every shape rather than version-detecting.
  - `GET /health` now includes `refreshedAt`.

  **logs-server**

  - New `POST /__refresh` endpoint and `logs-server refresh` CLI verb. The
    `/__` prefix avoids colliding with Sentry SDK envelope URLs
    (`/api/<id>/envelope/`).
  - New `GET /__health` endpoint and `logs-server health` CLI verb,
    returning `pid` and `refreshedAt`.
  - In multi-DB dispatch mode, `/__refresh` closes every cached SQLite
    handle so the next ingest reopens against the current on-disk schema —
    covers manual schema edits, sqlite file replacement, and per-session
    DB rotation. In single-DB pinned mode, the daemon holds a permanent
    `Database` reference so handles are not evicted (the refresh only
    re-reads config).
  - Both endpoints are deliberately exempted from the "any POST = envelope"
    fall-through so adding them is back-compat: ordinary envelope POSTs to
    `/api/.../envelope/` still ingest as before.

  Why this matters: agentic edit-rerun loops over a playwright spec used
  to need `shutdown + serve` to evict stale modules — which silently
  re-parents the daemon from the user's `davstack start` TUI to the
  agent's shell, breaking the TUI's stdout panel and PID adoption. The
  refresh verb closes that gap.

## 1.5.0

### Minor Changes

- a937858: Drop `legacyExtract` config option and the legacy regex-based spec
  runner. The registration-interception runner is now the only path:
  specs load as real ES modules, supporting full TypeScript, multiple
  `test()` blocks, `test.describe`, `beforeEach`/`afterEach`, and
  `test.use({ storageState })`. Custom `test.extend(...)` fixtures remain
  the one unsupported case. Requires Node >= 22.6.

  Also: docs (README, setup.md, usage.md, troubleshooting.md, SKILL)
  aligned to the scaffolder-first doctrine — `pnpx @davstack/init` is the
  recommended install path, `davstack start` is the recommended boot path,
  with `pnpm exec playwright-server serve` retained as the standalone
  alternative.

## 1.4.1

### Patch Changes

- Internal: tighten `window.__davstack_db` typing to a
  `Window & { __davstack_db?: string }` intersection cast (no behavior
  change).
- Docs: README aligned with the `logs-server` pattern.

## 1.4.0

### Minor Changes

- Add `--db=<name>` flag to `playwright-server run`. When set, the daemon
  seeds `window.__davstack_db` on the warm browser context (via
  `addInitScript` + a one-shot `page.evaluate`) before evaluating the
  spec. Consumers who stamp the `davstack-logs.db` Sentry log attribute
  in their `beforeSendLog` (see `@davstack/logs-server`
  `docs/transmitter-wiring.md`) get the run's logs routed to
  `.davstack/logs/<name>.db` instead of the shared `default.db`.

  No flag → no global → no attribute → unchanged behavior. Safe with
  `@davstack/logs-server` 1.x consumers who don't read the attribute
  (it's just a string set on `window`).

  Daemon-side: `session.runOnce(file, { db })` accepts the option;
  client-side: `runFile(file, opts, { db })` carries it through `/run`.

## 1.3.0

### Minor Changes

- c41a9c3: Registration-interception runner for normal Playwright specs

  The daemon now loads a spec file as a real ES module and intercepts
  `@playwright/test` registration calls (`test()`, `test.describe`,
  `test.beforeEach` / `afterEach`, `test.beforeAll` / `afterAll`,
  `test.use`) into an in-memory registry, then runs each captured test
  sequentially against the warm browser. Replaces the regex source-
  extractor that previously only handled single-block codegen-style
  specs.

  Now supported in user spec files:

  - Full TypeScript (native `--experimental-strip-types`, Node >= 22.6)
  - Module-level imports and helper functions
  - Multiple `test()` blocks
  - `test.describe` (flattened into the run order)
  - `test.beforeEach` / `afterEach` lifecycle hooks
  - `test.beforeAll` / `afterAll` lifecycle hooks
  - `test.use({ storageState })` config capture

  Not yet supported: custom `test.extend(...)` fixtures fail fast with a
  clear error pointing at the limitation. Workarounds: use
  `test.beforeEach` for shared setup, or module-level helper functions.

  The legacy regex extractor stays available behind
  `legacyExtract: true` in `playwright-server.config.ts` for codegen-
  style single-block specs.

  Node engine bumped to `>=22.6` (required for native TypeScript loading;
  default in Node 24).

## 1.2.2

### Patch Changes

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

- Updated dependencies [2c18da2]
  - @davstack/cli-utils@1.2.0

## 1.2.1

### Patch Changes

- ade2196: Ship `.d.ts` declarations so consumers can import `ServerConfig` (and
  other public types) from `@davstack/{logs,vitest,playwright}-server/config`
  and `@davstack/cli-utils` without `TS2307: Cannot find module ... or its
corresponding type declarations`.

  Runtime output is byte-stable — only declarations are new. Non-breaking.

  See: 8065fc9 (`fix(daemons): ship .d.ts for @davstack/{cli-utils,logs-server,vitest-server,playwright-server}`)

- Updated dependencies [ade2196]
  - @davstack/cli-utils@1.1.1

## 1.1.1

### Patch Changes

- Fix tsx launcher path: resolve `tsx/cli` (its exported subpath) instead of
  the unexported `tsx/dist/cli.mjs`, which Node refused with
  `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## 1.1.0

### Minor Changes

- - Default bin launchers to `tsx` runtime. tsx loads TS from `node_modules`
    (which Node 24's `--experimental-transform-types` rejects) and avoids the
    bun-vs-vitest incompatibility that crashed vitest-server mid-run.
    Opt into bun with `<NAME>_RUNTIME=bun` or plain Node with `=node`.
  - Add `exports` map with `./config` subpath to each daemon package, so
    consumer `.davstack/config/<name>-server.config.ts` files can do:

    ```ts
    import type { ServerConfig } from "@davstack/logs-server/config";
    ```

    instead of brittle deep-imports into `/src/`.

  - Split `ServerConfig` into two: a user-facing all-optional shape (what you
    `satisfies`) and an internal `ResolvedConfig` (post-merge with defaults).
    `port` and `host` are now first-class fields on `ServerConfig`, so the
    scaffolded config files type-check cleanly with no intersections.
  - Update init's templates to use the new clean imports.
  - playwright-server: move `ServerConfig` + `loadConfig` from `auth.ts` to a
    new `config.ts` so the `exports` subpath points at a single-purpose file.
    `auth.ts` re-exports for back-compat.

## 1.0.1

### Patch Changes

- Default bin launcher to bun runtime so TS source loads under node_modules.
  Node 24's `--experimental-transform-types` rejects TS files under node_modules;
  falling back to bun (with `*_RUNTIME=node` opt-out) matches the sibling
  `logs-server` / `open-agents` pattern.

## 1.0.0

### Major Changes

- Initial 1.0.0 release.

### Patch Changes

- Updated dependencies
  - @davstack/cli-utils@1.0.0
