// Wire-shape tests for the vitest-server CLI client. We stand up a tiny
// fake HTTP server and assert path/method/body. Cold-start cheap — no
// real vitest boot here.

import { test, expect, afterEach } from 'bun:test';
import type { Server } from 'bun';
import { runFile, health, shutdown, type ClientOpts } from '../src/client.js';

const servers: Server[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.stop(true);
});

type Recorded = { method: string; pathname: string; body: unknown };

function fakeServer(handler: () => Response): { base: string; recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const srv = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      const url = new URL(req.url);
      const text = await req.text();
      const body = text ? JSON.parse(text) : null;
      recorded.push({ method: req.method, pathname: url.pathname, body });
      return handler();
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

function opts(base: string): ClientOpts {
  const u = new URL(base);
  return { host: u.hostname, port: Number(u.port) };
}

test('runFile POSTs /run with file payload', async () => {
  const { base, recorded } = fakeServer(() =>
    ok({ ok: true, file: 'foo.stories.tsx', summary: { total: 1, passed: 1, failed: 0, skipped: 0 } }),
  );
  const r = await runFile('foo.stories.tsx', opts(base));
  expect(r.ok).toBe(true);
  expect(recorded[0].method).toBe('POST');
  expect(recorded[0].pathname).toBe('/run');
  expect(recorded[0].body).toEqual({ file: 'foo.stories.tsx' });
});

test('runFile forwards testNamePattern when provided', async () => {
  const { base, recorded } = fakeServer(() => ok({ ok: true }));
  await runFile('foo.stories.tsx', opts(base), { testNamePattern: 'play > clicks' });
  expect(recorded[0].body).toEqual({ file: 'foo.stories.tsx', testNamePattern: 'play > clicks' });
});

test('health GETs /health', async () => {
  const { base, recorded } = fakeServer(() => ok({ ok: true, pid: 42 }));
  const r = await health(opts(base));
  expect(r.pid).toBe(42);
  expect(recorded[0].method).toBe('GET');
  expect(recorded[0].pathname).toBe('/health');
});

test('shutdown swallows connection-refused', async () => {
  const r = await shutdown({ host: '127.0.0.1', port: 1 });
  expect(r.ok).toBe(true);
});
