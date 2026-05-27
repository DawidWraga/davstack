# @davstack/logs-server

Local Sentry-shaped app -> sqlite log sink.

> **Recommended**: run this daemon via `pnpm dlx @davstack/tui start` —
> the TUI supervises all configured davstack daemons together and cleans
> them up on quit. The standalone CLI below still works if you want to
> run this daemon in isolation.

## Why

- **E2E tracability** Frontend + backend + workers POST to the same `.davstack/logs/default.db`; `--trace` follows requests across services.
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

Read the store directly with `sqlite3`. The `attrs` column is a flat key→value JSON populated at insert time — the OTel `{value, type}` wrapper is stripped, so probe payloads are one `json_extract` away:

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT ts, msg, json_extract(attrs, '\$.user_id') AS user_id
  FROM logs
  WHERE json_extract(data, '\$.body') LIKE '%clicked save%'
  ORDER BY ts;
"
```

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
