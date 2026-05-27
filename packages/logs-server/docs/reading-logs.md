# Reading logs

`sqlite3` against `.davstack/logs/<db>` IS the read path. The standard incantation:

```bash
sqlite3 -header -column .davstack/logs/default.db "<SQL>"
```

`-header` prints column names, `-column` aligns the output as a table. The raw Sentry log record sits in `data` (a JSON blob), and a pre-flattened `attrs` column (OTel `{value, type}` wrapper stripped, populated at insert time as of 2.2.0) sits alongside it — reach in with `json_extract(attrs, '$.<key>')` instead of walking the four-segment `data.attributes.<key>.value` path.

> The 1.x-era `logs-server query` CLI verb was removed in 2.1.0: it could only grep the `msg` body (couldn't reach structured probe attributes) and cost ~10× sqlite's cold-boot. Use sqlite3 directly.

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
  attrs           TEXT,     -- flat {key: value} JSON, OTel {value,type} wrapper stripped (NULL when no attributes)
  tag             TEXT      -- promoted from data.attributes['diag.tag'].value (nullable)
)
```

Indexed on `(project, run_id, trace_id, level, ts)`.

`attrs` is the everyday read path — populated at insert time (2.2.0+) and freely indexable via expression indexes if a hot key emerges (`CREATE INDEX ... ON logs(json_extract(attrs, '$.seam'))`). Need the OTel `{value, type}` typing? Reach into `data` directly: `json_extract(data, '$.attributes.<key>')` returns the typed envelope. Rarely needed in practice.

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

So `data.attributes.<key>.value` is where each probe payload lives in the raw envelope. The `{value, type}` wrapper is OTel-standard ergonomic tax — `attrs` is the flattened-on-write companion column (`json_extract(attrs, '$.<key>')`), so you only walk the four-segment path when you actually need the type discriminator.

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

([#51](https://github.com/DawidWraga/davstack/issues/51) tracks first-class iteration scoping.)

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

## Pruning

Hourly background prune if `pruneDays > 0` ([setup.md](./setup.md)). Force-prune:

```bash
logs-server prune --days 14
logs-server prune --max-age-ms 3600000   # 1 hour
```
