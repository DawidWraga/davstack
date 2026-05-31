// RED first. Storage layer for the diag sink. The design decision asserted
// here before any implementation exists: project-scoping must hold even when
// trace_id COLLIDES across projects (one DB can serve multiple repos — the
// `project` column scopes).

import { test, expect } from 'bun:test';
import { openDb, insertLogs, selectByTrace, type LogRow } from '../src/db.js';

function row(over: Partial<LogRow>): LogRow {
  return {
    ts: 1_700_000_000.0,
    recv_ts: Date.now(),
    kind: 'log',
    project: 'proj-a',
    service: 'sentry.python',
    run_id: 'run-1',
    trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    span_id: 'bbbbbbbbbbbbbbbb',
    level: 'info',
    severity_number: 9,
    logger: 'auto.db',
    msg: 'hello',
    data: '{"raw":"item"}',
    attrs: null,
    tag: null,
    duration_ms: null,
    ...over,
  };
}

test('openDb creates the logs table and the correlation index', () => {
  const db = openDb(':memory:');
  const tbl = db
    .query("select name from sqlite_master where type='table' and name='logs'")
    .get() as { name: string } | null;
  expect(tbl?.name).toBe('logs');
  const idx = db
    .query("select sql from sqlite_master where type='index' and tbl_name='logs' and sql is not null")
    .all() as { sql: string }[];
  const cols = idx.map((r) => r.sql).join(' ');
  for (const c of ['project', 'run_id', 'trace_id', 'level', 'ts']) {
    expect(cols).toContain(c);
  }
});

test('openDb stores attrs as a real column (no logs_v view)', () => {
  const db = openDb(':memory:');
  const view = db
    .query("SELECT name FROM sqlite_master WHERE type='view' AND name='logs_v'")
    .get() as { name: string } | null;
  expect(view).toBeNull();
  const cols = db.query("PRAGMA table_info(logs)").all() as { name: string }[];
  expect(cols.some((c) => c.name === 'attrs')).toBe(true);
  insertLogs(db, [row({ msg: 'with-attrs', attrs: JSON.stringify({ seam: 'x', n: 42 }) })]);
  const r = db
    .query(
      `SELECT json_extract(attrs, '$.seam') AS seam,
              json_extract(attrs, '$.n')    AS n
       FROM logs WHERE msg = 'with-attrs'`,
    )
    .get() as { seam: unknown; n: unknown };
  expect(r.seam).toBe('x');
  expect(r.n).toBe(42);
});

test('openDb migrates pre-2.2 schema: backfills attrs column, drops logs_v view', () => {
  // Hand-construct the legacy schema (no attrs column, with logs_v view)
  // to prove the migration path is idempotent and lossless.
  const { Database } = require('bun:sqlite');
  const legacy = new Database(':memory:');
  legacy.exec(`CREATE TABLE logs (
    id INTEGER PRIMARY KEY, ts REAL, recv_ts REAL, project TEXT, service TEXT,
    run_id TEXT, trace_id TEXT, span_id TEXT, level TEXT, severity_number INTEGER,
    logger TEXT, msg TEXT, data TEXT, tag TEXT
  )`);
  legacy.exec(`CREATE VIEW logs_v AS SELECT l.* FROM logs l`);
  legacy.exec(
    `INSERT INTO logs (ts, recv_ts, project, msg, data) VALUES
       (1, 1, 'p', 'with', '{"attributes":{"seam":{"value":"after","type":"string"},"n":{"value":7,"type":"integer"}}}'),
       (2, 2, 'p', 'without', '{"body":"x"}')`,
  );
  // Persist to a temp file so we can re-open it through openDb() and force
  // the migration path to fire on a real file.
  const tmp = `/tmp/migrate-unit-${process.pid}-${Date.now()}.db`;
  legacy.exec(`VACUUM INTO '${tmp}'`);
  legacy.close();

  const db = openDb(tmp);
  // View is gone
  const view = db
    .query("SELECT name FROM sqlite_master WHERE type='view' AND name='logs_v'")
    .get();
  expect(view).toBeNull();
  // attrs column exists and is backfilled
  const cols = db.query("PRAGMA table_info(logs)").all() as { name: string }[];
  expect(cols.some((c) => c.name === 'attrs')).toBe(true);
  const r1 = db
    .query(`SELECT json_extract(attrs, '$.seam') AS seam, json_extract(attrs, '$.n') AS n FROM logs WHERE msg = 'with'`)
    .get() as { seam: unknown; n: unknown };
  expect(r1.seam).toBe('after');
  expect(r1.n).toBe(7);
  const r2 = db.query(`SELECT attrs FROM logs WHERE msg = 'without'`).get() as { attrs: unknown };
  expect(r2.attrs).toBeNull();

  // Idempotent — second open is a no-op (no throw, no schema drift).
  db.close();
  const db2 = openDb(tmp);
  const r1b = db2
    .query(`SELECT json_extract(attrs, '$.seam') AS seam FROM logs WHERE msg = 'with'`)
    .get() as { seam: unknown };
  expect(r1b.seam).toBe('after');
  db2.close();
  require('node:fs').rmSync(tmp, { force: true });
  require('node:fs').rmSync(`${tmp}-wal`, { force: true });
  require('node:fs').rmSync(`${tmp}-shm`, { force: true });
});

test('openDb stores kind + duration_ms columns; spans round-trip and sort by duration', () => {
  const db = openDb(':memory:');
  const cols = db.query('PRAGMA table_info(logs)').all() as { name: string }[];
  expect(cols.some((c) => c.name === 'kind')).toBe(true);
  expect(cols.some((c) => c.name === 'duration_ms')).toBe(true);
  insertLogs(db, [
    row({ kind: 'log', msg: 'a-log' }),
    row({ kind: 'span', msg: 'fast', duration_ms: 5 }),
    row({ kind: 'span', msg: 'slow', duration_ms: 120 }),
  ]);
  // kind discriminates; duration_ms is a real sortable column
  const spans = db
    .query("SELECT msg FROM logs WHERE kind = 'span' ORDER BY duration_ms DESC")
    .all() as { msg: string }[];
  expect(spans.map((r) => r.msg)).toEqual(['slow', 'fast']);
  const logCount = (
    db.query("SELECT count(*) c FROM logs WHERE kind = 'log'").get() as { c: number }
  ).c;
  expect(logCount).toBe(1);
});

test('openDb migrates pre-2.7 schema: adds kind/duration_ms, existing rows → kind=log', () => {
  // Hand-build a 2.6-era table (has attrs, no kind/duration_ms) with rows that
  // predate trace ingestion. The migration must add the columns and default
  // every existing row to kind='log' with a NULL duration.
  const { Database } = require('bun:sqlite');
  const legacy = new Database(':memory:');
  legacy.exec(`CREATE TABLE logs (
    id INTEGER PRIMARY KEY, ts REAL, recv_ts REAL, project TEXT, service TEXT,
    run_id TEXT, trace_id TEXT, span_id TEXT, level TEXT, severity_number INTEGER,
    logger TEXT, msg TEXT, data TEXT, attrs TEXT, tag TEXT
  )`);
  legacy.exec(`INSERT INTO logs (ts, recv_ts, project, msg, data) VALUES
    (1, 1, 'p', 'old-one', '{"body":"x"}'),
    (2, 2, 'p', 'old-two', '{"body":"y"}')`);
  const tmp = `/tmp/migrate-kind-${process.pid}-${Date.now()}.db`;
  legacy.exec(`VACUUM INTO '${tmp}'`);
  legacy.close();

  const db = openDb(tmp);
  const cols = db.query('PRAGMA table_info(logs)').all() as { name: string }[];
  expect(cols.some((c) => c.name === 'kind')).toBe(true);
  expect(cols.some((c) => c.name === 'duration_ms')).toBe(true);
  const rows = db
    .query('SELECT kind, duration_ms FROM logs ORDER BY id')
    .all() as { kind: string; duration_ms: unknown }[];
  expect(rows.map((r) => r.kind)).toEqual(['log', 'log']);
  expect(rows.every((r) => r.duration_ms === null)).toBe(true);

  // Idempotent — a second open is a no-op (no throw, no schema drift), and a
  // freshly inserted span coexists with the migrated logs.
  db.close();
  const db2 = openDb(tmp);
  insertLogs(db2, [row({ kind: 'span', msg: 'new-span', duration_ms: 42, ts: 3, recv_ts: 3 })]);
  const counts = db2
    .query("SELECT kind, count(*) c FROM logs GROUP BY kind ORDER BY kind")
    .all() as { kind: string; c: number }[];
  expect(counts).toEqual([
    { kind: 'log', c: 2 },
    { kind: 'span', c: 1 },
  ]);
  db2.close();
  // Best-effort cleanup. On Windows the WAL/shm handles can linger a beat after
  // close(), so a rm race can EBUSY — swallow it (the OS reclaims the temp file).
  for (const p of [tmp, `${tmp}-wal`, `${tmp}-shm`]) {
    try {
      require('node:fs').rmSync(p, { force: true });
    } catch {
      /* temp file still locked — leave it for the OS */
    }
  }
});

test('insertLogs batch-inserts and rows are retrievable with autoincrement id', () => {
  const db = openDb(':memory:');
  const n = insertLogs(db, [row({ msg: 'a' }), row({ msg: 'b' }), row({ msg: 'c' })]);
  expect(n).toBe(3);
  const ids = (db.query('select id from logs order by id').all() as { id: number }[]).map(
    (r) => r.id,
  );
  expect(ids).toEqual([1, 2, 3]);
});

test('project-scoping holds even when trace_id collides across projects', () => {
  const db = openDb(':memory:');
  const SHARED = 'cccccccccccccccccccccccccccccccc';
  insertLogs(db, [
    row({ project: 'proj-a', trace_id: SHARED, msg: 'a-only' }),
    row({ project: 'proj-b', trace_id: SHARED, msg: 'b-only' }),
  ]);
  const a = selectByTrace(db, 'proj-a', SHARED);
  expect(a.map((r) => r.msg)).toEqual(['a-only']);
  const b = selectByTrace(db, 'proj-b', SHARED);
  expect(b.map((r) => r.msg)).toEqual(['b-only']);
});

