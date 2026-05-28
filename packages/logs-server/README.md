# @davstack/logs-server

Local Sentry-shaped app -> sqlite log sink.

## Why

- **E2E traceability.** Frontend + backend + workers POST to the same `.davstack/logs/default.db`; `trace_id` follows requests across services.
- **Zero infra.** Integrates into existing sentry logger client for auto-instrumentation and low effort setup.
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
playwright-server run --db=reorder-bug e2e/reorder-flow.spec.ts   # → .davstack/logs/reorder-bug.db (default: default.db)
```

notes:
- Davstack runner is recommended ([vitest-server](../vitest-server/README.md), [playwright-server](../playwright-server/README.md)), however regular `pnpm dev` still captures logs
- `--db` usage is recommended, however without it logs still land in `default.db`.

(more info: [transmitter-wiring.md](./docs/transmitter-wiring.md))

1. Query logs with  `sqlite3`.

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT ts, msg, json_extract(attrs, '\$.user_id') AS user_id
  FROM logs
  WHERE json_extract(data, '\$.body') LIKE '%clicked save%'
  ORDER BY ts;
"
```

Result:

```
ts          msg                user_id
----------  -----------------  -------
1716480923  user clicked save  42
```

## Docs

- [docs/setup.md](./docs/setup.md) — config file, env vars, runtime selection
- [docs/writing-logs.md](./docs/writing-logs.md) — transmitter setup per SDK
- [docs/reading-logs.md](./docs/reading-logs.md) — sqlite schema, the flat `attrs` column, and ready-to-paste recipes
- [docs/transmitter-wiring.md](./docs/transmitter-wiring.md) — route a session's logs to its own DB via the `davstack-logs.db` attribute
- [docs/session-views.md](./docs/session-views.md) — per-DB SQL views, the high-value follow-up to multi-DB routing

