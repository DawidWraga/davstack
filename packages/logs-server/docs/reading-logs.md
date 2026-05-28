# Reading logs

`sqlite3` against `.davstack/logs/<db>` IS the read path. The standard incantation:

```bash
sqlite3 -header -column .davstack/logs/default.db "<SQL>"
```

`-header` prints column names, `-column` aligns the output as a table.

## Sessions

The daemon writes one file per "session" under `.davstack/logs/` based on --db tag:

```
.davstack/logs/
  default.db            ← runs without explicit --db tag
  reorder-bug.db        ← runs started with --db=reorder-bug
  hotfix-7c.db
```

If logs get noisy, archive by moving the file — e.g. to `.davstack/logs/archive/`.

See [transmitter-wiring.md](./transmitter-wiring.md) for how `--db=<name>` flows end-to-end.

## Schema

```
logs(
  id              INTEGER PRIMARY KEY,
  ts              REAL,     -- Sentry log timestamp, seconds since epoch (float)
  recv_ts         REAL,     -- server receive time, ms epoch
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
  attrs           TEXT,     -- flat {key: value} JSON, OTel {value,type} wrapper stripped (NULL when no attributes)
  tag             TEXT      -- promoted from data.attributes['diag.tag'].value (nullable)
)
```

Indexed on `(project, run_id, trace_id, level, ts)`.

See [session-views.md](./session-views.md) for per-session SQL views.

## `data` vs `attrs`

Two JSON columns hold the same payload at different ergonomic levels. Given:

```ts
logger.info("checkpoint", { seam: "after-fetch", row_count: 42 })
```

`data` keeps the Sentry log record verbatim — structured attributes are wrapped per-key by the OTel transmitter as `{value, type}`:

```json
{ "body": "checkpoint",
  "attributes": {
    "seam":      { "value": "after-fetch", "type": "string" },
    "row_count": { "value": 42,            "type": "integer" }
  } }
```

`attrs` is the flattened-on-write companion — wrapper stripped, just `{key: value}`:

```json
{ "seam": "after-fetch", "row_count": 42 }
```

So:

- Everyday reads → `json_extract(attrs, '$.<key>')` returns the raw value directly.
- Need the OTel type discriminator → `json_extract(data, '$.attributes.<key>')` returns the typed `{value, type}` envelope. Rarely needed in practice.

`attrs` is freely indexable via expression indexes if a hot key emerges: `CREATE INDEX ... ON logs(json_extract(attrs, '$.seam'))`.

## Recipes

Each recipe is shown as the full one-shot `sqlite3 -header -column …` invocation; the SQL inside is the part you customize. Capture `BASELINE` once before the repro (`sqlite3 .davstack/logs/default.db "SELECT MAX(ts) FROM logs"`) and substitute it in.

### Probe-tag timeline with structured attributes

The killer recipe — pick exactly the projection you need from `data.attributes`:

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT ts,
         msg,
         json_extract(attrs, '\$.seam')      AS seam,
         json_extract(attrs, '\$.row_count') AS row_count
  FROM logs
  WHERE ts > $BASELINE
    AND json_extract(data, '\$.body') LIKE '%<probe-tag>%'
  ORDER BY ts;
"
```

### Seam histogram (runaway-loop sanity check)

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT count(*) AS n,
         json_extract(attrs, '\$.seam') AS seam
  FROM logs
  WHERE ts > $BASELINE
    AND json_extract(data, '\$.body') LIKE '%<probe-tag>%'
  GROUP BY seam
  ORDER BY n DESC;
"
```

### Last N errors

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT ts, level, msg
  FROM logs
  WHERE level = 'error'
  ORDER BY ts DESC
  LIMIT 20;
"
```

### Errors from the last 60s (no BASELINE needed)

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT ts, level, msg
  FROM logs
  WHERE level = 'error'
    AND ts > unixepoch() - 60
  ORDER BY ts;
"
```

