# @davstack/logs-server

## 2.1.0

### Minor Changes

- **BREAKING**: removed `logs-server query` CLI verb (subcommands `run`, `trace`,
  `errors`, `filter`). Use `sqlite3 -header -column .davstack/logs/<db>` against
  the `logs_v` view directly. The verb was already demoted in 1.3.2 docs as
  "sanity / one-off greps only" — it grepped the `msg` body and could not reach
  structured probe attributes (the whole point of the OTel envelope), and cost
  ~10× sqlite's cold-boot. See [`docs/reading-logs.md`](./docs/reading-logs.md)
  for ready-to-paste recipes against `logs_v`.

  Migration:

  ```bash
  # before
  logs-server query filter --grep "clicked save"

  # after
  sqlite3 -header -column .davstack/logs/default.db "
    SELECT ts, msg, json_extract(attrs, '\$.user_id') AS user_id
    FROM logs_v
    WHERE msg LIKE '%clicked save%'
    ORDER BY ts;
  "
  ```

  `serve` / `check` / `prune` unchanged.

## 2.0.0

### Major Changes

- Multi-DB log routing via the `davstack-logs.db` Sentry log attribute.
  Transmitters that stamp the attribute on a log envelope cause the daemon to
  dispatch that row to `.davstack/logs/<value>.db`; un-tagged emissions land
  in `.davstack/logs/default.db`. The DB file IS the session boundary —
  cross-session noise disappears, eval runs can co-locate logs with their
  artifacts, and each session DB hosts its own SQL views with cleanup via
  `rm`. ([#51](https://github.com/DawidWraga/davstack/issues/51))

  **Breaking change: default DB path moved.** Pre-2.0 used a single
  `<repo-root>/.davstack/logs.db`; 2.0+ uses
  `<repo-root>/.davstack/logs/default.db`. Migration is one command:

  ```bash
  mv .davstack/logs.db .davstack/logs/default.db
  ```

  `logs-server check` flags the legacy file's presence and prints the exact
  `mv` invocation. Existing scripts that hardcode `.davstack/logs.db` need
  the path updated. Pinning the daemon to a single file with `--db <path>`,
  `DIAG_DB`, or `dbPath` in config still works and disables the dispatch
  layer — useful for eval runs that co-locate logs outside the repo's
  standard layout.

  Internals:

  - New `DbHandleCache`: per-path `Database` handles with a 30-min idle close.
  - New `resolveRoutedDb`: validates the routing attribute (lowercase alnum
    plus `-`/`_`/`.`/`..` per segment; rejects absolute paths and repo-root
    escapes; warn-once-per-value on reject, falls back to `default.db` so
    misconfigured transmitters never lose rows).
  - `envelope.ts` strips the routing attribute from `data` before persistence
    so nothing inside a row records which DB it landed in.
  - `prune` walks every `.davstack/logs/*.db` by default (unchanged semantics
    versus the pre-2.0 "prune the one DB" behaviour); `--db <path>` pins to a
    single file.

  New docs:

  - [`docs/transmitter-wiring.md`](./docs/transmitter-wiring.md) — the
    3-line consumer addition to your existing `Sentry.init` + the runner-flag
    side (`playwright-server --db=<name>`).
  - [`docs/session-views.md`](./docs/session-views.md) — per-DB SQL views,
    `dbg_` prefix convention, and the cleanup-via-`rm` lifecycle.

## 1.4.0

### Minor Changes

- Add `logs_v` view: a read-side overlay over `logs` that exposes two extra
  columns derived from `data`:

  - `attrs` — the flat attributes map with the OTel `{value, type}` wrapper
    stripped, e.g. `{"seam": "after-fetch", "row_count": 42}`. Reach into it
    with `json_extract(attrs, '$.<key>')` instead of the four-segment
    `json_extract(data, '$.attributes.<key>.value')` dance.
  - `raw_attrs` — `json_extract(data, '$.attributes')`, i.e. the full typed
    envelope one path-level shallower than `data.attributes`. Use when you
    actually need the OTel `type` discriminator.

  Created idempotently at `openDb()` time. The base `logs` table is unchanged
  — view-only schema overlay, zero data migration.
  ([#52](https://github.com/DawidWraga/davstack/issues/52))

## 1.3.2

### Patch Changes

- docs: document sqlite as primary read path, ship recipes, soft-deprecate `query` verb
  ([#49](https://github.com/DawidWraga/davstack/issues/49))

  `docs/reading-logs.md` rewritten around sqlite. Corrects the prior
  `ts` / `recv_ts TEXT` schema (they are `REAL`), documents the OTel
  `{value, type}` envelope that puts probe payloads at
  `data.attributes.<key>.value`, and ships three recipes that the CLI
  verbs can't cover: probe-tag timeline with structured attributes,
  seam histogram (runaway-loop sanity check), and last-N (`--limit`
  returns ascending, sqlite can `ORDER BY DESC`).

  CLI: parent `query` description now points at `reading-logs.md` and
  describes the verbs as "pre-baked cuts for sanity / one-off greps."
  Verbs unchanged.

  No code changes to the daemon, ingest path, or DB schema.

## 1.3.1

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

## 1.3.0

### Minor Changes

- ae18a50: Add `check` verb for install validation. Run `npx logs-server check` (or
  `--json`) to probe a real install in one shot: Node version (gate >=20),
  config file resolution, DB file existence + lifetime + last-300s row
  counts, and daemon liveness via `GET /` to the resolved port.

  Pretty output uses three glyphs to distinguish severities:

  - `✓` — passing gate.
  - `~` — advisory: gate passes but the row carries a `fix:` hint (e.g.
    daemon not running, but exit code stays 0).
  - `✗` — hard failure (e.g. Node too old), flips aggregate `ok: false`.

  The stale-rows `fix:` hint ("no rows in last 300s — verify transmitter
  DSN") is suppressed when the daemon is up and lifetime rows > 0 — that
  combination is "idle dev sink", not a broken transmitter. It still
  fires when the DB has zero rows total.

  `--json` emits a structured `CheckResult` for agent/script consumers.
  Port resolves via flag > `DIAG_*` env > config > default.

- bf04284: Add CORS support for browser-origin envelope POSTs. The sink now responds to
  `OPTIONS` preflights and attaches `Access-Control-Allow-*` headers to ingest
  responses, so browser SDKs can post directly to `http://public@127.0.0.1:5181/1`
  without a same-origin proxy (Vite, webpack-dev-server, etc).

  New `cors` config field:

  - `"*"` (default) — echo `Access-Control-Allow-Origin: *` (no credentials).
  - `string[]` — allowlist; matching `Origin` is echoed back with `Vary: Origin`,
    non-matching origins get no CORS headers.
  - `false` — emit no CORS headers (legacy behaviour).

  Default-permissive is safe: the sink binds `127.0.0.1` only, the response is
  empty (POST) or a fixed `"diag sink ok"` literal (non-POST), and
  `Access-Control-Allow-Credentials` is never set.

### Patch Changes

- ade2196: Ship `.d.ts` declarations so consumers can import `ServerConfig` (and
  other public types) from `@davstack/{logs,vitest,playwright}-server/config`
  and `@davstack/cli-utils` without `TS2307: Cannot find module ... or its
corresponding type declarations`.

  Runtime output is byte-stable — only declarations are new. Non-breaking.

  See: 8065fc9 (`fix(daemons): ship .d.ts for @davstack/{cli-utils,logs-server,vitest-server,playwright-server}`)

- Updated dependencies [ade2196]
  - @davstack/cli-utils@1.1.1

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

## 1.0.0

### Major Changes

- Initial 1.0.0 release.

### Patch Changes

- Updated dependencies
  - @davstack/cli-utils@1.0.0
