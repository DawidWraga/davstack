// RED first. The duration parser turns human retention/cadence strings
// ("10m", "24h", "90s", "1d") into milliseconds. It is a pure function so it
// runs under the node/vitest project (not bun-only) — `pnpm test` covers it.

import { describe, test, expect } from 'vitest';
import { parseDuration } from '../src/duration.js';

describe('parseDuration', () => {
  test('parses seconds / minutes / hours / days', () => {
    expect(parseDuration('90s')).toBe(90 * 1000);
    expect(parseDuration('10m')).toBe(10 * 60 * 1000);
    expect(parseDuration('24h')).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration('1d')).toBe(24 * 60 * 60 * 1000);
  });

  test('accepts surrounding whitespace and multi-digit values', () => {
    expect(parseDuration('  120m ')).toBe(120 * 60 * 1000);
    expect(parseDuration('0s')).toBe(0);
  });

  test('rejects garbage', () => {
    for (const bad of ['', 'abc', '10', 'm', '10x', '1.5h', '-5m', '10 m', 'NaNh']) {
      expect(() => parseDuration(bad)).toThrow();
    }
  });
});
