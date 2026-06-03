// `view` renderer + pure helpers. Asserts the nesting, runtime labelling, and
// root-span vitals header that the trace viewer depends on, plus db-path
// resolution. Pure functions are tested directly; renderers run against an
// in-memory db seeded via the real insert path.

import { test, expect } from 'bun:test';
import { join } from 'node:path';
import { openDb, insertLogs, type LogRow } from '../../src/db.js';
import {
  runtimeOf,
  bareRuntime,
  parentOf,
  vitalsLine,
  buildTree,
  summarise,
  renderTrace,
  renderList,
  renderCross,
  resolveDbPath,
  type ViewRow,
} from '../../src/view.js';

const T = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function logRow(over: Partial<LogRow>): LogRow {
  return {
    ts: 1_700_000_000.0,
    recv_ts: 1_700_000_000_000,
    kind: 'log',
    project: 'proj',
    service: 'sentry.javascript.nextjs',
    run_id: 'run-1',
    trace_id: T,
    span_id: 'bbbbbbbbbbbbbbbb',
    level: 'info',
    severity_number: 9,
    logger: 'auto',
    msg: 'hello',
    data: '{}',
    attrs: null,
    tag: null,
    duration_ms: null,
    runtime: null,
    ...over,
  };
}

function viewRow(over: Partial<ViewRow>): ViewRow {
  return { kind: 'span', msg: '', attrs: null, data: null, duration_ms: null, ts: 1000, span_id: null, id: 1, ...over };
}

//* MARK: runtimeOf
test('runtimeOf trusts a stamped runtime over any heuristic', () => {
  expect(runtimeOf({ runtime: 'edge', op: 'http.server' })).toBe('edge');
});

test('runtimeOf falls back to a heuristic with a trailing ?', () => {
  expect(runtimeOf({ op: 'http.server' })).toBe('node?');
  expect(runtimeOf({ op: 'pageload' })).toBe('browser?');
  expect(runtimeOf({})).toBe('?');
  expect(bareRuntime({ op: 'http.server' })).toBe('node');
  expect(bareRuntime({})).toBe('unknown');
});

//* MARK: parentOf
test('parentOf reads parent_span_id from data, then attrs', () => {
  expect(parentOf({ data: JSON.stringify({ parent_span_id: 'p1' }), attrs: null })).toBe('p1');
  expect(parentOf({ data: null, attrs: JSON.stringify({ 'sentry.parent_span_id': 'p2' }) })).toBe('p2');
  expect(parentOf({ data: 'not json', attrs: null })).toBe('');
});

//* MARK: vitalsLine
test('vitalsLine formats web vitals (ms rounded, CLS unitless) + request', () => {
  const line = vitalsLine({ 'measurement.lcp': 1234.6, 'measurement.cls': 0.04, 'request.method': 'GET', 'request.url': '/' });
  expect(line).toContain('LCP 1235ms');
  expect(line).toContain('CLS 0.04');
  expect(line).toContain('req: GET /');
});

test('vitalsLine returns empty string when nothing present', () => {
  expect(vitalsLine({})).toBe('');
});

//* MARK: buildTree
test('buildTree nests children under parents and logs under their span', () => {
  const rows: ViewRow[] = [
    viewRow({ kind: 'span', span_id: 'root', msg: 'root', ts: 1, id: 1 }),
    viewRow({ kind: 'span', span_id: 'child', data: JSON.stringify({ parent_span_id: 'root' }), msg: 'child', ts: 2, id: 2 }),
    viewRow({ kind: 'log', span_id: 'child', msg: 'log-under-child', ts: 3, id: 3 }),
  ];
  const flat = buildTree(rows);
  const byMsg = Object.fromEntries(flat.map((x) => [x.r.msg, x.depth]));
  expect(byMsg['root']).toBe(0);
  expect(byMsg['child']).toBe(1);
  expect(byMsg['log-under-child']).toBe(2);
});

test('buildTree floats logs/spans with unresolvable parents at root', () => {
  const rows: ViewRow[] = [
    viewRow({ kind: 'span', span_id: 'a', data: JSON.stringify({ parent_span_id: 'missing' }), msg: 'a', id: 1 }),
    viewRow({ kind: 'log', span_id: 'nope', msg: 'orphan-log', id: 2 }),
  ];
  const flat = buildTree(rows);
  expect(flat.every((x) => x.depth === 0)).toBe(true);
  expect(flat.map((x) => x.r.msg).sort()).toEqual(['a', 'orphan-log']);
});

test('buildTree does not loop on a parent cycle', () => {
  const rows: ViewRow[] = [
    viewRow({ kind: 'span', span_id: 'x', data: JSON.stringify({ parent_span_id: 'y' }), msg: 'x', id: 1 }),
    viewRow({ kind: 'span', span_id: 'y', data: JSON.stringify({ parent_span_id: 'x' }), msg: 'y', id: 2 }),
  ];
  const flat = buildTree(rows);
  expect(flat.length).toBe(2); // each visited once, no infinite recursion
});

//* MARK: summarise
test('summarise counts spans and collects distinct runtimes', () => {
  const s = summarise([
    { kind: 'span', attrs: JSON.stringify({ runtime: 'node' }) },
    { kind: 'span', attrs: JSON.stringify({ runtime: 'browser' }) },
    { kind: 'log', attrs: JSON.stringify({ runtime: 'browser' }) },
  ]);
  expect(s.spans).toBe(2);
  expect(s.rows).toBe(3);
  expect(s.runtimes).toEqual(['browser', 'node']);
});

//* MARK: renderTrace (against a real db)
function seedTrace(db: ReturnType<typeof openDb>) {
  insertLogs(db, [
    logRow({
      kind: 'span',
      span_id: 'root0000',
      msg: 'GET /',
      duration_ms: 100,
      ts: 1000,
      runtime: 'node',
      attrs: JSON.stringify({ op: 'http.server', runtime: 'node', 'measurement.lcp': 1234.5, 'request.method': 'GET', 'request.url': '/' }),
    }),
    logRow({
      kind: 'span',
      span_id: 'child000',
      msg: 'getRaceResults',
      duration_ms: 50,
      ts: 1000.01,
      runtime: 'node',
      data: JSON.stringify({ parent_span_id: 'root0000' }),
      attrs: JSON.stringify({ op: 'server-fn', runtime: 'node' }),
    }),
    logRow({ kind: 'log', span_id: 'child000', msg: 'hello:db', ts: 1000.02, runtime: 'node', attrs: JSON.stringify({ runtime: 'node' }) }),
  ]);
}

test('renderTrace nests children/logs and prints a vitals header from the root', () => {
  const db = openDb(':memory:');
  seedTrace(db);
  const md = renderTrace(db, T, 'default');
  expect(md).toContain('vitals: LCP 1235ms');
  expect(md).toContain('req: GET /');
  expect(md).toContain('└─'); // genuine nesting rendered
  expect(md).toContain('getRaceResults');
  expect(md).toContain('hello:db');
  expect(md).toContain('node'); // runtime column
});

test('renderTrace surfaces vitals from a browser pageload nested under the server root', () => {
  // Propagation re-parents the browser pageload (which carries measurement.*)
  // under the node http.server root — so vitals are NOT on the trace root.
  const db = openDb(':memory:');
  insertLogs(db, [
    logRow({ kind: 'span', span_id: 'srv00000', msg: 'GET /', duration_ms: 800, ts: 1000, runtime: 'node', attrs: JSON.stringify({ op: 'http.server', runtime: 'node' }) }),
    logRow({
      kind: 'span',
      span_id: 'pageload0',
      msg: '/',
      duration_ms: 1283,
      ts: 1000.01,
      runtime: 'browser',
      data: JSON.stringify({ parent_span_id: 'srv00000' }),
      attrs: JSON.stringify({ op: 'pageload', runtime: 'browser', 'measurement.lcp': 624, 'measurement.cls': 0.0001 }),
    }),
  ]);
  const md = renderTrace(db, T, 'default');
  expect(md).toContain('LCP 624ms');
  expect(md).toContain('CLS 0.0001');
});

test('renderTrace reports an empty db cleanly', () => {
  const db = openDb(':memory:');
  expect(renderTrace(db, T, 'default')).toContain('no rows in db');
});

//* MARK: renderList / renderCross
test('renderList summarises recent traces', () => {
  const db = openDb(':memory:');
  seedTrace(db);
  const md = renderList(db, 20, 'default');
  expect(md).toContain('most-recent traces');
  expect(md).toContain(T);
});

test('renderCross flags when no trace spans >1 runtime', () => {
  const db = openDb(':memory:');
  seedTrace(db); // single-runtime (node) trace
  expect(renderCross(db, 200, 'default')).toContain('NOT working yet');
});

test('renderCross detects a browser↔node stitched trace', () => {
  const db = openDb(':memory:');
  insertLogs(db, [
    logRow({ kind: 'span', span_id: 's1', msg: 'pageload', ts: 1, runtime: 'browser', attrs: JSON.stringify({ runtime: 'browser' }) }),
    logRow({ kind: 'span', span_id: 's2', msg: 'GET /', ts: 2, runtime: 'node', attrs: JSON.stringify({ runtime: 'node' }) }),
  ]);
  const md = renderCross(db, 200, 'default');
  expect(md).toContain('stitch browser ↔ node');
});

//* MARK: resolveDbPath
test('resolveDbPath maps a bare name to .davstack/logs/<name>.db', () => {
  const r = resolveDbPath({ db: 'session2', cwd: '/repo' });
  expect(r.name).toBe('session2');
  expect(r.path).toBe(join('/repo', '.davstack', 'logs', 'session2.db'));
});

test('resolveDbPath defaults to the repo default db', () => {
  const r = resolveDbPath({ cwd: '/repo' });
  expect(r.name).toBe('default');
  expect(r.path).toBe(join('/repo', '.davstack', 'logs', 'default.db'));
});

test('resolveDbPath passes a path-like value straight through', () => {
  const r = resolveDbPath({ db: 'tmp/custom.db', cwd: '/repo' });
  expect(r.name).toBe('custom');
  // `resolve` may prepend a drive on Windows; assert the tail, not the root.
  expect(r.path.endsWith(join('repo', 'tmp', 'custom.db'))).toBe(true);
});
