// The handoff P1 acceptance gate, automated. Boots the REAL Bun server, POSTs
// a REAL-shaped Sentry log envelope over HTTP (the anti-shallow-seam
// discipline — exercise the wire, not a synthetic shortcut), with two
// `diag.project`s sharing a `trace_id`, and proves: correlated retrieval is
// exact and project-scoped even on the shared trace; the sink never 5xx's on
// garbage; prune evicts by server clock; and the `diag` CLI runs end-to-end.

import { test, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, prune } from '../src/db.ts';
import { startServer } from '../src/server.ts';
import { traceAssembly, errorContext } from '../src/query.ts';

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

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

test('end-to-end: real HTTP ingest, project-scoped on a shared trace, prune', async () => {
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
    const a = traceAssembly(db, { project: 'proj-a', trace_id: SHARED });
    expect(a.map((r) => r.msg)).toEqual(['a-info', 'a-boom']);
    const b = traceAssembly(db, { project: 'proj-b', trace_id: SHARED });
    expect(b.map((r) => r.msg)).toEqual(['b-only']);
    expect(b[0].service).toBe('sentry.javascript.browser');

    const errs = errorContext(db, { project: 'proj-a', trace_id: SHARED, context: 5 });
    expect(errs).toHaveLength(1);
    expect(errs[0].error.msg).toBe('a-boom');
    expect(errs[0].window.map((r) => r.msg)).toEqual(['a-info', 'a-boom']);

    // prune by server recv_ts: nothing old yet, then evict everything
    expect(prune(db, 60_000)).toBe(0);
    expect(prune(db, 0, Date.now() + 1)).toBe(3);
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
    const rows = traceAssembly(db, { project: 'proj-gz', trace_id: SHARED });
    expect(rows.map((r) => r.msg)).toEqual(['gzipped-line']);
  } finally {
    srv.stop();
  }
});

test('the log-server CLI runs end-to-end against a file DB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'diag-acc-'));
  tmps.push(dir);
  const dbFile = join(dir, 'diag.sqlite');
  // seed via the storage layer, then query through the CLI process
  const db = openDb(dbFile);
  db.exec(
    `INSERT INTO logs (ts,recv_ts,project,service,run_id,trace_id,span_id,level,severity_number,logger,msg,data,tag)
     VALUES (1,1,'p','sentry.python','run-9','tr','', 'error',17,'auto','cli-sees-this','{}',NULL)`,
  );
  db.close();

  const proc = Bun.spawn(
    ['bun', join(import.meta.dir, '..', 'index.ts'), 'query', 'run', '--project', 'p', '--run', 'run-9'],
    { env: { ...process.env, DIAG_DB: dbFile }, stdout: 'pipe', stderr: 'pipe' },
  );
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  expect(proc.exitCode).toBe(0);
  expect(out).toContain('cli-sees-this');
});
