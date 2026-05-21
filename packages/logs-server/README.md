# @davstack/logs-server

Long-lived HTTP sink that accepts Sentry envelopes from app/test/agent code
and writes them to a per-repo SQLite at `.davstack/logs.db`. Exposes structured
query verbs for filtering by `trace_id`, `run_id`, time window, and level.
Built for local-only dev — no cloud account, no API key. Use `trace_id`
correlation across a monorepo (e.g. a python backend + a react frontend emit
to the same sink, query yields a unified timeline).

## Quick start

```sh
# boot the ingest endpoint (default 127.0.0.1:7077)
npx logs-server serve &

# query an assembled trace
npx logs-server query trace --project foo --trace abc

# timeline for one run
npx logs-server query run --project foo --run r-42

# errors with surrounding context
npx logs-server query errors --project foo --trace abc

# generic filter
npx logs-server query filter --project foo --level error --grep timeout

# prune rows older than 14 days
npx logs-server prune --days 14
```

## Storage

- DB path: `$DIAG_DB` (default `~/.davstack/diag.sqlite`).
- Schema: `logs(id, ts, recv_ts, project, service, run_id, trace_id, span_id, level, severity_number, logger, msg, data, tag)`.
- Indexed on `(project, run_id, trace_id, level, ts)`.

The DB is a single shared store across all projects — the `project` column
scopes queries. Use raw sqlite for ad-hoc cuts the CLI doesn't pre-bake.

## Env vars

- `DIAG_DB` — sqlite file path override
- `DIAG_PORT` — listen port (default 7077)
- `DIAG_HOST` — listen host (default 127.0.0.1)

(`DIAG_*` prefix preserved for back-compat with existing repo setups.)
