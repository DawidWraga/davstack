// Tests for the playwright-server CLI client. We don't boot a real browser
// here; we stand up a tiny Bun.serve fake that records the requests and
// returns canned responses. That covers the wire shape (path, method, body)
// and the response decoding without paying chromium boot cost.

import { test, expect, afterEach } from 'bun:test';
import type { Server } from 'bun';
import { runFile, gotoUrl, refreshAuth, health, shutdown, type ClientOpts } from '../../src/client.js';

const servers: Server[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.stop(true);
});

type Recorded = { method: string; pathname: string; body: unknown };

function fakeServer(handler: (req: Request, rec: Recorded[]) => Promise<Response> | Response): {
  base: string;
  recorded: Recorded[];
} {
  const recorded: Recorded[] = [];
  const srv = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      const text = await req.text();
      const body = text ? JSON.parse(text) : null;
      recorded.push({ method: req.method, pathname: url.pathname, body });
      return handler(new Request(req.url, { method: req.method, body: text }), recorded);
    },
  });
  servers.push(srv);
  return { base: `http://${srv.hostname}:${srv.port}`, recorded };
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function clientOpts(base: string, extra: Partial<ClientOpts> = {}): ClientOpts {
  const u = new URL(base);
  return { host: u.hostname, port: Number(u.port), ...extra };
}

test('runFile POSTs /run with file payload and returns body', async () => {
  const { base, recorded } = fakeServer(() => ok({ ok: true, file: 'foo.spec.ts', durationMs: 12 }));
  const r = await runFile('foo.spec.ts', clientOpts(base));
  expect(r.ok).toBe(true);
  expect(r.file).toBe('foo.spec.ts');
  expect(recorded).toHaveLength(1);
  expect(recorded[0].method).toBe('POST');
  expect(recorded[0].pathname).toBe('/run');
  expect(recorded[0].body).toEqual({ file: 'foo.spec.ts' });
});

test('gotoUrl POSTs /goto with url payload', async () => {
  const { base, recorded } = fakeServer(() => ok({ url: 'http://localhost:3001/x' }));
  const r = await gotoUrl('http://localhost:3001/x', clientOpts(base));
  expect(r.url).toBe('http://localhost:3001/x');
  expect(recorded[0].pathname).toBe('/goto');
  expect(recorded[0].body).toEqual({ url: 'http://localhost:3001/x' });
});

test('refreshAuth POSTs /refresh-auth with empty body', async () => {
  const { base, recorded } = fakeServer(() => ok({ ok: true, origin: 'http://localhost:3001' }));
  const r = await refreshAuth(clientOpts(base));
  expect(r.ok).toBe(true);
  expect(recorded[0].pathname).toBe('/refresh-auth');
  expect(recorded[0].method).toBe('POST');
});

test('health GETs /health', async () => {
  const { base, recorded } = fakeServer(() => ok({ ok: true, pid: 42, url: null }));
  const r = await health(clientOpts(base));
  expect(r.pid).toBe(42);
  expect(recorded[0].method).toBe('GET');
  expect(recorded[0].pathname).toBe('/health');
});

test('shutdown POSTs /shutdown and tolerates connection drop', async () => {
  const { base } = fakeServer(() => ok({ ok: true }));
  await expect(shutdown(clientOpts(base))).resolves.toEqual({ ok: true });
});

test('shutdown swallows connection-refused errors', async () => {
  // Point at a port we know is closed; shutdown is best-effort.
  const r = await shutdown({ host: '127.0.0.1', port: 1 });
  expect(r.ok).toBe(true);
});

test('runFile passes the routing db through to /run body when provided', async () => {
  const { base, recorded } = fakeServer(() => ok({ ok: true }));
  await runFile('foo.spec.ts', clientOpts(base), { db: 'reorder-bug' });
  expect(recorded[0].body).toEqual({ file: 'foo.spec.ts', db: 'reorder-bug' });
});

test('runFile omits db when not provided (no key, not null)', async () => {
  const { base, recorded } = fakeServer(() => ok({ ok: true }));
  await runFile('foo.spec.ts', clientOpts(base));
  expect(recorded[0].body).toEqual({ file: 'foo.spec.ts' });
  expect(Object.keys(recorded[0].body as object)).not.toContain('db');
});

test('runFile surfaces non-2xx response body', async () => {
  const { base } = fakeServer(
    () =>
      new Response(JSON.stringify({ ok: false, error: 'missing file' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
  );
  const r = await runFile('x.spec.ts', clientOpts(base));
  expect(r.ok).toBe(false);
  expect(r.error).toContain('missing file');
});
