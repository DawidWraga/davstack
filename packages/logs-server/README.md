# @davstack/logs-server

Local Sentry-shaped app -> sqlite telemetry sink (logs **and** traces).

## Why

- **E2E traceability.** Frontend + backend + workers POST to the same `.davstack/logs/default.db`; `trace_id` follows requests across services. Logs, trace spans, and error events land in one table, discriminated by a `kind` column (`'log' | 'span' | 'event'`).
- **Zero infra.** Integrates into existing sentry logger client for auto-instrumentation and low effort setup. Set `tracesSampleRate` and spans flow into the same sink as logs — no extra wiring.
- **Optimized for Agents.** Compact one-row-per-line by default — coding agents read it without grouping passes.

## Install & setup (1 min)

1. Recommended: scaffold with [davstack init](../init/README.md)

```bash
pnpx @davstack/init
```

(cd to your project repo first - logs-server is scoped to codebase)

2. Set up local sink — in dev, point your existing Sentry DSN at the daemon:

```ts
Sentry.init({dsn: IS_DEV ? "http://public@127.0.0.1:5181/1" : import.meta.env.VITE_SENTRY_DSN })
```

(see full setup guide before usage: [setup.md](./docs/setup.md))

## Usage Example

1. Start server

```bash
davstack start
```

(more info: [davstack tui](../tui/README.md))

2. Add logs to app, or use autoinstumentation.

```ts
logger.debug("user clicked save", { user_id: 42, run_id: "r-99" })
```

(more info: [writing-logs.md](./docs/writing-logs.md))

3. Run repo with --db (optional) — scopes this session's logs to its own DB

```bash
vitest-server run --db=reorder-bug src/reorder.test.ts   # → .davstack/logs/reorder-bug.db (default: default.db)
```

notes:
- Davstack runner is recommended ([vitest-server](../vitest-server/README.md)), however regular `pnpm dev` still captures logs
- `--db` usage is recommended, however without it logs still land in `default.db`.

(more info: [transmitter-wiring.md](./docs/transmitter-wiring.md))

4. Query logs with  `sqlite3`.

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT ts, msg, attrs->>'user_id' AS user_id
  FROM logs
  WHERE data->>'body' LIKE '%clicked save%'
  ORDER BY ts;
"
```

Result:

```
ts          msg                user_id
----------  -----------------  -------
1716480923  user clicked save  42
```

5. Query trace spans — `kind='span'` rows have a real `duration_ms` column, so the slowest spans sort in plain SQL. `op`/`status`/`parent_span_id` are flattened into `attrs`.

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT msg, duration_ms,
         attrs->>'op'     AS op,
         attrs->>'status' AS status
  FROM logs
  WHERE kind = 'span'
  ORDER BY duration_ms DESC
  LIMIT 10;
"
```

(Logs and spans share the `trace_id` column, so a single `WHERE trace_id = ?` slices the full request timeline across both.)

6. Query error events — `kind='event'` rows are real exceptions (`Sentry.captureException`, unhandled errors, React error boundaries). The full stacktrace is in `data`; `exception_type`/`mechanism` are flattened into `attrs`.

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT ts, msg,
         attrs->>'exception_type' AS type,
         attrs->>'function'       AS fn,
         attrs->>'filename'       AS file
  FROM logs
  WHERE kind = 'event'
  ORDER BY ts DESC
  LIMIT 10;
"
```

## Schema

One `logs` table per session DB. Key columns:

| column        | logs                     | spans (`kind='span'`)                         | events (`kind='event'`)                        |
| ------------- | ------------------------ | --------------------------------------------- | ---------------------------------------------- |
| `kind`        | `'log'`                  | `'span'`                                       | `'event'`                                       |
| `ts`          | log `timestamp`          | span `start_timestamp`                         | event `timestamp`                              |
| `duration_ms` | `NULL`                   | `(timestamp - start_timestamp) * 1000`         | `NULL`                                          |
| `msg`         | log `body`               | span `description` \|\| `op` (root: tx name)   | `"{type}: {value}"` (exc) \|\| `message`        |
| `level`       | OTel level               | `''`                                           | event `level` (error/fatal/warning/info)       |
| `data`        | verbatim log item        | verbatim span / transaction-trace object       | verbatim event (full `exception`/`stacktrace`) |
| `attrs`       | flat attrs (unwrapped)   | flat span data + `op`/`status`/`parent_span_id`/`description`/`duration_ms` | `exception_type`/`mechanism`/`handled` + top `in_app` frame |

A transaction event expands to one row per span: the root (from `contexts.trace`) plus one per `spans[]` child. An error/message event (`Sentry.captureException`, `captureMessage`, unhandled errors, React error boundaries) becomes one `kind='event'` row — the full stacktrace lives verbatim in `data`, and its `trace_id` correlates it with the logs/spans of the same request.

## Docs

- [docs/setup.md](./docs/setup.md) — config file, env vars, runtime selection
- [docs/writing-logs.md](./docs/writing-logs.md) — transmitter setup per SDK
- [docs/reading-logs.md](./docs/reading-logs.md) — sqlite schema, the flat `attrs` column, and ready-to-paste recipes
- [docs/transmitter-wiring.md](./docs/transmitter-wiring.md) — route a session's logs to its own DB via the `davstack-logs.db` attribute
- [docs/session-views.md](./docs/session-views.md) — per-DB SQL views, the high-value follow-up to multi-DB routing

