// Pure formatters for vitest task/result trees. Tested in isolation so we
// can refactor the surrounding session/HTTP plumbing without breaking the
// agent-facing JSON shape.

import { test, expect } from 'vitest';
import {
  stripAnsi,
  isStorybookWrapper,
  pickRealError,
  formatError,
  getSuiteChain,
  buildTestEntry,
  walkTaskTreeForTests,
} from '../src/format.js';

// ─── stripAnsi ──────────────────────────────────────────────────────────────

test('stripAnsi removes SGR escape sequences', () => {
  expect(stripAnsi('\x1b[31mred\x1b[0m text')).toBe('red text');
  expect(stripAnsi('plain')).toBe('plain');
});

test('stripAnsi passes non-strings through unchanged', () => {
  expect(stripAnsi(null as unknown as string)).toBe(null);
  expect(stripAnsi(undefined as unknown as string)).toBe(undefined);
});

// ─── isStorybookWrapper ─────────────────────────────────────────────────────

test('isStorybookWrapper detects the Click-to-debug preamble', () => {
  expect(
    isStorybookWrapper({ message: 'Click to debug the error directly in Storybook\nactual error' }),
  ).toBe(true);
});

test('isStorybookWrapper sees through leading whitespace + ANSI', () => {
  expect(
    isStorybookWrapper({
      message: '  \x1b[31mClick to debug the error directly in Storybook\x1b[0m\nfoo',
    }),
  ).toBe(true);
});

test('isStorybookWrapper returns false for real errors', () => {
  expect(isStorybookWrapper({ message: 'expected 1 to equal 2' })).toBe(false);
  expect(isStorybookWrapper(null)).toBe(false);
  expect(isStorybookWrapper({})).toBe(false);
});

// ─── pickRealError ──────────────────────────────────────────────────────────

test('pickRealError returns null on empty/missing input', () => {
  expect(pickRealError([])).toBeNull();
  expect(pickRealError(null as unknown as never[])).toBeNull();
});

test('pickRealError skips storybook wrappers and returns the first real error', () => {
  const wrap = { message: 'Click to debug the error directly in Storybook' };
  const real = { message: 'expected 1 to equal 2' };
  expect(pickRealError([wrap, real])).toBe(real);
});

test('pickRealError dedupes by message', () => {
  const a = { message: 'boom' };
  const b = { message: 'boom' };
  const c = { message: 'kaboom' };
  expect(pickRealError([a, b, c])).toBe(a);
});

test('pickRealError falls back to first entry if all are wrappers', () => {
  const w1 = { message: 'Click to debug the error directly in Storybook' };
  const w2 = { message: 'Click to debug the error directly in Storybook again' };
  // Both filter-out → falls back to errors[0]
  expect(pickRealError([w1, w2])).toBe(w1);
});

// ─── formatError ────────────────────────────────────────────────────────────

test('formatError returns null for falsy input', () => {
  expect(formatError(null)).toBeNull();
  expect(formatError(undefined)).toBeNull();
});

test('formatError builds a summary line and strips ANSI from message/stack', () => {
  const r = formatError({
    name: 'AssertionError',
    message: '\x1b[31mexpected 1 to equal 2\x1b[0m\n  at foo',
    stack: '\x1b[31mAssertionError\x1b[0m\n  at bar',
    expected: 1,
    actual: 2,
  });
  expect(r?.name).toBe('AssertionError');
  expect(r?.summary).toBe('AssertionError: expected 1 to equal 2');
  expect(r?.message).toContain('expected 1 to equal 2');
  expect(r?.message).not.toContain('\x1b[');
  expect(r?.stack).not.toContain('\x1b[');
  expect(r?.expected).toBe(1);
  expect(r?.actual).toBe(2);
});

test('formatError uses explicit name when set', () => {
  class FooError extends Error {
    name = 'FooError';
  }
  const r = formatError(new FooError('boom'));
  expect(r?.name).toBe('FooError');
});

test('formatError handles missing fields without throwing', () => {
  const r = formatError({});
  // err.name absent, err.constructor.name === 'Object' (preserved from
  // original .mjs behavior).
  expect(r?.name).toBe('Object');
  expect(r?.stack).toBeNull();
});

// ─── getSuiteChain ──────────────────────────────────────────────────────────

test('getSuiteChain joins nested suite names with " > "', () => {
  const task: any = {
    suite: {
      type: 'suite',
      name: 'Inner',
      suite: { type: 'suite', name: 'Outer', suite: null },
    },
  };
  expect(getSuiteChain(task)).toBe('Outer > Inner');
});

test('getSuiteChain returns empty string when no suite chain', () => {
  expect(getSuiteChain({})).toBe('');
});

// ─── buildTestEntry ─────────────────────────────────────────────────────────

test('buildTestEntry maps vitest task/result to agent-facing shape', () => {
  const task: any = {
    id: 't-1',
    name: 'renders',
    file: { filepath: '/abs/foo.stories.tsx' },
    suite: { type: 'suite', name: 'Foo', suite: null },
  };
  const result = {
    state: 'pass',
    duration: 42,
    errors: [],
  };
  const e = buildTestEntry(task, result);
  expect(e.id).toBe('t-1');
  expect(e.name).toBe('Foo > renders');
  expect(e.rawName).toBe('renders');
  expect(e.module).toBe('/abs/foo.stories.tsx');
  expect(e.state).toBe('passed');
  expect(e.durationMs).toBe(42);
  expect(e.error).toBeNull();
});

test('buildTestEntry surfaces a real error past storybook wrappers', () => {
  const task: any = { id: 't-2', name: 'fails', suite: null, file: null };
  const result = {
    state: 'fail',
    duration: 5,
    errors: [
      { message: 'Click to debug the error directly in Storybook' },
      { message: 'expected 1 to equal 2', name: 'AssertionError' },
    ],
  };
  const e = buildTestEntry(task, result);
  expect(e.state).toBe('failed');
  expect(e.error?.name).toBe('AssertionError');
  expect(e.error?.summary).toContain('expected 1 to equal 2');
});

test('buildTestEntry maps unknown state to "skipped"', () => {
  const task: any = { id: 't-3', name: 's', suite: null, file: null };
  const e = buildTestEntry(task, { state: 'skip', errors: [] });
  expect(e.state).toBe('skipped');
});

// ─── walkTaskTreeForTests ───────────────────────────────────────────────────

test('walkTaskTreeForTests collects every test leaf', () => {
  const tree: any = {
    type: 'file',
    tasks: [
      {
        type: 'suite',
        tasks: [
          { type: 'test', id: 'a', name: 'a', result: { state: 'pass', errors: [] }, suite: null, file: null },
          { type: 'test', id: 'b', name: 'b', result: { state: 'fail', errors: [] }, suite: null, file: null },
        ],
      },
      { type: 'test', id: 'c', name: 'c', result: { state: 'pass', errors: [] }, suite: null, file: null },
    ],
  };
  const captured = new Map();
  walkTaskTreeForTests(tree, captured);
  expect([...captured.keys()].sort()).toEqual(['a', 'b', 'c']);
});

test('walkTaskTreeForTests does not overwrite existing captures', () => {
  const captured = new Map();
  const existing = { id: 'a', name: 'pre', rawName: 'pre', state: 'passed' };
  captured.set('a', existing);
  walkTaskTreeForTests(
    { type: 'test', id: 'a', name: 'a', result: { state: 'fail', errors: [] }, suite: null, file: null } as any,
    captured,
  );
  expect(captured.get('a')).toBe(existing);
});
