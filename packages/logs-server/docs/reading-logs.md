# Reading logs

`sqlite3` against `.davstack/logs/<db>` IS the read path. The standard incantation:

```bash
sqlite3 -header -column .davstack/logs/default.db "<SQL>"
```

`-header` prints column names, `-column` aligns the output as a table.

## `sqlite3` vs `view` — when to write a file

Default to **`sqlite3`** (or `logs-server view --stdout`) for your own investigation —
querying answers a question without leaving an artifact behind. The `view` command's
**file output (`.davstack/view.md`) is for handing a rendered trace to a human** to
read in their editor; reach for it only when you're actually presenting a trace, not
for every lookup. Don't generate a Markdown file per query — that litters the repo.

- Agent self-service / a quick check → `sqlite3 …` or `view <trace> --stdout`.
- Showing a person a trace waterfall → `view <trace>` (writes `.davstack/view.md`).

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
  tag             TEXT,     -- promoted from data.attributes['diag.tag'].value (nullable)
  kind            TEXT,     -- row discriminator: 'log' | 'span' | 'event'
  duration_ms     REAL,     -- span headline metric ((end-start)*1000); NULL for logs
  runtime         TEXT      -- emitting runtime ('browser'|'node'|'edge'), stamped by the consumer; NULL when absent
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

- Everyday reads → `attrs->>'<key>'` returns the raw value directly.
- Need the OTel type discriminator → `data->>'$.attributes.<key>'` returns the typed `{value, type}` envelope. Rarely needed in practice.

`attrs` is freely indexable via expression indexes if a hot key emerges: `CREATE INDEX ... ON logs(attrs->>'seam')`.

A bare key implies a top-level `$.<key>`; for a nested reach pass an explicit path (`data->>'$.attributes.seam.type'`). For a projection you re-hit every query, stash it once in a session view ([session-views.md](./session-views.md)) so subsequent queries are `SELECT seam, row_count FROM dbg_x`.

## Recipes

Each recipe is shown as the full one-shot `sqlite3 -header -column …` invocation; the SQL inside is the part you customize. Capture `BASELINE` once before the repro (`sqlite3 .davstack/logs/default.db "SELECT MAX(ts) FROM logs"`) and substitute it in.

### Probe-tag timeline with structured attributes

The killer recipe — pick exactly the projection you need from `data.attributes`:

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT ts,
         msg,
         attrs->>'seam'      AS seam,
         attrs->>'row_count' AS row_count
  FROM logs
  WHERE ts > $BASELINE
    AND data->>'body' LIKE '%<probe-tag>%'
  ORDER BY ts;
"
```

### Seam histogram (runaway-loop sanity check)

```bash
sqlite3 -header -column .davstack/logs/default.db "
  SELECT count(*) AS n,
         attrs->>'seam' AS seam
  FROM logs
  WHERE ts > $BASELINE
    AND data->>'body' LIKE '%<probe-tag>%'
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

## Spans: transaction metadata + the tree

We do NOT duplicate transaction-level metadata onto every span. It is stored
ONCE on the **ROOT span row** (the segment — the row whose `parent_span_id` is
empty / not present in the trace), and nesting is reconstructed on demand. There
is no SQL view for the tree; this CTE (and the `logs-server view` CLI) IS
the view substitute.

### Root-only metadata keys (in `attrs`)

Stamped onto the root span row only, by `transactionRows()` in `src/envelope.ts`:

| key                    | source                       | notes                          |
|------------------------|------------------------------|--------------------------------|
| `measurement.lcp`      | `event.measurements.lcp`     | web vital, **value only**, ms  |
| `measurement.fcp`      | `event.measurements.fcp`     | ms                             |
| `measurement.ttfb`     | `event.measurements.ttfb`    | ms                             |
| `measurement.inp`      | `event.measurements.inp`     | ms                             |
| `measurement.cls`      | `event.measurements.cls`     | unitless                       |
| `measurement.<other>`  | `event.measurements.<k>`     | any vital Sentry sends         |
| `request.url`          | `event.request.url`          | bug-repro context              |
| `request.method`       | `event.request.method`       | bug-repro context              |

```bash
# Web vitals for a trace (read off the root span row)
sqlite3 -header -column .davstack/logs/default.db "
  SELECT attrs->>'measurement.lcp'  AS lcp_ms,
         attrs->>'measurement.cls'  AS cls,
         attrs->>'measurement.inp'  AS inp_ms,
         attrs->>'request.url'      AS url
  FROM logs
  WHERE kind = 'span'
    AND trace_id = '<trace_id>'
    AND COALESCE(attrs->>'parent_span_id','') = '';
"
```

### Reconstruct the span tree (recursive CTE)

`parent_span_id` is surfaced into `attrs` for each span. Walk it from the roots
to get depth + a materialised path, ordered depth-first — the same shape the
`logs-server view` waterfall renders.

```bash
sqlite3 -header -column .davstack/logs/default.db "
  WITH RECURSIVE tree AS (
    -- roots: spans with no resolvable parent in this trace
    SELECT id, span_id, attrs->>'parent_span_id' AS parent,
           0 AS depth, printf('%010d', id) AS path, msg, duration_ms
    FROM logs
    WHERE kind = 'span' AND trace_id = '<trace_id>'
      AND COALESCE(attrs->>'parent_span_id','') = ''
    UNION ALL
    SELECT c.id, c.span_id, c.attrs->>'parent_span_id',
           t.depth + 1, t.path || '.' || printf('%010d', c.id), c.msg, c.duration_ms
    FROM logs c
    JOIN tree t ON c.attrs->>'parent_span_id' = t.span_id
    WHERE c.kind = 'span' AND c.trace_id = '<trace_id>'
  )
  SELECT depth,
         substr('                    ', 1, depth*2) || msg AS tree,
         round(duration_ms) AS dur_ms
  FROM tree
  ORDER BY path;
"
```

