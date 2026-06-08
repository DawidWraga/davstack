import { describe, expect, test } from 'vitest';
import { tokenTail } from '../src/core/compact.js';
import { parseFlags } from '../src/cli.js';

describe('compact mode helpers', () => {
  test('tokenTail keeps the last token-like units', () => {
    expect(tokenTail('one two three four', 2)).toBe('three four');
    expect(tokenTail('one, two. three!', 4)).toBe('two. three!');
  });

  test('compact flags parse', () => {
    const { flags, positional } = parseFlags([
      '--compact-mode',
      '--history-file',
      'C:/history.jsonl',
      'short task',
    ]);
    expect(flags.compactMode).toBe(true);
    expect(flags.historyFile).toBe('C:/history.jsonl');
    expect(positional).toEqual(['short task']);
  });
});
