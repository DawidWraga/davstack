// Dispatch seam: parse one envelope, fan its rows out to the right DB files
// based on the `davstack-logs.db` attribute. Default-DB fallback covers both
// the "attribute absent" and "attribute invalid" cases — bad routing must
// not lose data, just redirect to the default bucket with a stderr warning.

import { test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DbHandleCache } from '../../src/db-cache.js';
import { dispatchIngest } from '../../src/ingest.js';
import { _resetWarnOnceForTests } from '../../src/db-route.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dispatch-'));
  _resetWarnOnceForTests();
});

const a = (value: unknown, type = 'string') => ({ value, type });

function logRec(over: Record<string, unknown> = {}, attrs: Record<string, { value: unknown; type: string }> = {}) {
  return {
    timestamp: 1.0,
    trace_id: 'a'.repeat(32),
    level: 'info',
    body: 'x',
    attributes: { 'diag.project': a('p'), ...attrs },
    ...over,
  };
}

function envelope(items: unknown[]) {
  return [
    JSON.stringify({ sdk: { name: 'sentry.javascript.browser', version: '9.41.0' } }),
    JSON.stringify({
      type: 'log',
      item_count: items.length,
      content_type: 'application/vnd.sentry.items.log+json',
    }),
    JSON.stringify({ items }),
  ].join('\n');
}

function countRows(path: string): number {
  const cache = new DbHandleCache();
  const db = cache.getOrOpen(path);
  const n = (db.query('SELECT COUNT(*) c FROM logs').get() as { c: number }).c;
  cache.closeAll();
  return n;
}

test('fans rows out to the right DB by route attribute', () => {
  const cache = new DbHandleCache();
  const defaultDb = join(dir, '.davstack', 'logs', 'default.db');
  const repoRoot = dir;

  const raw = envelope([
    logRec({ body: 'one' }, { 'davstack-logs.db': a('reorder-bug') }),
    logRec({ body: 'two' }, { 'davstack-logs.db': a('reorder-bug') }),
    logRec({ body: 'three' }, { 'davstack-logs.db': a('hotfix-7c') }),
    logRec({ body: 'four' }),
  ]);

  const res = dispatchIngest(raw, { cache, defaultDbPath: defaultDb, repoRoot }, Date.now());
  expect(res.accepted).toBe(4);

  expect(countRows(join(dir, '.davstack', 'logs', 'reorder-bug.db'))).toBe(2);
  expect(countRows(join(dir, '.davstack', 'logs', 'hotfix-7c.db'))).toBe(1);
  expect(countRows(defaultDb)).toBe(1);
  cache.closeAll();
});

test('invalid route values route to default + emit a stderr warning', () => {
  const cache = new DbHandleCache();
  const defaultDb = join(dir, '.davstack', 'logs', 'default.db');
  const warned: string[] = [];

  const raw = envelope([
    logRec({ body: 'good' }, { 'davstack-logs.db': a('reorder-bug') }),
    logRec({ body: 'bad' }, { 'davstack-logs.db': a('Bad Value') }),
    logRec({ body: 'escape' }, { 'davstack-logs.db': a('../../../escaped') }),
  ]);

  const res = dispatchIngest(
    raw,
    { cache, defaultDbPath: defaultDb, repoRoot: dir, warn: (m) => warned.push(m) },
    Date.now(),
  );
  expect(res.accepted).toBe(3);

  expect(countRows(join(dir, '.davstack', 'logs', 'reorder-bug.db'))).toBe(1);
  expect(countRows(defaultDb)).toBe(2);
  expect(warned.length).toBe(2);
  expect(warned[0]).toContain('Bad Value');
  expect(warned[1]).toContain('escaped');
  cache.closeAll();
});

test('all-default envelope creates the default DB file at the new path', () => {
  const cache = new DbHandleCache();
  const defaultDb = join(dir, '.davstack', 'logs', 'default.db');
  const raw = envelope([logRec({ body: 'only' })]);

  const res = dispatchIngest(raw, { cache, defaultDbPath: defaultDb, repoRoot: dir }, Date.now());
  expect(res.accepted).toBe(1);
  expect(existsSync(defaultDb)).toBe(true);
  cache.closeAll();
});

test('persisted data has the route attribute stripped (regression guard)', () => {
  const cache = new DbHandleCache();
  const defaultDb = join(dir, '.davstack', 'logs', 'default.db');
  const raw = envelope([
    logRec(
      { body: 'check-me' },
      { 'davstack-logs.db': a('check-bug'), 'diag.run_id': a('r-9') },
    ),
  ]);

  dispatchIngest(raw, { cache, defaultDbPath: defaultDb, repoRoot: dir }, Date.now());
  const dbPath = join(dir, '.davstack', 'logs', 'check-bug.db');
  const db = cache.getOrOpen(dbPath);
  const row = db.query('SELECT data FROM logs').get() as { data: string };
  const parsed = JSON.parse(row.data) as { attributes: Record<string, unknown> };
  expect(parsed.attributes['davstack-logs.db']).toBeUndefined();
  expect(parsed.attributes['diag.run_id']).toEqual({ value: 'r-9', type: 'string' });
  cache.closeAll();
});
