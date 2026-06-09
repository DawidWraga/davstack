import { describe, expect, test } from 'vitest';
import {
  formatHeadroomDelta,
  resolveHeadroomConfig,
} from '../src/core/headroom.js';

describe('headroom helpers', () => {
  test('defaults to auto localhost proxy', () => {
    expect(resolveHeadroomConfig({ env: {} })).toEqual({
      mode: 'auto',
      url: 'http://127.0.0.1:8787',
      logStats: true,
    });
  });

  test('env and flags override config', () => {
    expect(
      resolveHeadroomConfig({
        config: { mode: 'auto', url: 'http://config:8787', logStats: true },
        env: { OPEN_AGENTS_HEADROOM: 'off', OPEN_AGENTS_HEADROOM_URL: 'http://env:8787/' },
        modeFlag: 'require',
        urlFlag: 'http://flag:8787/',
      }),
    ).toEqual({
      mode: 'require',
      url: 'http://flag:8787',
      logStats: true,
    });
  });

  test('formats stats deltas when counters are available', () => {
    expect(
      formatHeadroomDelta(
        { requestsTotal: 10, tokensSaved: 1000, inputTokens: 10000, outputTokens: 100, raw: {} },
        { requestsTotal: 12, tokensSaved: 2500, inputTokens: 12000, outputTokens: 200, raw: {} },
      ),
    ).toBe('2 requests, 1,500 tokens saved');
  });
});
