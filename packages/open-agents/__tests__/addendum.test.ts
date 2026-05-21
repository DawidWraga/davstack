// Profile prompt-extension wiring: cli.ts concatenates the adapter's guard
// addendum + the user's repo-config systemPromptExtension, then passes the
// combined string to profile.buildPrompt as the addendum. The combine helper
// is pure; we test it directly and also via buildPrompt to prove the
// downstream injection still goes through unmodified.

import { describe, expect, test } from 'vitest';
import { combineAddendums } from '../src/cli.ts';
import { exploreProfile } from '../src/profiles/explore.ts';
import { SENTINEL } from '../src/profiles/types.ts';

describe('combineAddendums', () => {
  test('both empty → empty (goldens stay byte-identical)', () => {
    expect(combineAddendums('', '')).toBe('');
  });

  test('adapter only → unchanged (no spurious newline)', () => {
    const adapter = '- VERIFY LINES.\n';
    expect(combineAddendums(adapter, '')).toBe(adapter);
  });

  test('user only without trailing newline → newline appended', () => {
    expect(combineAddendums('', '- CITE path:line.')).toBe('- CITE path:line.\n');
  });

  test('user only with trailing newline → preserved (no double-newline)', () => {
    expect(combineAddendums('', '- CITE path:line.\n')).toBe('- CITE path:line.\n');
  });

  test('adapter then user, in that order', () => {
    expect(combineAddendums('- A.\n', '- B.\n')).toBe('- A.\n- B.\n');
  });
});

describe('combined addendum reaches the scaffold via buildPrompt', () => {
  const spec = '<goal>Anything.</goal>';

  test('a configured user extension is injected before <spec>, after adapter addendum', () => {
    const combined = combineAddendums('- ADAPTER GUARD.\n', '- USER CONVENTION: cite path:line.');
    const prompt = exploreProfile.buildPrompt(spec, combined);
    expect(prompt).toContain('- ADAPTER GUARD.\n');
    expect(prompt).toContain('- USER CONVENTION: cite path:line.\n');
    // Order: adapter line precedes user line.
    expect(prompt.indexOf('ADAPTER GUARD')).toBeLessThan(prompt.indexOf('USER CONVENTION'));
    // Both sit in the guards region, before the spec tag and the sentinel trailer.
    expect(prompt.indexOf('USER CONVENTION')).toBeLessThan(prompt.indexOf('<spec>'));
    expect(prompt.indexOf('USER CONVENTION')).toBeLessThan(prompt.indexOf(SENTINEL));
  });
});
