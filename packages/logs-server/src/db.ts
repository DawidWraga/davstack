// Storage layer for the diag sink. Sentry-native columns (notes 03 binding):
// correlation fields indexed, full log item kept verbatim in `data`. One DB
// serves every repo (the `project` column scopes), pruned by server `recv_ts`.

import { Database } from 'bun:sqlite';

export type LogRow = {
  ts: number; // client timestamp (Sentry log `timestamp`, seconds float)
  recv_ts: number; // server receive time, ms epoch — the prune key
  project: string; // diag.project attribute (cwd/repo key)
  service: string; // envelope sdk.name
  run_id: string; // diag.run_id attribute
  trace_id: string;
  span_id: string;
  level: string;
  severity_number: number; // OTel 1..24
  logger: string; // sentry.origin
  msg: string; // log `body`
  data: string; // raw log item JSON, verbatim
  tag: string | null; // diag.tag attribution (optional)
};

const COLS: (keyof LogRow)[] = [
  'ts',
  'recv_ts',
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
  'tag',
];

export function openDb(path: string): Database {
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL'); // concurrent hammer-ingest + query
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id              INTEGER PRIMARY KEY,
      ts              REAL,
      recv_ts         REAL,
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
      tag             TEXT
    )`);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_logs_corr
       ON logs (project, run_id, trace_id, level, ts)`,
  );
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

export function prune(db: Database, maxAgeMs: number, now: number = Date.now()): number {
  const cutoff = now - maxAgeMs;
  return db.query('DELETE FROM logs WHERE recv_ts < ?').run(cutoff).changes;
}
