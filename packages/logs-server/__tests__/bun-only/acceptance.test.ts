// The handoff P1 acceptance gate, automated. Boots the REAL Bun server, POSTs
// a REAL-shaped Sentry log envelope over HTTP (the anti-shallow-seam
// discipline — exercise the wire, not a synthetic shortcut), with two
// `diag.project`s sharing a `trace_id`, and proves: correlated retrieval is
// exact and project-scoped even on the shared trace, and the sink never 5xx's
// on garbage.

import { test, expect } from 'bun:test';
import { openDb, selectByTrace, type LogRow } from '../src/db.js';
import { startServer } from '../src/server.js';

// Local error-context helper — replaces removed src/query.ts. Centers a ±N
// window on each error row and clamps at edges, scoped via selectByTrace.
function errorContext(
  db: ReturnType<typeof openDb>,
  o: { project: string; trace_id: string; context?: number },
): { error: LogRow; window: LogRow[] }[] {
  const ctx = o.context ?? 3;
  const rows = selectByTrace(db, o.project, o.trace_id);
  const out: { error: LogRow; window: LogRow[] }[] = [];
  rows.forEach((r, i) => {
    if (r.level === 'error' || r.level === 'fatal') {
      out.push({
        error: r,
        window: rows.slice(Math.max(0, i - ctx), Math.min(rows.length, i + ctx + 1)),
      });
    }
  });
  return out;
}

const SHARED = '0123456789abcdef0123456789abcdef';

function envelope(project: string, items: Record<string, unknown>[], sdk = 'sentry.python') {
  return [
    JSON.stringify({ sdk: { name: sdk, version: '2.43.0' } }),
    JSON.stringify({
      type: 'log',
      item_count: items.length,
      content_type: 'application/vnd.sentry.items.log+json',
    }),
    JSON.stringify({
      items: items.map((o) => ({
        timestamp: 1_700_000_000.0,
        trace_id: SHARED,
        level: 'info',
        body: 'x',
        attributes: { 'diag.project': { value: project, type: 'string' } },
        ...o,
      })),
    }),
  ].join('\n');
}

test('end-to-end: real HTTP ingest, project-scoped on a shared trace', async () => {
  const db = openDb(':memory:');
  const srv = startServer({ db, port: 0 });
  try {
    const post = (body: string) =>
      fetch(`http://127.0.0.1:${srv.port}/api/42/envelope/`, { method: 'POST', body });

    // proj-a: a normal log + an error; proj-b: one log. Same trace_id.
    const r1 = await post(
      envelope('proj-a', [{ body: 'a-info' }, { body: 'a-boom', level: 'error' }]),
    );
    const r2 = await post(envelope('proj-b', [{ body: 'b-only' }], 'sentry.javascript.browser'));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // garbage must NOT 5xx (would induce SDK retry storms / block the app)
    const rg = await post('this is not an envelope');
    expect(rg.status).toBe(200);

    // correlated slice is exact and project-scoped despite the shared trace
    const a = selectByTrace(db, 'proj-a', SHARED);
    expect(a.map((r) => r.msg)).toEqual(['a-info', 'a-boom']);
    const b = selectByTrace(db, 'proj-b', SHARED);
    expect(b.map((r) => r.msg)).toEqual(['b-only']);
    expect(b[0].service).toBe('sentry.javascript.browser');

    const errs = errorContext(db, { project: 'proj-a', trace_id: SHARED, context: 5 });
    expect(errs).toHaveLength(1);
    expect(errs[0].error.msg).toBe('a-boom');
    expect(errs[0].window.map((r) => r.msg)).toEqual(['a-info', 'a-boom']);
  } finally {
    srv.stop();
  }
});

test('end-to-end: gzipped envelope with Content-Encoding (the real Python-SDK path)', async () => {
  // The Python SDK gzips the body by default. Before the decode fix this
  // produced zero rows with no error — a silent failure indistinguishable
  // from "diag is broken". This proves the wire path, not just the unit.
  const db = openDb(':memory:');
  const srv = startServer({ db, port: 0 });
  try {
    const raw = envelope('proj-gz', [{ body: 'gzipped-line' }]);
    const gz = Bun.gzipSync(new TextEncoder().encode(raw));
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/42/envelope/`, {
      method: 'POST',
      headers: { 'content-encoding': 'gzip' },
      body: gz,
    });
    expect(res.status).toBe(200);
    const rows = selectByTrace(db, 'proj-gz', SHARED);
    expect(rows.map((r) => r.msg)).toEqual(['gzipped-line']);
  } finally {
    srv.stop();
  }
});

