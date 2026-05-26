// CORS preflight + response-header contract for browser-origin envelope
// POSTs. Sentry's `Content-Type: application/x-sentry-envelope` is non-simple,
// so the browser sends an OPTIONS preflight first — the sink must echo
// Access-Control-Allow-* or the actual POST is blocked.

import { test, expect, afterEach } from 'bun:test';
import { openDb } from '../../src/db.ts';
import { startServer } from '../../src/server.ts';
import { filterLogs } from '../../src/query.ts';
import type { ServerConfig } from '../../src/config.ts';

const stops: Array<() => void> = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});

function boot(cors?: ServerConfig['cors']) {
  const db = openDb(':memory:');
  const srv = startServer({ db, port: 0, cors });
  stops.push(srv.stop);
  return { db, srv };
}

function preflight(port: number, origin: string) {
  return fetch(`http://127.0.0.1:${port}/api/1/envelope/`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,sentry-trace,baggage',
    },
  });
}

test('default policy: preflight echoes Access-Control-Allow-Origin: *', async () => {
  const { srv } = boot();
  const res = await preflight(srv.port, 'http://localhost:3001');
  expect(res.status).toBe(204);
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
  const allowHeaders = res.headers.get('access-control-allow-headers') ?? '';
  expect(allowHeaders).toContain('content-type');
  expect(allowHeaders).toContain('sentry-trace');
  expect(allowHeaders).toContain('baggage');
});

test('allowlist policy: matching Origin is echoed back with Vary: Origin', async () => {
  const { srv } = boot(['http://localhost:3001']);
  const res = await preflight(srv.port, 'http://localhost:3001');
  expect(res.status).toBe(204);
  expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
  expect(res.headers.get('vary')).toBe('Origin');
});

test('allowlist policy: non-matching Origin → no CORS headers (browser blocks)', async () => {
  const { srv } = boot(['http://localhost:3001']);
  const res = await preflight(srv.port, 'http://evil.example');
  expect(res.status).toBe(204);
  expect(res.headers.get('access-control-allow-origin')).toBeNull();
  expect(res.headers.get('access-control-allow-methods')).toBeNull();
});

test('cors: false → no CORS headers regardless of origin', async () => {
  const { srv } = boot(false);
  const res = await preflight(srv.port, 'http://localhost:3001');
  expect(res.headers.get('access-control-allow-origin')).toBeNull();
  expect(res.headers.get('access-control-allow-methods')).toBeNull();
});

test('default policy: actual POST writes row AND carries Access-Control-Allow-Origin: *', async () => {
  const { db, srv } = boot();
  const envelope = [
    JSON.stringify({ sdk: { name: 'sentry.javascript.browser', version: '9.41.0' } }),
    JSON.stringify({
      type: 'log',
      item_count: 1,
      content_type: 'application/vnd.sentry.items.log+json',
    }),
    JSON.stringify({
      items: [
        {
          timestamp: 1_700_000_000.0,
          trace_id: 'a'.repeat(32),
          level: 'info',
          body: 'cors-post-test',
          attributes: { 'diag.project': { value: 'cors-test', type: 'string' } },
        },
      ],
    }),
  ].join('\n');
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/1/envelope/`, {
    method: 'POST',
    headers: { Origin: 'http://localhost:3001', 'content-type': 'application/x-sentry-envelope' },
    body: envelope,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  const rows = filterLogs(db, { project: 'cors-test' });
  expect(rows.map((r) => r.msg)).toEqual(['cors-post-test']);
});
