// Tests for the consumer-facing config loader and storage-state helpers.
// The auth-refresh callable itself is consumer-provided (so it lives outside
// the skill and is not tested here); we test the seams it plugs into.

import { test, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  loadConfig,
  readAuthSeed,
  writeStorageState,
  type StorageState,
} from '../src/auth.ts';

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});

function tmp(prefix = 'pw-srv-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmps.push(d);
  return d;
}

test('loadConfig returns defaults when no config file exists', async () => {
  const cwd = tmp();
  const cfg = await loadConfig(cwd);
  expect(cfg).toEqual({ ...DEFAULT_CONFIG });
});

test('loadConfig merges user config with defaults', async () => {
  const cwd = tmp();
  writeFileSync(
    join(cwd, 'playwright-server.config.ts'),
    `export default { baseUrl: 'http://localhost:9999', storageStatePath: 'foo/bar.json' }`,
  );
  const cfg = await loadConfig(cwd);
  expect(cfg.baseUrl).toBe('http://localhost:9999');
  expect(cfg.storageStatePath).toBe('foo/bar.json');
  // Untouched default still present
  expect(cfg.profilePath).toBe(DEFAULT_CONFIG.profilePath);
});

test('loadConfig surfaces refreshAuth when consumer provides it', async () => {
  const cwd = tmp();
  writeFileSync(
    join(cwd, 'playwright-server.config.ts'),
    `export default {
       refreshAuth: async () => ({ cookies: [], origins: [{ origin: 'http://x', localStorage: [{ name: 't', value: '1' }] }] })
     }`,
  );
  const cfg = await loadConfig(cwd);
  expect(typeof cfg.refreshAuth).toBe('function');
  const state = await cfg.refreshAuth!();
  expect(state?.origins[0].localStorage[0]).toEqual({ name: 't', value: '1' });
});

test('loadConfig throws on malformed config file', async () => {
  const cwd = tmp();
  writeFileSync(join(cwd, 'playwright-server.config.ts'), `this is not valid typescript {`);
  await expect(loadConfig(cwd)).rejects.toThrow(/failed to load/);
});

test('readAuthSeed returns null when file does not exist', () => {
  expect(readAuthSeed(join(tmp(), 'missing.json'))).toBeNull();
});

test('readAuthSeed returns null on malformed JSON', () => {
  const dir = tmp();
  const p = join(dir, 'broken.json');
  writeFileSync(p, '{not json');
  expect(readAuthSeed(p)).toBeNull();
});

test('readAuthSeed returns null when origins[] is empty', () => {
  const dir = tmp();
  const p = join(dir, 'empty.json');
  writeFileSync(p, JSON.stringify({ cookies: [], origins: [] }));
  expect(readAuthSeed(p)).toBeNull();
});

test('readAuthSeed parses the first origins entry', () => {
  const dir = tmp();
  const p = join(dir, 'state.json');
  const state: StorageState = {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:3001',
        localStorage: [
          { name: 'token', value: 'abc' },
          { name: 'userId', value: 'u-1' },
        ],
      },
    ],
  };
  writeFileSync(p, JSON.stringify(state));
  const seed = readAuthSeed(p);
  expect(seed?.origin).toBe('http://localhost:3001');
  expect(seed?.entries).toEqual([
    { name: 'token', value: 'abc' },
    { name: 'userId', value: 'u-1' },
  ]);
});

test('writeStorageState creates parent dirs and writes valid JSON', () => {
  const dir = tmp();
  const p = join(dir, 'nested', 'deeply', 'state.json');
  const state: StorageState = {
    cookies: [],
    origins: [
      {
        origin: 'http://x',
        localStorage: [{ name: 'k', value: 'v' }],
      },
    ],
  };
  writeStorageState(p, state);
  expect(existsSync(p)).toBe(true);
  const parsed = JSON.parse(readFileSync(p, 'utf8'));
  expect(parsed).toEqual(state);
});
