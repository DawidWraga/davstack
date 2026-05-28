// Tests for the /__refresh control-plane endpoint. Bun-only because the
// server uses Bun.serve. We verify: (1) the route returns ok=true with a
// fresh timestamp, (2) the timestamp is reflected back on /__health,
// (3) onRefresh's return value is plumbed through (closedHandles,
// configReloaded), and (4) ordinary envelope POSTs to non-control paths
// still ingest as before — the control-plane prefix doesn't break
// back-compat with Sentry SDK envelope URLs.

import { test, expect, afterEach } from 'bun:test';
import { openDb } from '../../src/db.ts';
import { startServer, type RefreshResult } from '../../src/server.ts';

const stops: Array<() => void> = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});

function boot(onRefresh?: () => RefreshResult | Promise<RefreshResult>) {
  const db = openDb(':memory:');
  const srv = startServer({ db, port: 0, onRefresh });
  stops.push(srv.stop);
  return { db, srv };
}

test('GET /__health returns ok + pid + null refreshedAt before any refresh', async () => {
  const { srv } = boot();
  const res = await fetch(`http://127.0.0.1:${srv.port}/__health`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: boolean; pid: number; refreshedAt: string | null };
  expect(body.ok).toBe(true);
  expect(typeof body.pid).toBe('number');
  expect(body.refreshedAt).toBeNull();
});

test('POST /__refresh returns a fresh ISO timestamp and updates /__health', async () => {
  const { srv } = boot();
  const before = Date.now();
  const refreshRes = await fetch(`http://127.0.0.1:${srv.port}/__refresh`, { method: 'POST' });
  const after = Date.now();
  expect(refreshRes.status).toBe(200);
  const refresh = (await refreshRes.json()) as {
    ok: boolean;
    refreshedAt: string;
    closedHandles: number;
    configReloaded: boolean;
  };
  expect(refresh.ok).toBe(true);
  const ts = Date.parse(refresh.refreshedAt);
  expect(ts).toBeGreaterThanOrEqual(before);
  expect(ts).toBeLessThanOrEqual(after);
  expect(refresh.closedHandles).toBe(0);
  expect(refresh.configReloaded).toBe(false);

  const healthRes = await fetch(`http://127.0.0.1:${srv.port}/__health`);
  const health = (await healthRes.json()) as { refreshedAt: string };
  expect(health.refreshedAt).toBe(refresh.refreshedAt);
});

test('onRefresh callback result is plumbed into the response (closedHandles, configReloaded)', async () => {
  let calls = 0;
  const { srv } = boot(async () => {
    calls++;
    return { ok: true, refreshedAt: '', closedHandles: 42, configReloaded: true };
  });
  const res = await fetch(`http://127.0.0.1:${srv.port}/__refresh`, { method: 'POST' });
  const body = (await res.json()) as { closedHandles: number; configReloaded: boolean };
  expect(calls).toBe(1);
  expect(body.closedHandles).toBe(42);
  expect(body.configReloaded).toBe(true);
});

test('onRefresh that throws → 500 with error surfaced', async () => {
  const { srv } = boot(() => {
    throw new Error('boom');
  });
  const res = await fetch(`http://127.0.0.1:${srv.port}/__refresh`, { method: 'POST' });
  expect(res.status).toBe(500);
  const body = (await res.json()) as { ok: boolean; error?: string };
  expect(body.ok).toBe(false);
  expect(body.error).toContain('boom');
});

test('POST to a non-control path is still ingested as an envelope (back-compat)', async () => {
  // The `/__` prefix is deliberately chosen so it can't collide with the
  // Sentry SDK envelope URLs (`/api/<id>/envelope/`) or the JS tunnel's
  // arbitrary relative paths. Make sure adding /__refresh didn't shadow
  // the envelope sink.
  const { srv } = boot();
  const res = await fetch(`http://127.0.0.1:${srv.port}/api/1/envelope/`, {
    method: 'POST',
    body: '', // empty bodies are silently dropped — we only check we get 200
  });
  expect(res.status).toBe(200);
});
