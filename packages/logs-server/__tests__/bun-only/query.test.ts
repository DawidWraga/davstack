// RED first. The retrieval layer — the actual value (notes 01: queryable
// correlated retrieval is the whole game). Canned cuts must stay strictly
// within their correlation scope (project + run/trace) even when ids collide,
// and the error-context window must center on the error and clamp at edges.

import { test, expect } from 'bun:test';
import { openDb, insertLogs, type LogRow } from '../src/db.js';
import {
  runTimeline,
  traceAssembly,
  errorContext,
  filterLogs,
  format,
} from '../src/query.js';

let seq = 0;
function mk(over: Partial<LogRow>): LogRow {
  seq += 1;
  return {
    ts: seq, // ts == insertion order for deterministic windows
    recv_ts: 1_700_000_000_000 + seq,
    project: 'p',
    service: 'sentry.python',
    run_id: 'run-1',
    trace_id: 't1',
    span_id: '',
    level: 'info',
    severity_number: 9,
    logger: 'auto',
    msg: 'm',
    data: '{}',
    tag: null,
    ...over,
  };
}

test('runTimeline returns one run, in ts order, scoped by project', () => {
  const db = openDb(':memory:');
  insertLogs(db, [
    mk({ run_id: 'run-1', msg: 'a' }),
    mk({ run_id: 'run-2', msg: 'other-run' }),
    mk({ run_id: 'run-1', msg: 'b' }),
    mk({ project: 'q', run_id: 'run-1', msg: 'other-proj' }),
  ]);
  const rows = runTimeline(db, { project: 'p', run_id: 'run-1' });
  expect(rows.map((r) => r.msg)).toEqual(['a', 'b']);
});

test('traceAssembly gathers a trace across services, project-scoped on shared trace', () => {
  const db = openDb(':memory:');
  const SHARED = 'shared-trace';
  insertLogs(db, [
    mk({ project: 'p', trace_id: SHARED, service: 'sentry.javascript.browser', msg: 'fe' }),
    mk({ project: 'p', trace_id: SHARED, service: 'sentry.python', msg: 'be' }),
    mk({ project: 'q', trace_id: SHARED, service: 'sentry.python', msg: 'other-proj' }),
  ]);
  const rows = traceAssembly(db, { project: 'p', trace_id: SHARED });
  expect(rows.map((r) => r.msg)).toEqual(['fe', 'be']);
  expect(new Set(rows.map((r) => r.service))).toEqual(
    new Set(['sentry.javascript.browser', 'sentry.python']),
  );
});

test('errorContext centers a ±N window on each error, clamps, stays in scope', () => {
  const db = openDb(':memory:');
  // 8 rows in trace t1; row 6 is the error. Plus a noise row in another trace.
  for (let i = 1; i <= 8; i += 1) {
    insertLogs(db, [mk({ trace_id: 't1', level: i === 6 ? 'error' : 'info', msg: `r${i}` })]);
  }
  insertLogs(db, [mk({ trace_id: 't2', level: 'error', msg: 'other-trace-error' })]);
  const groups = errorContext(db, { project: 'p', trace_id: 't1', context: 2 });
  expect(groups).toHaveLength(1);
  expect(groups[0].error.msg).toBe('r6');
  // window = r4..r8 (2 before, error, 2 after) — clamped, no bleed from t2
  expect(groups[0].window.map((r) => r.msg)).toEqual(['r4', 'r5', 'r6', 'r7', 'r8']);
});

test('filterLogs supports level, grep, project, and limit', () => {
  const db = openDb(':memory:');
  insertLogs(db, [
    mk({ level: 'error', msg: 'boom in parser' }),
    mk({ level: 'info', msg: 'boom in parser' }),
    mk({ level: 'error', msg: 'unrelated' }),
    mk({ project: 'q', level: 'error', msg: 'boom in parser' }),
  ]);
  const r1 = filterLogs(db, { project: 'p', level: 'error' });
  expect(r1.map((r) => r.msg)).toEqual(['boom in parser', 'unrelated']);
  const r2 = filterLogs(db, { project: 'p', grep: 'boom' });
  expect(r2.map((r) => r.msg)).toEqual(['boom in parser', 'boom in parser']);
  const r3 = filterLogs(db, { project: 'p', level: 'error', grep: 'boom', limit: 1 });
  expect(r3).toHaveLength(1);
});

test('format: compact = one line per row with level+msg; human groups by service', () => {
  const rows = [
    mk({ service: 'sentry.javascript.browser', level: 'info', msg: 'click', trace_id: 'tt' }),
    mk({ service: 'sentry.python', level: 'error', msg: 'kaboom', trace_id: 'tt' }),
  ];
  const compact = format(rows, { compact: true });
  const lines = compact.trimEnd().split('\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain('info');
  expect(lines[0]).toContain('click');
  expect(lines[1]).toContain('error');
  expect(lines[1]).toContain('kaboom');
  const human = format(rows, { compact: false });
  expect(human).toContain('sentry.javascript.browser');
  expect(human).toContain('sentry.python');
  expect(human).toContain('kaboom');
});
