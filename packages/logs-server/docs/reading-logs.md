# Reading logs

Three layers, increasing power:

1. **CLI query verbs** — pre-baked cuts. 80% of cases.
2. **`--json` on any verb** — pipe into `jq` / scripts.
3. **Raw sqlite** on `.davstack/logs.db` — for cuts the CLI doesn't pre-bake.

## CLI verbs

```bash
logs-server query run    --run r-99                  # timeline for one run_id
logs-server query trace  --trace 7f3a…               # cross-service assembly for one trace_id
logs-server query errors --context 20                # errors + N surrounding rows (scoped to --run/--trace too)
logs-server query filter --level error --grep "timeout" --limit 100
```

Default output is **compact one-row-per-line** (terminal/agent-friendly):

```
2026-05-21T13:51:32  error  react  r-99  t-7f3a  request failed  {"status":500}
```

Flags on every verb: `--json` (full row shape) · `--human` (grouped by service, indented).

## Raw sqlite

```bash
sqlite3 .davstack/logs.db
```

### Schema

```
logs(
  id              INTEGER PRIMARY KEY,
  ts              TEXT,        -- ISO 8601, from transmitter
  recv_ts         TEXT,        -- ISO 8601, when daemon received
  project         TEXT,
  service         TEXT,
  run_id          TEXT,
  trace_id        TEXT,
  span_id         TEXT,
  level           TEXT,
  severity_number INTEGER,
  logger          TEXT,
  msg             TEXT,        -- ANSI prefix stripped
  data            TEXT,        -- JSON blob; everything not promoted
  tag             TEXT
)
```

Indexed on `(project, run_id, trace_id, level, ts)`. Other predicates full-scan.

### Recipes

```sql
-- top error messages this hour
SELECT msg, count(*) AS n
FROM logs
WHERE level='error' AND ts > datetime('now','-1 hour')
GROUP BY msg ORDER BY n DESC LIMIT 20;
```

```sql
-- pull a field out of the data blob
SELECT ts, msg, json_extract(data, '$.user_id') AS user_id
FROM logs WHERE json_extract(data, '$.user_id') = 42
ORDER BY ts;
```

```sql
-- distribution of services under one run
SELECT service, count(*) AS n
FROM logs WHERE run_id='r-99'
GROUP BY service ORDER BY n DESC;
```

## Pruning

Hourly background prune if `pruneDays > 0` ([setup.md](./setup.md)). Force-prune:

```bash
logs-server prune --days 14
logs-server prune --max-age-ms 3600000   # 1 hour
```
