// DbHandleCache holds one Database handle per absolute path. Bun-only because
// it allocates real bun:sqlite databases — the cache hit/miss invariant is
// only meaningful against the same Database instance the daemon uses to write.

import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbHandleCache } from '../../src/db-cache.js';
import { insertLogs, type LogRow } from '../../src/db.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'db-cache-'));
});

function cleanup(d: string) {
  try {
    rmSync(d, { recursive: true, force: true });
  } catch {}
}

function row(over: Partial<LogRow>): LogRow {
  return {
    ts: 1,
    recv_ts: Date.now(),
    project: 'p',
    service: 's',
    run_id: 'r',
    trace_id: 't',
    span_id: '',
    level: 'info',
    severity_number: 9,
    logger: '',
    msg: 'm',
    data: '{}',
    tag: null,
    ...over,
  };
}

test('getOrOpen returns the SAME handle on repeated calls (cache hit)', () => {
  const cache = new DbHandleCache();
  const p = join(dir, 'a.db');
  const a = cache.getOrOpen(p);
  const b = cache.getOrOpen(p);
  expect(a).toBe(b);
  cache.closeAll();
  cleanup(dir);
});

test('different paths get different handles and materialize different files', () => {
  const cache = new DbHandleCache();
  const a = cache.getOrOpen(join(dir, 'one.db'));
  const b = cache.getOrOpen(join(dir, 'two.db'));
  expect(a).not.toBe(b);
  insertLogs(a, [row({ msg: 'in-one' })]);
  insertLogs(b, [row({ msg: 'in-two' })]);
  expect((a.query('SELECT COUNT(*) c FROM logs').get() as { c: number }).c).toBe(1);
  expect((b.query('SELECT COUNT(*) c FROM logs').get() as { c: number }).c).toBe(1);
  cache.closeAll();
  cleanup(dir);
});

test('opens through ensureParent — nested dirs are created on demand', () => {
  const cache = new DbHandleCache();
  const p = join(dir, 'deep', 'down', 'nested.db');
  const db = cache.getOrOpen(p);
  insertLogs(db, [row({})]);
  expect(existsSync(p)).toBe(true);
  cache.closeAll();
  cleanup(dir);
});

test('first open runs the schema (logs table + logs_v view both exist)', () => {
  const cache = new DbHandleCache();
  const db = cache.getOrOpen(join(dir, 'schema.db'));
  const tbl = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name='logs'")
    .get() as { name: string } | null;
  const view = db
    .query("SELECT name FROM sqlite_master WHERE type='view' AND name='logs_v'")
    .get() as { name: string } | null;
  expect(tbl?.name).toBe('logs');
  expect(view?.name).toBe('logs_v');
  cache.closeAll();
  cleanup(dir);
});

test('sweep closes handles idle past the timeout', () => {
  const cache = new DbHandleCache({ idleCloseMs: 1_000 });
  const p = join(dir, 'idle.db');
  cache.getOrOpen(p);
  expect(cache._sizeForTests()).toBe(1);
  // simulate 5 minutes idle — the sweep is normally driven by the wall clock,
  // but exposed-for-test lets us drive it deterministically.
  cache._sweepForTests(Date.now() + 60 * 60 * 1000);
  expect(cache._sizeForTests()).toBe(0);
  cleanup(dir);
});

test('sweep retains handles still within idle window', () => {
  const cache = new DbHandleCache({ idleCloseMs: 60 * 60 * 1000 });
  const p = join(dir, 'fresh.db');
  cache.getOrOpen(p);
  cache._sweepForTests(Date.now() + 1_000);
  expect(cache._sizeForTests()).toBe(1);
  cache.closeAll();
  cleanup(dir);
});
