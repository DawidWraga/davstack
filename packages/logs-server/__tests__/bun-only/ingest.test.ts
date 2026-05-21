// RED first. The ingest seam: parse a raw Sentry envelope body, stamp the
// SERVER recv_ts (not the client ts — clock-skew safety, see db.test), persist
// via a real in-memory DB. Must never throw and never drop the whole batch
// for one bad record ("sink garbage-in must not crash the app", notes 03).

import { test, expect } from 'bun:test';
import { openDb } from '../src/db.ts';
import { handleIngest } from '../src/ingest.ts';

function envelope(items: unknown[], extraLines: string[] = []) {
  return [
    JSON.stringify({ sdk: { name: 'sentry.python', version: '2.43.0' } }),
    JSON.stringify({
      type: 'log',
      item_count: items.length,
      content_type: 'application/vnd.sentry.items.log+json',
    }),
    JSON.stringify({ items }),
    ...extraLines,
  ].join('\n');
}

const log = (over: Record<string, unknown> = {}) => ({
  timestamp: 1.0, // ancient client ts on purpose
  trace_id: 'a'.repeat(32),
  level: 'info',
  body: 'hi',
  attributes: { 'diag.project': { value: 'p', type: 'string' } },
  ...over,
});

test('persists rows and stamps the SERVER recv_ts, not the client ts', () => {
  const db = openDb(':memory:');
  const now = 1_700_000_123_456;
  const res = handleIngest(db, envelope([log(), log({ body: 'two' })]), now);
  expect(res).toEqual({ accepted: 2, skipped: 0 });
  const got = db.query('select ts, recv_ts, msg from logs order by id').all() as {
    ts: number;
    recv_ts: number;
    msg: string;
  }[];
  expect(got.map((r) => r.msg)).toEqual(['hi', 'two']);
  for (const r of got) {
    expect(r.ts).toBe(1.0); // client ts preserved verbatim
    expect(r.recv_ts).toBe(now); // server clock stamped
  }
});

test('garbage body never throws, persists nothing', () => {
  const db = openDb(':memory:');
  let res: ReturnType<typeof handleIngest> | undefined;
  expect(() => {
    res = handleIngest(db, 'not an envelope at all', Date.now());
  }).not.toThrow();
  expect(res!.accepted).toBe(0);
  expect((db.query('select count(*) c from logs').get() as { c: number }).c).toBe(0);
});

test('one poison line does not drop the good records', () => {
  const db = openDb(':memory:');
  const res = handleIngest(db, envelope([log({ body: 'good' })], ['{ not json']), Date.now());
  expect(res.accepted).toBe(1);
  expect(res.skipped).toBeGreaterThanOrEqual(1);
  expect((db.query('select msg from logs').get() as { msg: string }).msg).toBe('good');
});
