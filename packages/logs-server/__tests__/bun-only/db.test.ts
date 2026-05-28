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

