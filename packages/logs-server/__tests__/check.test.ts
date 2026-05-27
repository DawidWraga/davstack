// Smoke test for the `check` verb. Runs under vitest/node (workspace
// excludes bun-only/**), so `bun:sqlite` is unavailable — we exercise the
// fallback path that reports "exists but uncountable" / "not yet created"
// without crashing.

import { test, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockSqlite = vi.hoisted(() => ({ total: 0, recent: 0 }));

vi.mock(
  'bun:sqlite',
  () => ({
    Database: class {
      constructor(_path: string, _opts?: { readonly?: boolean }) {}
      query(sql: string) {
        return {
          get: () => {
            if (sql.includes('recv_ts')) return { c: mockSqlite.recent };
            return { c: mockSqlite.total };
          },
        };
      }
      close() {}
    },
  }),
  { virtual: true },
);

import { runCheck, rowGlyph, suppressStaleRowsFix } from '../src/check.ts';

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'logs-srv-check-'));
  tmps.push(d);
  return d;
}

function captureStdout(): { restore: () => string } {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown as (s: string) => boolean) = ((s: string | Uint8Array) => {
    chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'));
    return true;
  }) as unknown as typeof process.stdout.write;
  return {
    restore: () => {
      process.stdout.write = orig;
      return chunks.join('');
    },
  };
}

test('runCheck returns 0 with no config + no db file', async () => {
  const cwd = tmp();
  const cap = captureStdout();
  const code = await runCheck({
    cwd,
    json: true,
    host: '127.0.0.1',
    port: 65535, // unlikely to be listening
    db: join(cwd, 'missing.sqlite'),
  });
  const out = cap.restore();
  expect(code).toBe(0);
  const result = JSON.parse(out);
  expect(result.ok).toBe(true);
  expect(result.node.ok).toBe(true);
  expect(result.daemon.running).toBe(false);
  expect(result.db.exists).toBe(false);
  expect(result.db.fix).toMatch(/db file not created yet/);
});

test('runCheck reports daemon-not-running when port is closed', async () => {
  const cwd = tmp();
  const cap = captureStdout();
  const code = await runCheck({
    cwd,
    json: true,
    host: '127.0.0.1',
    port: 1, // closed
    db: join(cwd, 'missing.sqlite'),
  });
  const out = cap.restore();
  expect(code).toBe(0);
  const result = JSON.parse(out);
  expect(result.daemon.running).toBe(false);
  expect(result.daemon.fix).toMatch(/logs-server serve/);
});

test('runCheck surfaces resolved config path when one exists', async () => {
  const cwd = tmp();
  // Place a config in the canonical .davstack/config/ location.
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(cwd, '.davstack', 'config'), { recursive: true });
  writeFileSync(
    join(cwd, '.davstack', 'config', 'logs-server.config.ts'),
    `export default { port: 5181, host: '127.0.0.1', dbPath: '.davstack/logs.db' }`,
  );
  // Force the resolver to treat cwd as the repo root (no git, no workspace
  // marker; package.json without `workspaces` makes findRepoRoot fall back
  // to the cwd itself).
  writeFileSync(join(cwd, 'package.json'), `{"name":"tmp"}`);

  const cap = captureStdout();
  const code = await runCheck({
    cwd,
    json: true,
    host: '127.0.0.1',
    port: 65535,
    db: join(cwd, 'missing.sqlite'),
  });
  const out = cap.restore();
  expect(code).toBe(0);
  const result = JSON.parse(out);
  expect(result.config.source).toContain('logs-server.config.ts');
});

test('runCheck human output contains the four section labels', async () => {
  const cwd = tmp();
  const cap = captureStdout();
  await runCheck({
    cwd,
    host: '127.0.0.1',
    port: 65535,
    db: join(cwd, 'missing.sqlite'),
  });
  const out = cap.restore();
  expect(out).toMatch(/Node/);
  expect(out).toMatch(/Config/);
  expect(out).toMatch(/DB/);
  expect(out).toMatch(/Daemon/);
});

test('rowGlyph: pass row uses ✓', () => {
  expect(rowGlyph({ ok: true })).toBe('✓');
});

test('rowGlyph: advisory row uses ASCII tilde', () => {
  const g = rowGlyph({ ok: true, fix: 'hint' });
  expect(g).toContain('~');
  expect(g).not.toContain('∼');
});

test('rowGlyph: hard-fail row uses ✗', () => {
  expect(rowGlyph({ ok: false })).toBe('✗');
});

test('runCheck human output uses ~ for advisory daemon row', async () => {
  const cwd = tmp();
  const cap = captureStdout();
  await runCheck({
    cwd,
    host: '127.0.0.1',
    port: 1,
    db: join(cwd, 'missing.sqlite'),
  });
  const out = stripAnsi(cap.restore());
  expect(out).toMatch(/~ Daemon/);
  expect(out).not.toMatch(/✓ Daemon/);
});

test('runCheck human output uses ✓ for pass config row', async () => {
  const cwd = tmp();
  const cap = captureStdout();
  await runCheck({
    cwd,
    host: '127.0.0.1',
    port: 65535,
    db: join(cwd, 'missing.sqlite'),
  });
  const out = stripAnsi(cap.restore());
  expect(out).toMatch(/✓ Config/);
});

test('runCheck human output uses ✗ for hard-fail node row', async () => {
  const cwd = tmp();
  const orig = process.versions.node;
  Object.defineProperty(process.versions, 'node', { value: '18.0.0', configurable: true });
  const cap = captureStdout();
  const code = await runCheck({
    cwd,
    host: '127.0.0.1',
    port: 65535,
    db: join(cwd, 'missing.sqlite'),
  });
  const out = stripAnsi(cap.restore());
  Object.defineProperty(process.versions, 'node', { value: orig, configurable: true });
  expect(code).toBe(1);
  expect(out).toMatch(/✗ Node/);
});

test('suppressStaleRowsFix drops hint when daemon up and lifetime rows > 0', () => {
  const db = {
    ok: true,
    path: '/tmp/x.sqlite',
    exists: true,
    totalRows: 3,
    recentRows: 0,
    recentWindowMs: 300_000,
    fix: 'no rows in last 300s — verify transmitter DSN points at the daemon',
  };
  const daemon = { ok: true, running: true, url: 'http://127.0.0.1:7077' };
  suppressStaleRowsFix(db, daemon);
  expect(db.fix).toBeUndefined();
});

test('suppressStaleRowsFix keeps hint when db has zero lifetime rows', () => {
  const db = {
    ok: true,
    path: '/tmp/x.sqlite',
    exists: true,
    totalRows: 0,
    recentRows: 0,
    recentWindowMs: 300_000,
    fix: 'no rows in last 300s — verify transmitter DSN points at the daemon',
  };
  const daemon = { ok: true, running: true, url: 'http://127.0.0.1:7077' };
  suppressStaleRowsFix(db, daemon);
  expect(db.fix).toMatch(/no rows in last/);
});

test('runCheck flags a legacy .davstack/logs.db file with mv hint', async () => {
  const cwd = tmp();
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(cwd, '.davstack'), { recursive: true });
  writeFileSync(join(cwd, '.davstack', 'logs.db'), '');
  // Make findRepoRoot stop here.
  writeFileSync(join(cwd, 'package.json'), `{"name":"tmp"}`);

  const cap = captureStdout();
  const code = await runCheck({
    cwd,
    json: true,
    host: '127.0.0.1',
    port: 65535,
    db: join(cwd, 'missing.sqlite'),
  });
  const out = cap.restore();
  expect(code).toBe(0);
  const result = JSON.parse(out);
  expect(result.legacy.present).toBe(true);
  expect(result.legacy.fix).toMatch(/mv /);
  expect(result.legacy.fix).toMatch(/default\.db/);
});

test('runCheck does NOT add the legacy row when no logs.db exists', async () => {
  const cwd = tmp();
  writeFileSync(join(cwd, 'package.json'), `{"name":"tmp"}`);
  const cap = captureStdout();
  await runCheck({
    cwd,
    host: '127.0.0.1',
    port: 65535,
    db: join(cwd, 'missing.sqlite'),
  });
  const out = stripAnsi(cap.restore());
  expect(out).not.toMatch(/Legacy DB/);
});

test('suppressStaleRowsFix drops stale hint when daemon is down', () => {
  const db = {
    ok: true,
    path: '/tmp/x.sqlite',
    exists: true,
    totalRows: 0,
    recentRows: 0,
    recentWindowMs: 300_000,
    fix: 'no rows in last 300s — verify transmitter DSN points at the daemon',
  };
  const daemon = {
    ok: true,
    running: false,
    url: 'http://127.0.0.1:7077',
    fix: 'not running — start with `logs-server serve`',
  };
  suppressStaleRowsFix(db, daemon);
  expect(db.fix).toBeUndefined();
});

test('runCheck suppresses stale-rows fix when daemon up and lifetime rows > 0', async () => {
  const cwd = tmp();
  const dbFile = join(cwd, 'logs.sqlite');
  writeFileSync(dbFile, '');
  mockSqlite.total = 12;
  mockSqlite.recent = 0;
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  const cap = captureStdout();
  const code = await runCheck({
    cwd,
    json: true,
    host: '127.0.0.1',
    port: 7077,
    db: dbFile,
  });
  const out = cap.restore();
  vi.unstubAllGlobals();
  expect(code).toBe(0);
  const result = JSON.parse(out);
  expect(result.daemon.running).toBe(true);
  expect(result.db.totalRows).toBe(12);
  expect(result.db.fix).toBeUndefined();
});

test('runCheck emits stale-rows fix when db has zero rows total', async () => {
  const cwd = tmp();
  const dbFile = join(cwd, 'logs.sqlite');
  writeFileSync(dbFile, '');
  mockSqlite.total = 0;
  mockSqlite.recent = 0;
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  const cap = captureStdout();
  const code = await runCheck({
    cwd,
    json: true,
    host: '127.0.0.1',
    port: 7077,
    db: dbFile,
  });
  const out = cap.restore();
  vi.unstubAllGlobals();
  expect(code).toBe(0);
  const result = JSON.parse(out);
  expect(result.db.fix).toMatch(/no rows in last 300s/);
});
