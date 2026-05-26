// Tests for the daemon .env autoloader. Verifies walk-up resolution
// (cwd → parents → repo root), explicit-env override semantics, and the
// DAVSTACK_NO_DOTENV=1 opt-out.

import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findDotenv, loadDotenv } from '../src/dotenv.js';

let tmpRoot: string;
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'davstack-dotenv-'));
  originalEnv = { ...process.env };
});

afterEach(() => {
  process.env = originalEnv;
  rmSync(tmpRoot, { recursive: true, force: true });
});

test('findDotenv picks .env in the starting cwd', () => {
  const envPath = join(tmpRoot, '.env');
  writeFileSync(envPath, 'FOO=bar\n');
  const found = findDotenv(tmpRoot);
  expect(found).toBe(envPath);
});

test('findDotenv walks up to find .env in a parent dir', () => {
  const child = join(tmpRoot, 'a', 'b', 'c');
  mkdirSync(child, { recursive: true });
  // mark tmpRoot as repo root so the walk has a stop condition
  writeFileSync(join(tmpRoot, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  const envPath = join(tmpRoot, '.env');
  writeFileSync(envPath, 'FOO=bar\n');
  expect(findDotenv(child)).toBe(envPath);
});

test('findDotenv returns null when no .env exists', () => {
  writeFileSync(join(tmpRoot, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  expect(findDotenv(tmpRoot)).toBeNull();
});

test('findDotenv prefers nearest .env over an ancestor', () => {
  const child = join(tmpRoot, 'child');
  mkdirSync(child, { recursive: true });
  writeFileSync(join(tmpRoot, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  writeFileSync(join(tmpRoot, '.env'), 'FROM=root\n');
  const childEnv = join(child, '.env');
  writeFileSync(childEnv, 'FROM=child\n');
  expect(findDotenv(child)).toBe(childEnv);
});

test('loadDotenv writes parsed keys into process.env', async () => {
  delete process.env.DAVSTACK_NO_DOTENV;
  delete process.env.DAVSTACK_TEST_KEY;
  writeFileSync(join(tmpRoot, '.env'), 'DAVSTACK_TEST_KEY=hello\n');
  const result = await loadDotenv({ cwd: tmpRoot });
  expect(result).toMatchObject({ loaded: true, keys: 1 });
  expect(process.env.DAVSTACK_TEST_KEY).toBe('hello');
});

test('loadDotenv preserves existing process.env values (does not override)', async () => {
  delete process.env.DAVSTACK_NO_DOTENV;
  process.env.DAVSTACK_TEST_KEY = 'preset';
  writeFileSync(join(tmpRoot, '.env'), 'DAVSTACK_TEST_KEY=fromfile\n');
  const result = await loadDotenv({ cwd: tmpRoot });
  expect(result.loaded).toBe(true);
  expect(process.env.DAVSTACK_TEST_KEY).toBe('preset');
});

test('loadDotenv respects DAVSTACK_NO_DOTENV=1', async () => {
  process.env.DAVSTACK_NO_DOTENV = '1';
  delete process.env.DAVSTACK_TEST_KEY;
  writeFileSync(join(tmpRoot, '.env'), 'DAVSTACK_TEST_KEY=fromfile\n');
  const result = await loadDotenv({ cwd: tmpRoot });
  expect(result).toEqual({ loaded: false, reason: 'disabled' });
  expect(process.env.DAVSTACK_TEST_KEY).toBeUndefined();
});

test('loadDotenv returns not-found cleanly when no .env exists', async () => {
  delete process.env.DAVSTACK_NO_DOTENV;
  writeFileSync(join(tmpRoot, 'pnpm-workspace.yaml'), 'packages:\n  - .\n');
  const result = await loadDotenv({ cwd: tmpRoot });
  expect(result).toEqual({ loaded: false, reason: 'not-found' });
});
