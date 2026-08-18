import { describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findClaudeTranscriptBySession,
  findCodexTranscriptBySession,
  loadCompactHistory,
  parseCompactMessages,
  renderCompactMessages,
  resolveCompactHistoryFile,
  tokenTail,
} from '../src/core/compact.js';
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

  test('model override parses explicitly and unsupported options stay out of the prompt', () => {
    const parsed = parseFlags(['--model', 'provider-model', '--typo', 'short task']);
    expect(parsed.flags.model).toBe('provider-model');
    expect(parsed.flags.unknownOptions).toEqual(['--typo']);
    expect(parsed.positional).toEqual(['short task']);
  });

  test('loads real JSONL messages for compaction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compact-messages-'));
    try {
      const history = join(dir, 'history.jsonl');
      writeFileSync(
        history,
        [
          JSON.stringify({ message: { role: 'user', content: 'keep user intent' } }),
          JSON.stringify({ message: { role: 'assistant', content: 'assistant response' } }),
        ].join('\n') + '\n',
      );

      const loaded = loadCompactHistory(history, 100);

      expect(loaded.messages).toEqual([
        { role: 'user', content: 'keep user intent' },
        { role: 'assistant', content: 'assistant response' },
      ]);
      expect(loaded.tail).toContain('user: keep user intent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('renders parsed compact messages without changing roles', () => {
    const messages = parseCompactMessages(
      [
        JSON.stringify({ role: 'user', content: 'do not compress this as tool output' }),
        JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'ok' }] }),
      ].join('\n'),
    );

    expect(renderCompactMessages(messages)).toBe(
      'user: do not compress this as tool output\n\nassistant: ok',
    );
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

  test('finds Codex transcript by thread id', () => {
    const home = mkdtempSync(join(tmpdir(), 'compact-codex-history-'));
    try {
      const threadId = '019eabb5-b1ba-7ba1-b84b-97efcca16393';
      const sessionDir = join(home, '.codex', 'sessions', '2026', '06', '09');
      mkdirSync(sessionDir, { recursive: true });
      const transcript = join(sessionDir, `rollout-2026-06-09T10-27-52-${threadId}.jsonl`);
      writeFileSync(transcript, '{}\n');

      expect(findCodexTranscriptBySession(threadId, home)).toBe(transcript);
      expect(
        resolveCompactHistoryFile({
          env: { CODEX_THREAD_ID: threadId },
          homeDir: home,
        }),
      ).toBe(transcript);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('falls back to Codex history.jsonl when no active session env is present', () => {
    const home = mkdtempSync(join(tmpdir(), 'compact-codex-history-'));
    try {
      const codexDir = join(home, '.codex');
      mkdirSync(codexDir, { recursive: true });
      const history = join(codexDir, 'history.jsonl');
      writeFileSync(history, '{"text":"hello"}\n');

      expect(resolveCompactHistoryFile({ env: {}, homeDir: home })).toBe(history);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
