// GOLDEN-EXPLORE / GOLDEN-EDIT parity, formalised (plan Phase 2 step 9).
//
// These assert that the NEW code path (profiles.buildPrompt → adapter.parse/
// summarise → core.extractDeliverable / renderJobResult), fed the EXACT
// recorded golden inputs, reproduces the golden outputs byte-for-byte:
//   - fullPrompt the subagent received (profile scaffold)
//   - the SENTINEL-sliced deliverable file
//   - the compact index shape (explore: NO files-changed block)
//   - filesChanged == [] (the load-bearing Phase-0 baseline; DO NOT "fix")
// A live re-run is a separate verification-gate item; this is the regression
// oracle that runs in CI on every change without spending money.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exploreProfile } from '../../src/profiles/explore.ts';
import { editProfile } from '../../src/profiles/edit.ts';
import { cursorAdapter } from '../../src/adapters/cursor.ts';
import { extractDeliverable, renderJobResult } from '../../src/core/deliverable.ts';

// import.meta.dir is bun-only; resolve via fileURLToPath for vitest+node.
const HERE = dirname(fileURLToPath(import.meta.url));
// Normalize CRLF → LF on read: the golden oracle values come from JSON string
// escapes (always LF), but the sibling .md/.json fixtures are raw files that
// git rewrites to CRLF on Windows checkout (core.autocrlf). Without this the
// byte-exact asserts fail on \r alone — a platform artifact, not a regression.
// .gitattributes pins the fixtures to LF too; this keeps the test green even
// if a contributor's git config doesn't.
const read = (f: string) => readFileSync(join(HERE, f), 'utf8').replace(/\r\n/g, '\n');
const golden = (f: string) => JSON.parse(read(f));

describe('GOLDEN-EXPLORE parity (read-only profile)', () => {
  const job = golden('GOLDEN-EXPLORE.job.json');
  const specBody = read('explore-spec.md').replace(/\n+$/, '');

  test('explore profile rebuilds the exact recorded fullPrompt', () => {
    expect(exploreProfile.buildPrompt(specBody)).toBe(job.fullPrompt);
    expect(exploreProfile.mode).toBe('ask');
    expect(job.edit).toBe(false);
  });

  test('cursor adapter ask-mode args match the recorded job (explore)', () => {
    const args = cursorAdapter.buildArgs({
      model: job.model,
      mode: exploreProfile.mode,
      prompt: job.fullPrompt,
    });
    expect(args.slice(0, 8)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--trust',
      '--model',
      'composer-2.5',
      '--mode',
      'ask',
    ]);
    expect(args).not.toContain('--force');
  });

  test('SENTINEL slice of the recorded summary == GOLDEN-EXPLORE.result.md', () => {
    const expected = read('GOLDEN-EXPLORE.result.md').replace(/\n+$/, '');
    expect(extractDeliverable(job.summary)).toBe(expected);
  });

  test('filesChanged == [] (Phase-0 baseline invariant) + exit 0 done', () => {
    expect(job.filesChanged).toEqual([]);
    expect(job.exitCode).toBe(0);
    expect(job.status).toBe('done');
  });

  test('index shape: header/label/result/follow-up, NO files-changed block', () => {
    const { text, code } = renderJobResult(() => job, job.repoPath, job.id);
    expect(text).not.toContain('files changed:');
    expect(text.split('\n')[0]).toMatch(
      /^### cursor-job 20260519-161854-4bd9 — done \(exit 0\) · composer-2\.5 · \d+s$/,
    );
    expect(text).toContain('follow-up: cursor-agent --resume=');
    expect(code).toBe(0);
  });
});

describe('GOLDEN-EDIT parity (one-pass edit profile)', () => {
  const job = golden('GOLDEN-EDIT.job.json');
  const specBody = read('edit-spec.md').replace(/\n+$/, '');

  test('edit profile rebuilds the exact recorded fullPrompt', () => {
    expect(editProfile.buildPrompt(specBody)).toBe(job.fullPrompt);
    expect(editProfile.mode).toBe('force');
    expect(job.edit).toBe(true);
  });

  test('cursor adapter force-mode args match the recorded job (edit)', () => {
    const args = cursorAdapter.buildArgs({
      model: job.model,
      mode: editProfile.mode,
      prompt: job.fullPrompt,
    });
    expect(args).toContain('--force');
    expect(args).not.toContain('--mode');
  });

  test('SENTINEL slice of the recorded summary == GOLDEN-EDIT.result.md', () => {
    const expected = read('GOLDEN-EDIT.result.md').replace(/\n+$/, '');
    expect(extractDeliverable(job.summary)).toBe(expected);
  });

  test('edit spec has <acceptance> → edit profile does NOT warn', () => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    (process.stderr as any).write = (s: string) => {
      writes.push(s);
      return true;
    };
    try {
      editProfile.warnIfMissingAcceptance(specBody);
    } finally {
      process.stderr.write = orig;
    }
    expect(writes.join('')).toBe('');
  });

  test('filesChanged == [] (baseline) + exit 0 done', () => {
    expect(job.filesChanged).toEqual([]);
    expect(job.exitCode).toBe(0);
    expect(job.status).toBe('done');
  });
});
