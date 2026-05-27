# Reading logs

```bash
sqlite3 .davstack/logs/default.db
```

Structured probe attributes live inside `data` (a JSON blob), so any non-trivial cut needs `json_extract`. The CLI `query` verbs are pre-baked cuts for sanity checks; reach past them as soon as you want structured payloads, compound predicates, or aggregation.

## Choosing a DB

The daemon writes one file per "session" under `.davstack/logs/`:

```
.davstack/logs/
  default.db            ← un-tagged emissions
  reorder-bug.db        ← runs started with --db=reorder-bug
  hotfix-7c.db
```

`default.db` is the catch-all — everything lands here unless the transmitter stamps a `davstack-logs.db` attribute. Named sibling files appear when a runner (e.g. `playwright-server --db=reorder-bug`) routes its session. The file IS the session boundary; nothing inside the row records which bucket it landed in.

Open the right one:

```bash
sqlite3 .davstack/logs/reorder-bug.db
```

Wiring the routing attribute end-to-end: see [transmitter-wiring.md](./transmitter-wiring.md). Per-session SQL views: see [session-views.md](./session-views.md).

## Schema

```
logs(
  id              INTEGER PRIMARY KEY,
  ts              REAL,     -- Sentry log timestamp, seconds since epoch (float)
  recv_ts         REAL,     -- server receive time, ms epoch (prune key)
  project         TEXT,     -- promoted from data.attributes['diag.project'].value
  service         TEXT,     -- envelope sdk.name
  run_id          TEXT,     -- promoted from data.attributes['diag.run_id'].value
  trace_id        TEXT,
  span_id         TEXT,
  level           TEXT,
  severity_number INTEGER,
  logger          TEXT,     -- promoted from data.attributes['sentry.origin'].value
  msg             TEXT,     -- Sentry log body, ANSI prefix stripped
  data            TEXT,     -- raw Sentry log record JSON, verbatim
  tag             TEXT      -- promoted from data.attributes['diag.tag'].value (nullable)
)
```

Indexed on `(project, run_id, trace_id, level, ts)`.

### View: `logs_v`

A read-side overlay over `logs` with two extra columns. Same `WHERE`/`ORDER BY`/index behaviour — query it like the base table.

- `attrs` — flat key→value map, OTel `{value, type}` wrapper stripped. Reach in with `json_extract(attrs, '$.<key>')` instead of `data.attributes.<key>.value`.
- `raw_attrs` — `json_extract(data, '$.attributes')`, the typed envelope one path-level shallower than `data.attributes`. Use when you need the OTel `type` discriminator.

## `data` shape

`data` is the Sentry log record kept verbatim. Structured attributes are wrapped per-key by the OTel transmitter as `{value, type}`:

```ts
logger.info("checkpoint", { seam: "after-fetch", row_count: 42 })
```

stored as:

```json
{ "body": "checkpoint",
  "attributes": {
    "seam":      { "value": "after-fetch", "type": "string" },
    "row_count": { "value": 42,             "type": "integer" }
  } }
```

So probe payloads sit at `data.attributes.<key>.value`. The `{value, type}` wrapper is OTel-standard ergonomic tax — `logs_v` exposes the flat form via the `attrs` column (`json_extract(attrs, '$.<key>')`), with `raw_attrs` keeping the typed envelope one path-level shallower if you need it.

## Recipes

### Probe-tag timeline with structured attributes

The killer recipe — pick exactly the projection you need from `data.attributes`:

```sql
SELECT ts,
       msg,
       json_extract(attrs, '$.seam')      AS seam,
       json_extract(attrs, '$.row_count') AS row_count
FROM logs_v
WHERE ts > :baseline
  AND json_extract(data, '$.body') LIKE '%<probe-tag>%'
ORDER BY ts;
```

Capture `:baseline` with `SELECT MAX(ts) FROM logs` before kicking off the repro, then query relative to it. ([#51](https://github.com/DawidWraga/davstack/issues/51) tracks first-class iteration scoping.)

### Seam histogram (runaway-loop sanity check)

```sql
SELECT count(*) AS n,
       json_extract(attrs, '$.seam') AS seam
FROM logs_v
WHERE ts > :baseline
  AND json_extract(data, '$.body') LIKE '%<probe-tag>%'
GROUP BY seam
ORDER BY n DESC;
```

### Last N (`--limit` returns ascending; sqlite to the rescue)

```sql
SELECT ts, level, msg
FROM logs
WHERE level = 'error'
ORDER BY ts DESC
LIMIT 20;
```

## Pruning

Hourly background prune if `pruneDays > 0` ([setup.md](./setup.md)). Force-prune:

```bash
logs-server prune --days 14
logs-server prune --max-age-ms 3600000   # 1 hour
```
