# @davstack/logs-server

Local Sentry-shaped app -> sqlite log sink.

> **Recommended**: run this daemon via `pnpm dlx @davstack/tui start` —
> the TUI supervises all configured davstack daemons together and cleans
> them up on quit. The standalone CLI below still works if you want to
> run this daemon in isolation.

## Why

- **E2E tracability** Frontend + backend + workers POST to the same `.davstack/logs.db`; `--trace` follows requests across services.
- **Zero infra.** Integrates into existing sentry logger client for auto-instrumentation and low effort setup.
- **Optimized for Agents.** Compact one-row-per-line by default — coding agents read it without grouping passes.

## Install

```bash
pnpm add -D @davstack/logs-server
pnpm exec logs-server serve     
# change sentry logger client DSN to server address (default: 127.0.0.1:5181)
```

## Usage Example

```ts
// app code (any Sentry-compatible SDK pointed at http://127.0.0.1:5181)
logger.debug("user clicked save", { user_id: 42, run_id: "r-99" })
```

```bash
$ logs-server query filter --grep "clicked save"
2026-05-21T13:51:32  debug  app  r-99  user clicked save  {"user_id":42}
```

For non-trivial cuts, query sqlite directly via the `logs_v` view (flat `attrs` column strips the OTel `{value,type}` wrapper):

```sql
-- sqlite3 .davstack/logs.db
SELECT ts, msg, json_extract(attrs, '$.user_id') AS user_id
FROM logs_v
WHERE json_extract(data, '$.body') LIKE '%clicked save%'
ORDER BY ts;
```

## Docs

- [docs/setup.md](./docs/setup.md) — config file, env vars, runtime selection
- [docs/writing-logs.md](./docs/writing-logs.md) — transmitter setup per SDK
- [docs/reading-logs.md](./docs/reading-logs.md) — sqlite schema, recipes, and CLI verb reference (sqlite is the recommended read path for any non-trivial diagnosis)
