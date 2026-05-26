// Smoke test for the `check` verb. Runs under vitest/node (workspace
// excludes bun-only/**), so `bun:sqlite` is unavailable — we exercise the
// fallback path that reports "exists but uncountable" / "not yet created"
// without crashing.

import { test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCheck } from '../src/check.ts';

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
