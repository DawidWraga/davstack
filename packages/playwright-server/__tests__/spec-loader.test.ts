// Tests for the spec-loader rev-propagation behavior. The loader is the
// keystone of /refresh: it propagates the spec URL's `?_pwsRev=<n>` (or
// `?t=<n>`) query string down to every transitively-imported file://
// module so an agent's edit to a UI model / fixture actually gets
// re-evaluated on the next run instead of being served from Node's ESM
// cache.
//
// We test the resolve() hook in isolation by faking the `nextResolve`
// callback (which the loader contract gives us). The actual loader runs
// in a worker thread; spec-loader.mjs is a plain ESM module that exports
// `resolve` so it's trivially callable from a Vitest test.

import { test, expect, beforeEach } from 'vitest';
// @ts-expect-error — .mjs is plain ESM, no .d.ts shipped
import { resolve as loaderResolve, initialize } from '../src/spec-loader.mjs';

beforeEach(async () => {
  // The stub URL is only used for the @playwright/test redirect path.
  // Pass a sentinel so we can verify it's NOT used for ordinary specifiers.
  await initialize({ stubUrl: 'file:///fake/stub.mjs' });
});

function nextResolveFor(url: string) {
  return async () => ({ url, format: 'module' });
}

test('redirects @playwright/test to the stub', async () => {
  const result = await loaderResolve(
    '@playwright/test',
    { parentURL: 'file:///spec.ts?_pwsRev=3' },
    nextResolveFor('file:///should-not-be-called.mjs'),
  );
  expect(result.url).toBe('file:///fake/stub.mjs');
  expect(result.shortCircuit).toBe(true);
});

test('propagates _pwsRev from parent to child file:// imports', async () => {
  const result = await loaderResolve(
    './foo.ui.ts',
    { parentURL: 'file:///abs/path/spec.ts?_pwsRev=7' },
    nextResolveFor('file:///abs/path/foo.ui.ts'),
  );
  expect(result.url).toBe('file:///abs/path/foo.ui.ts?_pwsRev=7');
});

test('propagates legacy `t` query as _pwsRev', async () => {
  // Back-compat: earlier playwright-server versions used `?t=<ms>` on
  // the spec URL. Propagate that as _pwsRev so a pinned old session.ts
  // still cache-busts its imports.
  const result = await loaderResolve(
    './foo.ts',
    { parentURL: 'file:///spec.ts?t=12345' },
    nextResolveFor('file:///foo.ts'),
  );
  expect(result.url).toBe('file:///foo.ts?_pwsRev=12345');
});

test('skips propagation when parent has no rev query', async () => {
  const result = await loaderResolve(
    './foo.ts',
    { parentURL: 'file:///spec.ts' },
    nextResolveFor('file:///foo.ts'),
  );
  expect(result.url).toBe('file:///foo.ts');
});

test('skips propagation into node_modules', async () => {
  // Node_modules are immutable for a session — re-evaluating @reduxjs/toolkit
  // every refresh would cost seconds for zero benefit. Keep them cached.
  const result = await loaderResolve(
    'lodash',
    { parentURL: 'file:///spec.ts?_pwsRev=2' },
    nextResolveFor('file:///root/node_modules/lodash/lodash.js'),
  );
  expect(result.url).toBe('file:///root/node_modules/lodash/lodash.js');
});

test('skips non-file:// child URLs (node:builtin, http://)', async () => {
  const result = await loaderResolve(
    'node:fs',
    { parentURL: 'file:///spec.ts?_pwsRev=2' },
    nextResolveFor('node:fs'),
  );
  expect(result.url).toBe('node:fs');
});

test('does not double-stamp _pwsRev when child URL already has one', async () => {
  // Important guard: a transitively-imported module hit by two parents
  // with the same rev should not accumulate `?_pwsRev=3&_pwsRev=3` or
  // worse, end up with a stale rev. The loader leaves it alone.
  const result = await loaderResolve(
    './shared.ts',
    { parentURL: 'file:///a.ts?_pwsRev=3' },
    nextResolveFor('file:///shared.ts?_pwsRev=3'),
  );
  expect(result.url).toBe('file:///shared.ts?_pwsRev=3');
});

test('skips propagation when parent URL is not file://', async () => {
  const result = await loaderResolve(
    './foo.ts',
    { parentURL: 'data:text/javascript,export default 1' },
    nextResolveFor('file:///foo.ts'),
  );
  expect(result.url).toBe('file:///foo.ts');
});
