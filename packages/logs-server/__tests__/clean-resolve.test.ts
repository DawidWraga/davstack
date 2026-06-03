// Pure clean-decision helpers — runnable under node/vitest (no bun:sqlite),
// which is the point of keeping them out of clean.ts: you can reason about
// "which db / which mode / full vs windowed" without the bun runtime.

import { describe, test, expect } from 'vitest';
import {
  resolveCleanMode,
  resolveCleanTarget,
  resolveCleanWindow,
} from '../src/clean-resolve.js';

const abs = (p: string) => `/abs/${p}`;

describe('resolveCleanTarget', () => {
  const base = { repoRoot: '/repo', defaultForRepo: '/repo/.davstack/logs/default.db', toAbs: abs };

  test('--db flag wins over everything', () => {
    expect(
      resolveCleanTarget({ ...base, dbFlag: 'flag.db', envDb: 'env.db', configDbPath: 'cfg.db' }),
    ).toBe('/abs/flag.db');
  });

  test('falls back DIAG_DB → config → default-for-repo', () => {
    expect(resolveCleanTarget({ ...base, envDb: 'env.db' })).toBe('/abs/env.db');
    // pinned values are normalized through toAbs (here the test stub prefixes /abs/)
    expect(resolveCleanTarget({ ...base, configDbResolved: 'cfg.db' })).toBe('/abs/cfg.db');
    expect(resolveCleanTarget({ ...base })).toBe('/repo/.davstack/logs/default.db');
  });
});

describe('resolveCleanMode', () => {
  test('flag overrides config; config overrides default archive', () => {
    expect(resolveCleanMode({ flag: 'delete', configMode: 'archive' })).toBe('delete');
    expect(resolveCleanMode({ configMode: 'delete' })).toBe('delete');
    expect(resolveCleanMode({})).toBe('archive');
  });

  test('throws on an explicit invalid mode', () => {
    expect(() => resolveCleanMode({ flag: 'delte' })).toThrow(/invalid mode/);
  });
});

describe('resolveCleanWindow', () => {
  test('absent → undefined (full sweep); present → ms (windowed)', () => {
    expect(resolveCleanWindow(undefined)).toBeUndefined();
    expect(resolveCleanWindow('1h')).toBe(60 * 60 * 1000);
  });

  test('throws on garbage window', () => {
    expect(() => resolveCleanWindow('soon')).toThrow();
  });
});
