// The `logs_v` read-side overlay (#52): `attrs` (flat, {value,type} wrapper
// stripped) and `raw_attrs` (typed envelope, one path-level shallower than
// `data.attributes`). Bun-only because we need real `bun:sqlite` for the
// JSON1 functions (json_each / json_group_object) the view leans on; the
// vitest/node side mocks `bun:sqlite` and would never exercise them.

import { test, expect } from 'bun:test';
import { openDb, insertLogs, type LogRow } from '../../src/db.js';

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
    data: '{}',
    tag: null,
    ...over,
  };
}

// Mirror the OTel transmitter shape: `data` is the verbatim Sentry log record
// and each attribute is wrapped `{value, type}`. Arrays land in `value` as a
// native JSON array (what `JSON.stringify` of the record actually produces —
// envelope.ts keeps `data` verbatim, so this is what reaches the DB).
function dataWith(attributes: Record<string, unknown> | undefined, body = 'x') {
  const rec: Record<string, unknown> = { body };
  if (attributes !== undefined) rec.attributes = attributes;
  return JSON.stringify(rec);
}

test('logs_v exists alongside the base logs table', () => {
  const db = openDb(':memory:');
  const v = db
    .query("SELECT name FROM sqlite_master WHERE type='view' AND name='logs_v'")
    .get() as { name: string } | null;
  expect(v?.name).toBe('logs_v');
});

test('attrs flattens the OTel {value,type} wrapper across mixed value types', () => {
  const db = openDb(':memory:');
  insertLogs(db, [
    row({
      msg: 'mixed',
      tag: 'mix',
      data: dataWith(
        {
          seam: { value: 'after-fetch', type: 'string' },
          row_count: { value: 42, type: 'integer' },
          ok: { value: true, type: 'boolean' },
          rows: { value: [1, 2, 3], type: 'array' },
        },
        'mixed',
      ),
    }),
  ]);
  const r = db
    .query(
      `SELECT json_extract(attrs, '$.seam')      AS seam,
              json_extract(attrs, '$.row_count') AS row_count,
              json_extract(attrs, '$.ok')        AS ok,
              json_extract(attrs, '$.rows')      AS rows
       FROM logs_v WHERE tag = ?`,
    )
    .get('mix') as { seam: unknown; row_count: unknown; ok: unknown; rows: unknown };

  expect(r.seam).toBe('after-fetch');
  // numbers must come back as numbers, not strings
  expect(r.row_count).toBe(42);
  expect(typeof r.row_count).toBe('number');
  // sqlite has no native bool — json `true` round-trips as 1
  expect(r.ok).toBe(1);
  // arrays surface as the JSON-array text; json_extract preserves the shape
  expect(JSON.parse(String(r.rows))).toEqual([1, 2, 3]);
});

test('attrs is NULL (cleanly, no error) for rows without an attributes block', () => {
  const db = openDb(':memory:');
  insertLogs(db, [
    row({ msg: 'no-attrs', tag: 'bare', data: dataWith(undefined, 'no-attrs') }),
  ]);
  const r = db
    .query(
      `SELECT attrs, raw_attrs FROM logs_v WHERE tag = ?`,
    )
    .get('bare') as { attrs: unknown; raw_attrs: unknown };
  expect(r.attrs).toBeNull();
  expect(r.raw_attrs).toBeNull();
});

test('raw_attrs exposes the typed envelope one path-level shallower than data.attributes', () => {
  const db = openDb(':memory:');
  insertLogs(db, [
    row({
      msg: 'raw',
      tag: 'raw',
      data: dataWith(
        { seam: { value: 'after-fetch', type: 'string' } },
        'raw',
      ),
    }),
  ]);
  const r = db
    .query(
      `SELECT json_extract(raw_attrs, '$.seam.value') AS seam_value,
              json_extract(raw_attrs, '$.seam.type')  AS seam_type
       FROM logs_v WHERE tag = ?`,
    )
    .get('raw') as { seam_value: unknown; seam_type: unknown };
  expect(r.seam_value).toBe('after-fetch');
  expect(r.seam_type).toBe('string');
});
