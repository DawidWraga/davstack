// RED first. The clean core operates on a bun:sqlite Database so it is fully
// TDD-able with temp DBs. Decisions under test (from notes/multi-db 03 §3-§4):
//   - FULL sweep (manual default) removes ALL rows, ignores window.
//   - WINDOWED sweep (auto-clean) removes only rows older than now-windowMs
//     using recv_ts (the server receive clock).
//   - delete mode: DELETE + VACUUM → file shrinks (DELETE alone does not).
//   - archive mode: write a .sql.br archive of the targeted rows FIRST, then
//     DELETE + VACUUM. The archive round-trips: brotli-decompress → re-exec the
//     SQL into a fresh DB → the rows match exactly what was removed.
//   - windowed archive contains ONLY the old rows.

import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { brotliDecompressSync } from 'node:zlib';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, insertLogs, type LogRow } from '../../src/db.js';
import { cleanDb, startAutoClean } from '../../src/clean.js';

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

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'clean-test-'));
}

function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* OS reclaims */
  }
}

// Insert a chunk of fat rows so the file is meaningfully > a fresh-vacuum
// baseline, making the VACUUM shrink observable.
function fillFat(db: Database, count: number, over: Partial<LogRow> = {}) {
  const fat = JSON.stringify({ blob: 'x'.repeat(2000) });
  const rows: LogRow[] = [];
  for (let i = 0; i < count; i++) rows.push(row({ msg: `m${i}`, data: fat, ...over }));
  insertLogs(db, rows);
}

test('FULL sweep empties the table and shrinks the file', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'logs.db');
  const db = openDb(dbPath);
  fillFat(db, 500);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); // fold WAL into main file
  const before = statSync(dbPath).size;
  const result = cleanDb({ db, dbPath, mode: 'delete', logsDir: dir });
  db.close();

  expect(result.rowsRemoved).toBe(500);
  expect(result.archivePath).toBeNull();
  const reopen = openDb(dbPath);
  const remaining = (reopen.query('SELECT count(*) c FROM logs').get() as { c: number }).c;
  reopen.close();
  expect(remaining).toBe(0);
  const after = statSync(dbPath).size;
  expect(after).toBeLessThan(before);
  expect(result.bytesBefore).toBeGreaterThan(result.bytesAfter);
  cleanup(dir);
});

test('WINDOWED sweep removes only rows older than the cutoff (by recv_ts)', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'logs.db');
  const db = openDb(dbPath);
  const now = Date.now();
  // 3 old (2h ago) + 2 fresh (1m ago)
  insertLogs(db, [
    row({ msg: 'old-1', recv_ts: now - 2 * 60 * 60 * 1000 }),
    row({ msg: 'old-2', recv_ts: now - 2 * 60 * 60 * 1000 }),
    row({ msg: 'old-3', recv_ts: now - 90 * 60 * 1000 }),
    row({ msg: 'fresh-1', recv_ts: now - 60 * 1000 }),
    row({ msg: 'fresh-2', recv_ts: now - 60 * 1000 }),
  ]);

  const result = cleanDb({
    db,
    dbPath,
    mode: 'delete',
    logsDir: dir,
    windowMs: 60 * 60 * 1000, // 1h retention → the 3 old rows go
    now,
  });

  expect(result.rowsRemoved).toBe(3);
  const left = (db.query('SELECT msg FROM logs ORDER BY msg').all() as { msg: string }[]).map(
    (r) => r.msg,
  );
  expect(left).toEqual(['fresh-1', 'fresh-2']);
  db.close();
  cleanup(dir);
});

test('delete mode shrinks the file (VACUUM, not bare DELETE)', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'logs.db');
  const db = openDb(dbPath);
  fillFat(db, 800);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const before = statSync(dbPath).size;

  const result = cleanDb({ db, dbPath, mode: 'delete', logsDir: dir });
  db.close();

  const after = statSync(dbPath).size;
  // The whole point of VACUUM: the on-disk file actually shrinks.
  expect(after).toBeLessThan(before);
  expect(result.bytesBefore).toBe(before);
  expect(result.bytesAfter).toBe(after);
  cleanup(dir);
});

test('archive mode writes a .sql.br, removes rows, shrinks, and round-trips exactly', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'logs.db');
  const db = openDb(dbPath);
  // Mix logs + spans + attrs/tag so the dump escaping is exercised.
  insertLogs(db, [
    row({ msg: "quote'd", attrs: JSON.stringify({ a: "o'brien", n: 1 }), tag: 'server-fn' }),
    row({ msg: 'span-row', kind: 'span', duration_ms: 12.5, attrs: null }),
    row({ msg: 'newline\nrow', data: '{"x":"a\\nb"}' }),
  ]);
  fillFat(db, 200);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const before = statSync(dbPath).size;

  const removedRows = db.query('SELECT * FROM logs ORDER BY id').all() as Record<string, unknown>[];
  const result = cleanDb({ db, dbPath, mode: 'archive', logsDir: dir });
  db.close();

  // archive file exists, under logsDir/archive, .sql.br
  expect(result.archivePath).toBeTruthy();
  expect(result.archivePath!.endsWith('.sql.br')).toBe(true);
  expect(existsSync(result.archivePath!)).toBe(true);
  const archiveDir = join(dir, 'archive');
  expect(readdirSync(archiveDir).some((f) => f.endsWith('.sql.br'))).toBe(true);

  // rows gone + file shrank
  const reopen = openDb(dbPath);
  expect((reopen.query('SELECT count(*) c FROM logs').get() as { c: number }).c).toBe(0);
  reopen.close();
  expect(statSync(dbPath).size).toBeLessThan(before);

  // round-trip: decompress → exec into a fresh DB → rows match what was removed
  const sql = brotliDecompressSync(readFileSync(result.archivePath!)).toString('utf8');
  const restored = new Database(':memory:');
  restored.exec(sql);
  const restoredRows = restored
    .query('SELECT * FROM logs ORDER BY id')
    .all() as Record<string, unknown>[];
  restored.close();
  expect(restoredRows).toEqual(removedRows);
  expect(restoredRows.length).toBe(removedRows.length);
  cleanup(dir);
});

test('windowed archive contains only the old rows', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'logs.db');
  const db = openDb(dbPath);
  const now = Date.now();
  insertLogs(db, [
    row({ msg: 'old-a', recv_ts: now - 5 * 60 * 60 * 1000 }),
    row({ msg: 'old-b', recv_ts: now - 5 * 60 * 60 * 1000 }),
    row({ msg: 'fresh', recv_ts: now - 60 * 1000 }),
  ]);

  const result = cleanDb({
    db,
    dbPath,
    mode: 'archive',
    logsDir: dir,
    windowMs: 60 * 60 * 1000,
    now,
  });
  db.close();

  expect(result.rowsRemoved).toBe(2);
  const sql = brotliDecompressSync(readFileSync(result.archivePath!)).toString('utf8');
  const restored = new Database(':memory:');
  restored.exec(sql);
  const msgs = (restored.query('SELECT msg FROM logs ORDER BY msg').all() as { msg: string }[]).map(
    (r) => r.msg,
  );
  restored.close();
  expect(msgs).toEqual(['old-a', 'old-b']);
  cleanup(dir);
});

test('startAutoClean runs a windowed sweep on the injected handle', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'logs.db');
  const db = openDb(dbPath);
  const now = Date.now();
  insertLogs(db, [
    row({ msg: 'old', recv_ts: now - 5 * 60 * 60 * 1000 }),
    row({ msg: 'fresh', recv_ts: now - 60 * 1000 }),
  ]);

  // Capture the tick callback instead of arming a real timer.
  let tick: (() => void) | undefined;
  const fakeSetInterval = ((fn: () => void) => {
    tick = fn;
    return { unref() {} } as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;

  const logs: string[] = [];
  startAutoClean({
    interval: '10m',
    window: '1h',
    mode: 'delete',
    dbPath,
    getDb: () => db,
    setIntervalFn: fakeSetInterval,
    log: (m) => logs.push(m),
  });
  expect(tick).toBeDefined();
  tick!(); // fire one sweep

  const left = (db.query('SELECT msg FROM logs').all() as { msg: string }[]).map((r) => r.msg);
  expect(left).toEqual(['fresh']);
  expect(logs.some((m) => m.includes('auto-clean removed 1'))).toBe(true);
  db.close();
  cleanup(dir);
});

test('startAutoClean overlap guard skips a re-entrant tick', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'logs.db');
  const db = openDb(dbPath);
  insertLogs(db, [row({ msg: 'a' }), row({ msg: 'b' })]);

  let tick: (() => void) | undefined;
  const fakeSetInterval = ((fn: () => void) => {
    tick = fn;
    return { unref() {} } as unknown as ReturnType<typeof setInterval>;
  }) as unknown as typeof setInterval;

  let cleanCalls = 0;
  startAutoClean({
    interval: '10m',
    window: '1h',
    mode: 'delete',
    dbPath,
    // Re-enter the timer while the first sweep is "in flight": the guard must
    // make the nested tick a no-op (cleanCalls increments only once).
    getDb: () => {
      cleanCalls++;
      tick!(); // re-entrant call — should be skipped by the guard
      return db;
    },
    setIntervalFn: fakeSetInterval,
  });
  tick!();
  expect(cleanCalls).toBe(1);
  db.close();
  cleanup(dir);
});

test('cleaning an empty / already-clean table is a no-op (no archive written for 0 rows)', () => {
  const dir = tmpDir();
  const dbPath = join(dir, 'logs.db');
  const db = openDb(dbPath);
  const result = cleanDb({ db, dbPath, mode: 'archive', logsDir: dir });
  db.close();
  expect(result.rowsRemoved).toBe(0);
  expect(result.archivePath).toBeNull();
  cleanup(dir);
});
