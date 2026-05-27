// Validation pipeline for the `davstack-logs.db` routing attribute.
// Pure logic — no bun:sqlite, no filesystem writes — kept in vitest so it
// runs on the same wire as the rest of the node-side suite.

import { test, expect, beforeEach, vi } from 'vitest';
import { resolve } from 'node:path';
import { resolveRoutedDb, _resetWarnOnceForTests } from '../src/db-route.js';

const REPO = process.platform === 'win32' ? 'C:\\proj' : '/proj';
const join = (...p: string[]) => resolve(REPO, ...p);

beforeEach(() => {
  _resetWarnOnceForTests();
});

const VALID: Array<[string, string]> = [
  ['reorder-bug', join('.davstack', 'logs', 'reorder-bug.db')],
  ['feat/reorder', join('.davstack', 'logs', 'feat', 'reorder.db')],
  ['reorder-bug.db', join('.davstack', 'logs', 'reorder-bug.db')],
  ['../sandbox/x', join('.davstack', 'sandbox', 'x.db')],
  ['../../my-evals/run-1/logs', join('my-evals', 'run-1', 'logs.db')],
  ['x_y_z', join('.davstack', 'logs', 'x_y_z.db')],
];

for (const [input, expected] of VALID) {
  test(`accepts ${JSON.stringify(input)} → ${expected}`, () => {
    const r = resolveRoutedDb(input, REPO);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.path).toBe(expected);
  });
}

const INVALID: Array<[string, string]> = [
  ['../../../escaped', 'escapes repo'],
  ['/etc/passwd', 'absolute'],
  ['C:\\evil', 'absolute'],
  ['Reorder-Bug', 'charset'],
  ['reorder bug', 'charset'],
  ['', 'empty'],
  ['-leading-hyphen', 'charset'],
  ['_leading-underscore', 'charset'],
  ['a//b', 'charset'],
  ['a/.hidden/b', 'charset'],
];

for (const [input, reasonHint] of INVALID) {
  test(`rejects ${JSON.stringify(input)} (${reasonHint})`, () => {
    const r = resolveRoutedDb(input, REPO);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.toLowerCase()).toContain(reasonHint);
  });
}

test('".db" suffix idempotent', () => {
  const a = resolveRoutedDb('foo', REPO);
  const b = resolveRoutedDb('foo.db', REPO);
  expect(a.ok && b.ok && a.path === b.path).toBe(true);
});

test('per-segment validation — `..` and `.` allowed as traversal tokens', () => {
  expect(resolveRoutedDb('../sandbox/x', REPO).ok).toBe(true);
  expect(resolveRoutedDb('./x', REPO).ok).toBe(true);
});

test('warns-once per unique invalid value', () => {
  const warn = vi.fn();
  resolveRoutedDb('Bad', REPO, { warn });
  resolveRoutedDb('Bad', REPO, { warn });
  resolveRoutedDb('Bad', REPO, { warn });
  expect(warn).toHaveBeenCalledTimes(1);
  resolveRoutedDb('Other-Bad', REPO, { warn });
  expect(warn).toHaveBeenCalledTimes(2);
});

test('warn message includes the value and a reason hint', () => {
  const warn = vi.fn();
  resolveRoutedDb('Reorder-Bug', REPO, { warn });
  const msg = warn.mock.calls[0]?.[0] as string;
  expect(msg).toContain('Reorder-Bug');
  expect(msg.toLowerCase()).toContain('default.db');
});
