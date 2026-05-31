---
"@davstack/logs-server": minor
---

Ingest traces (spans) as first-class rows alongside logs.

The sink previously dropped every `type:"transaction"`/`type:"span"` envelope
item and only persisted logs. It now ingests Sentry tracing envelopes into the
same `logs` table, discriminated by a new `kind` column (`'log' | 'span'`).

A transaction event expands to one row per span: the root span (from
`contexts.trace`, timed by the event's top-level start/timestamp) plus one row
per `spans[]` child. Each span row carries `kind:'span'`, `ts` =
`start_timestamp`, and a real `duration_ms` column (the headline metric, so
spans sort by latency in plain SQL). Span-specific fields (`op`, `status`,
`parent_span_id`, `description`, `duration_ms`) are flattened into the
`json_extract`-queryable `attrs` JSON, and the span's verbatim object is kept in
`data`. The `davstack-logs.db` routing attribute and `diag.project`/`diag.run_id`
attribution are honored for spans too.

Fully backward compatible: every existing log path still produces `kind:'log'`
rows with `duration_ms` NULL, and an idempotent migration adds the `kind` /
`duration_ms` columns to pre-existing DBs (existing rows default to `'log'`).

Query spans with e.g. `SELECT msg, duration_ms FROM logs WHERE kind='span'
ORDER BY duration_ms DESC`.
