# Per-session SQL views

When a debugging session has its own DB file (see [transmitter-wiring.md](./transmitter-wiring.md)), you can persist SQL views inside that file — tailored to the bug you're hunting, isolated from the rest of the project's logs, and archived alongside the rows by moving the file out of `.davstack/logs/` when you're done.

This is the high-value reason multi-DB ships at all. With a single global DB, every `CREATE VIEW` would pollute every future query; per-session DBs make views safe to create freely.

## The pattern

Open the session DB and define a probe-vocabulary view at the start of the session:

```bash
sqlite3 .davstack/logs/reorder-bug.db
```

```sql
CREATE VIEW IF NOT EXISTS dbg_probe AS
SELECT id, ts, level,
       json_extract(data, '$.body')         AS msg,
       json_extract(attrs, '$.seam')        AS seam,
       json_extract(attrs, '$.nextDims')    AS nextDims,
       json_extract(attrs, '$.prevDims')    AS prevDims,
       json_extract(attrs, '$.columnOrder') AS columnOrder
FROM logs
WHERE json_extract(data, '$.body') LIKE '%[colorder-probe]%';
```

Then every subsequent query is:

```sql
SELECT ts, seam, columnOrder FROM dbg_probe ORDER BY ts;
```

One cheap reference per query — no JSON-extract repetition, no probe-tag string repetition, no risk of typos drifting between queries.

## Useful view shapes

### Before/after a fix

Capture the wall clock right before applying a candidate fix, then split the timeline:

```sql
CREATE VIEW dbg_pre_fix  AS SELECT * FROM dbg_probe WHERE ts <  1716480000;
CREATE VIEW dbg_post_fix AS SELECT * FROM dbg_probe WHERE ts >= 1716480000;
```

Compare side-by-side with two query windows.

### Scope to one run within the session

A session DB often holds rows from several `run_id`s (multiple page-loads). Scope to one:

```sql
CREATE VIEW dbg_this_run AS SELECT * FROM dbg_probe WHERE run_id = 'r-XYZ';
```

### Pivot fixed-shape probes into columns

If your probes always emit the same attribute set, rotate them into typed columns for ergonomic `WHERE`:

```sql
CREATE VIEW dbg_seam_pivot AS
SELECT ts,
       json_extract(attrs, '$.seam')                                   AS seam,
       CAST(json_extract(attrs, '$.row_count') AS INTEGER)             AS row_count,
       json_extract(attrs, '$.ok')                                     AS ok
FROM logs
WHERE json_extract(data, '$.body') LIKE '%[probe]%';
```

Then `WHERE row_count > 100` works without an inline `json_extract` in every query.

## Lifecycle

- Views persist across `sqlite3` invocations within the same DB file — write them once at the start of a session.
- Drop just one view in a live session: `DROP VIEW dbg_probe;`.
- Archive everything: `mv .davstack/logs/<name>.db .davstack/logs/archive/`. The views move with the file and stay queryable from the archived path.

## Naming convention: `dbg_` prefix

Prefix every session-scoped view with `dbg_`. Two benefits:

- Easy to spot and drop in bulk:
  ```sql
  SELECT name FROM sqlite_master WHERE type='view' AND name LIKE 'dbg_%';
  ```
- Won't collide with any future shipped views.

## Anti-patterns

- **Don't `CREATE VIEW` in `default.db`** (or any sessionless DB). That view becomes global noise across every future session that lands rows in the same file.
- **Don't rely on `CREATE TEMP VIEW`** — temp views are per-connection and evaporate the moment you exit `sqlite3`. The whole point of session DBs is that the view lives with the rows, accessible from every subsequent connection.
- **Don't try to share views across session DBs.** SQLite views are file-local. If you find yourself wanting that, the underlying query belongs in your skill / agent prompt, not in the DB.

## Agent usage

If you're an agent iterating in a session DB, the first query of the iteration is `CREATE VIEW dbg_<name> IF NOT EXISTS …` for whatever projection you'll keep hitting; every subsequent query reads from it. This is the agent-side hygiene equivalent of "stash the projection once, reuse it everywhere" — saves tokens, makes the actual investigation queries shorter, and the leftover view becomes the artifact a human can re-open later.
