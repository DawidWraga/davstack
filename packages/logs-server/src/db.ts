// Storage layer for the diag sink. Sentry-native columns (notes 03 binding):
// correlation fields indexed, full log item kept verbatim in `data`. One DB
// serves every repo (the `project` column scopes); retention is per-file —
// drop a session DB under `.davstack/logs/` to discard its rows.

import { Database } from 'bun:sqlite';

export type LogRow = {
  ts: number; // client timestamp (Sentry log `timestamp` / span `start_timestamp`, seconds float)
  recv_ts: number; // server receive time, ms epoch (clock-skew-safe vs client `ts`)
  kind: 'log' | 'span'; // row discriminator: a log record or a trace span
  project: string; // diag.project attribute (cwd/repo key)
  service: string; // envelope sdk.name
  run_id: string; // diag.run_id attribute
  trace_id: string;
  span_id: string;
  level: string; // logs: OTel level; spans: '' (no level — query by kind/op/status)
  severity_number: number; // OTel 1..24 (0 for spans)
  logger: string; // logs: sentry.origin; spans: span origin (fallback sdk.name)
  msg: string; // log `body`; span description||op (root: transaction name||op)
  data: string; // raw log item / span / transaction JSON, verbatim
  attrs: string | null; // flat key→value JSON (NULL when none). Spans add op/status/parent_span_id/description/duration_ms.
  tag: string | null; // diag.tag attribution (optional)
  duration_ms: number | null; // span headline metric ((timestamp - start_timestamp)*1000); NULL for logs
};

const COLS: (keyof LogRow)[] = [
  'ts',
  'recv_ts',
  'kind',
  'project',
  'service',
  'run_id',
  'trace_id',
  'span_id',
  'level',
  'severity_number',
  'logger',
  'msg',
  'data',
  'attrs',
  'tag',
  'duration_ms',
];

// Migrate pre-2.2 schemas: add the `attrs` column if missing, backfill from
// `data.attributes` using the recipe the old logs_v view used, and drop the
// view. Wrapped in BEGIN IMMEDIATE so partial state can't leak; idempotent
// (safe to re-run — guarded by the table_info check).
function migrateAttrsColumn(db: Database): void {
  const cols = db.query("PRAGMA table_info(logs)").all() as { name: string }[];
  const hasAttrs = cols.some((c) => c.name === 'attrs');
  const viewExists =
    (db
      .query("SELECT name FROM sqlite_master WHERE type='view' AND name='logs_v'")
      .get() as { name: string } | null) !== null;
  if (hasAttrs && !viewExists) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!hasAttrs) {
      db.exec('ALTER TABLE logs ADD COLUMN attrs TEXT');
      db.exec(
        `UPDATE logs SET attrs = CASE
           WHEN json_extract(data, '$.attributes') IS NULL THEN NULL
           ELSE (SELECT json_group_object(je.key, json_extract(je.value, '$.value'))
                 FROM json_each(json_extract(data, '$.attributes')) AS je)
         END`,
      );
    }
    db.exec('DROP VIEW IF EXISTS logs_v');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Migrate pre-2.7 schemas to the telemetry shape: add `kind` (log|span) and
// `duration_ms` columns if missing. Existing rows are all logs, so `kind`
// backfills to 'log' (the column default already does this on ALTER, but we
// set it explicitly for clarity / parity with fresh CREATE). `duration_ms`
// stays NULL on legacy rows (only spans carry it). Wrapped in BEGIN IMMEDIATE
// so partial state can't leak; idempotent (guarded by the table_info check).
function migrateKindColumns(db: Database): void {
  const cols = db.query('PRAGMA table_info(logs)').all() as { name: string }[];
  const hasKind = cols.some((c) => c.name === 'kind');
  const hasDuration = cols.some((c) => c.name === 'duration_ms');
  if (hasKind && hasDuration) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!hasKind) {
      db.exec("ALTER TABLE logs ADD COLUMN kind TEXT DEFAULT 'log'");
      db.exec("UPDATE logs SET kind = 'log' WHERE kind IS NULL");
    }
    if (!hasDuration) {
      db.exec('ALTER TABLE logs ADD COLUMN duration_ms REAL');
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function openDb(path: string): Database {
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL'); // concurrent hammer-ingest + query
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id              INTEGER PRIMARY KEY,
      ts              REAL,
      recv_ts         REAL,
      kind            TEXT DEFAULT 'log',
      project         TEXT,
      service         TEXT,
      run_id          TEXT,
      trace_id        TEXT,
      span_id         TEXT,
      level           TEXT,
      severity_number INTEGER,
      logger          TEXT,
      msg             TEXT,
      data            TEXT,
      attrs           TEXT,
      tag             TEXT,
      duration_ms     REAL
    )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_logs_corr
       ON logs (project, run_id, trace_id, level, ts)`,
  );
  migrateAttrsColumn(db);
  migrateKindColumns(db);
  return db;
}

export function insertLogs(db: Database, rows: LogRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO logs (${COLS.join(', ')}) VALUES (${COLS.map(() => '?').join(', ')})`,
  );
  const insertAll = db.transaction((batch: LogRow[]) => {
    for (const r of batch) stmt.run(...COLS.map((c) => r[c] as never));
    return batch.length;
  });
  return insertAll(rows);
}

export function selectByTrace(db: Database, project: string, traceId: string): LogRow[] {
  return db
    .query('SELECT * FROM logs WHERE project = ? AND trace_id = ? ORDER BY ts, id')
    .all(project, traceId) as LogRow[];
}

