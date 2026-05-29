---
name: logs-server
description: >-
  Query a local Sentry-shaped log sink (per-session SQLite under
  `.davstack/logs/<name>.db`) for cross-service timelines, error windows,
  or `trace_id` / `run_id` slices. Use when the user references a failed
  request, agent run, or test invocation and you need the actual log
  timeline rather than guessing. Also use when planting hypothesis-driven
  probes during a `diagnose` loop. Skip for tail-following live stdout
  (use the dev server directly) or for prod logs (this is local-only).
---

First run `davstack check` to confirm the daemon is running.

> If `davstack check` reports a daemon down, ask the user to run `davstack start` in a **separate terminal** — this makes the whole session faster. Claude can't run it for you; it must live in its own terminal. Do not run `serve` yourself.

## The read path is sqlite3

`logs-server` has no `query` CLI verb (removed in 2.1.0). You read the store directly with sqlite3 against `.davstack/logs/<db>` — works even if the ingest daemon isn't running. You only need `serve` running for the app to *write* new envelopes.

### Standard incantation

```bash
sqlite3 -header -column .davstack/logs/<db> "<SQL>"
```

`-header` prints column names. `-column` aligns the output as a table. Without these you get pipe-separated values with no labels — fine for piping, terrible for reading.

### Picking the DB

```
.davstack/logs/
  default.db          ← un-tagged emissions
  reorder-bug.db      ← runs started with --db=reorder-bug
  hotfix-7c.db
```

`default.db` is the catch-all. Named siblings appear when a transmitter stamps a `davstack-logs.db` attribute (or `playwright-server --db=<name>`). The file IS the session boundary.

## Schema

```
logs(id, ts, recv_ts, project, service, run_id, trace_id, span_id,
     level, severity_number, logger, msg, data, attrs, tag)
```

Indexed on `(project, run_id, trace_id, level, ts)` — filter on those first.

- **`msg`** — log body, ANSI prefix stripped.
- **`data`** — raw Sentry log record JSON, verbatim. Includes OTel-typed `attributes`.
- **`attrs`** — flat `{key: value}` JSON of `data.attributes`, OTel `{value, type}` wrapper stripped. Reach in with `json_extract(attrs, '$.<key>')`.
- **`tag`** — promoted from `diag.tag` (nullable).

## Investigation pattern

1. Get a `trace_id` or `run_id` from the user (the chat message, the
   error stamp, or the URL hash that holds `__diagRunId`).

2. Timeline for one run / trace:

   ```bash
   sqlite3 -header -column .davstack/logs/default.db "
     SELECT ts, level, msg
     FROM logs
     WHERE run_id = '<id>'
     ORDER BY ts;
   "
   ```

3. Narrow to errors:

   ```bash
   sqlite3 -header -column .davstack/logs/default.db "
     SELECT ts, level, msg
     FROM logs
     WHERE level = 'error'
     ORDER BY ts DESC LIMIT 20;
   "
   ```

4. For fat data payloads, project specific fields with `json_extract(data, '$.<path>')` rather than dumping the whole `data` blob.

For hypothesis-driven probe-then-slice debugging, see `writing-logs.md`.

If a query returns empty or hits the wrong DB, the failure is usually in the sink config or transmitter — `davstack check` reports the resolved path and recent row count; see `setup.md` for transmitter wiring.

## Reference

- [`README.md`](../../packages/logs-server/README.md) — overview, install, why
- [`docs/setup.md`](../../packages/logs-server/docs/setup.md) — config file, transmitter setup, auto-instrumentation
- [`docs/writing-logs.md`](../../packages/logs-server/docs/writing-logs.md) — queryable shape, hypothesis-driven probes
- [`docs/reading-logs.md`](../../packages/logs-server/docs/reading-logs.md) — schema details + raw sqlite recipes
