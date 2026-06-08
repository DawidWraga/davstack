import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findClaudeTranscriptBySession, resolveCompactHistoryFile, tokenTail } from '../src/core/compact.js';
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

  test('resolves explicit and env history paths before Claude session lookup', () => {
    expect(
      resolveCompactHistoryFile({
        historyFile: 'explicit.jsonl',
        env: { OPEN_AGENTS_HISTORY_FILE: 'env.jsonl' },
      }),
    ).toContain('explicit.jsonl');
    expect(
      resolveCompactHistoryFile({
        env: { OPEN_AGENTS_HISTORY_FILE: 'env.jsonl' },
      }),
    ).toContain('env.jsonl');
  });

  test('finds Claude Code transcript by session id', () => {
    const home = mkdtempSync(join(tmpdir(), 'compact-history-'));
    try {
      const sessionId = 'fe080f49-6b6b-4f57-98ab-c954671c6a40';
      const projectDir = join(home, '.claude', 'projects', 'C--Users-dpwra-dev-davstack');
      mkdirSync(projectDir, { recursive: true });
      const transcript = join(projectDir, `${sessionId}.jsonl`);
      writeFileSync(transcript, '{}\n');

      expect(findClaudeTranscriptBySession(sessionId, home)).toBe(transcript);
      expect(
        resolveCompactHistoryFile({
          env: { CLAUDE_CODE_SESSION_ID: sessionId },
          homeDir: home,
        }),
      ).toBe(transcript);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
