import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  compressHeadroomMessages,
  formatHeadroomDelta,
  resolveHeadroomConfig,
} from '../src/core/headroom.js';

describe('headroom helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  test('compresses the real message array without changing roles locally', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        messages: [
          { role: 'user', content: 'keep intent' },
          { role: 'assistant', content: 'shorter output' },
        ],
        tokens_before: 100,
        tokens_after: 40,
        tokens_saved: 60,
        compression_ratio: 0.4,
        transforms_applied: ['smart_crusher'],
      }),
    } as Response);

    const result = await compressHeadroomMessages({
      url: 'http://127.0.0.1:8787',
      model: 'composer-2.5',
      tokenBudget: 100000,
      messages: [
        { role: 'user', content: 'keep intent' },
        { role: 'assistant', content: 'long output' },
      ],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/v1/compress',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'composer-2.5',
          tokenBudget: 100000,
          messages: [
            { role: 'user', content: 'keep intent' },
            { role: 'assistant', content: 'long output' },
          ],
        }),
      }),
    );
    expect(result.messages[0]).toEqual({ role: 'user', content: 'keep intent' });
    expect(result.tokensSaved).toBe(60);
  });
});
