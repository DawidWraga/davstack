// Profile prompt-scaffold snapshots. These guard the EXACT prompt bytes
// against the Phase-0 golden job records (fullPrompt field) — the migration's
// "behaviour identical" contract starts at the prompt the subagent receives.

import { describe, expect, test } from 'vitest';
import { exploreProfile } from '../src/profiles/explore.ts';
import { editProfile } from '../src/profiles/edit.ts';
import { SENTINEL } from '../src/profiles/types.ts';

const EXPLORE_SPEC =
  '<goal>List the exact signature and return type of every exported symbol in the scratch lib, each with its path:line.</goal>\n' +
  '<context>Tiny throwaway TS repo used as a migration regression baseline. Nothing tricky.</context>\n' +
  '<scope>src/**.ts only.</scope>';

const EDIT_SPEC =
  '<goal>Add an exported `triple` function to src/math.ts that takes one number and returns it multiplied by 3.</goal>\n' +
  "<context>Tiny throwaway TS repo. Match the existing file's style (it has both a `function` declaration and an arrow `const` export — either is fine).</context>\n" +
  '<scope>src/math.ts ONLY. Do not modify src/index.ts or any other file.</scope>\n' +
  '<acceptance>tsc --noEmit clean; `triple(n: number): number` exported from src/math.ts returning n * 3.</acceptance>';

// Byte-for-byte fullPrompt from GOLDEN-EXPLORE.job.json / GOLDEN-EDIT.job.json.
const GOLDEN_RECON_PROMPT =
  'You are a fast execution subagent. Follow the spec (in the spec tag below) literally and minimally.\n' +
  'Rules:\n' +
  '- Do ONLY what the spec asks. Do not refactor, reformat, or touch anything outside its stated scope.\n' +
  '- If the spec is ambiguous, take the smallest reasonable action and note the ambiguity in the result — do not widen scope to be safe.\n' +
  '- Be terse. No preamble, no narration of your process.\n' +
  '- With large files/logs: grep or search to the relevant lines and read only those; never read a huge file wholesale — protect your context window.\n' +
  '- READ-ONLY: do not create, modify, or delete any file, and do not run mutating commands. If an edit seems needed, DESCRIBE it under the result instead of doing it.\n' +
  '- QUOTE-EXTRACTOR, not analyst: facts only, no conclusion/headline.\n' +
  '- OUTPUT (unless SPEC overrides it): per finding a `path:Lstart-Lend` line + fenced verbatim source, grouped by SCOPE question, no prose between. Hypotheses: one final "HYPOTHESIS (unverified):" line.\n' +
  '\n<spec>\n' +
  EXPLORE_SPEC +
  '\n</spec>\n\n' +
  'When finished, output a line that is EXACTLY this and nothing else on that line:\n' +
  SENTINEL +
  '\n' +
  'then ONLY the requested deliverable, in exactly the requested format. Emit that marker line once, as the final marker; output nothing after the deliverable.';

const GOLDEN_EDIT_PROMPT =
  'You are a fast execution subagent. Follow the spec (in the spec tag below) literally and minimally.\n' +
  'Rules:\n' +
  '- Do ONLY what the spec asks. Do not refactor, reformat, or touch anything outside its stated scope.\n' +
  '- If the spec is ambiguous, take the smallest reasonable action and note the ambiguity in the result — do not widen scope to be safe.\n' +
  '- Be terse. No preamble, no narration of your process.\n' +
  '- With large files/logs: grep or search to the relevant lines and read only those; never read a huge file wholesale — protect your context window.\n' +
  '- VERIFY: typecheck only (tsc --noEmit / project equiv) on changed files. NEVER run or write tests.\n' +
  '- ONE PASS: if it will not apply cleanly or typecheck first try, STOP — report what you tried, the exact error, why; that is the handback. Do not iterate or widen scope.\n' +
  '\n<spec>\n' +
  EDIT_SPEC +
  '\n</spec>\n\n' +
  'When finished, output a line that is EXACTLY this and nothing else on that line:\n' +
  SENTINEL +
  '\n' +
  'then ONLY the requested deliverable, in exactly the requested format. Emit that marker line once, as the final marker; output nothing after the deliverable.';

describe('explore profile', () => {
  test('mode is ask, tag explore', () => {
    expect(exploreProfile.mode).toBe('ask');
    expect(exploreProfile.tag).toBe('explore');
    expect(exploreProfile.name).toBe('explore');
  });

  test('buildPrompt is byte-identical to GOLDEN-EXPLORE fullPrompt', () => {
    expect(exploreProfile.buildPrompt(EXPLORE_SPEC)).toBe(GOLDEN_RECON_PROMPT);
  });

  test('empty/omitted addendum is byte-identical (golden parity preserved)', () => {
    expect(exploreProfile.buildPrompt(EXPLORE_SPEC, '')).toBe(GOLDEN_RECON_PROMPT);
    expect(exploreProfile.buildPrompt(EXPLORE_SPEC, '')).toBe(exploreProfile.buildPrompt(EXPLORE_SPEC));
  });

  test('an addendum is injected into the guards block, before <spec>', () => {
    const add = '- EXTRA GUARD LINE.\n';
    const p = exploreProfile.buildPrompt(EXPLORE_SPEC, add);
    expect(p).toContain(add);
    // sits in the rules/guards region, not after the SENTINEL trailer
    expect(p.indexOf(add)).toBeLessThan(p.indexOf('<spec>'));
    expect(p.indexOf(add)).toBeLessThan(p.indexOf(SENTINEL));
    // and it only adds the addendum — rest of the scaffold is unchanged
    expect(p.replace(add, '')).toBe(GOLDEN_RECON_PROMPT);
  });

  test('no acceptance warning for explore (never warns)', () => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    (process.stderr as any).write = (s: string) => {
      writes.push(s);
      return true;
    };
    try {
      exploreProfile.warnIfMissingAcceptance('anything');
    } finally {
      process.stderr.write = orig;
    }
    expect(writes).toEqual([]);
  });
});

describe('edit profile', () => {
  test('mode is force, tag EDIT', () => {
    expect(editProfile.mode).toBe('force');
    expect(editProfile.tag).toBe('EDIT');
    expect(editProfile.name).toBe('edit');
  });

  test('buildPrompt is byte-identical to GOLDEN-EDIT fullPrompt', () => {
    expect(editProfile.buildPrompt(EDIT_SPEC)).toBe(GOLDEN_EDIT_PROMPT);
  });

  test('warns when <acceptance> missing, silent when present', () => {
    const capture = (body: string) => {
      const writes: string[] = [];
      const orig = process.stderr.write;
      (process.stderr as any).write = (s: string) => {
        writes.push(s);
        return true;
      };
      try {
        editProfile.warnIfMissingAcceptance(body);
      } finally {
        process.stderr.write = orig;
      }
      return writes.join('');
    };
    expect(capture('no gate here')).toContain('warning — an --edit spec has no <acceptance>');
    expect(capture(EDIT_SPEC)).toBe('');
    expect(capture('ACCEPTANCE: tsc clean')).toBe('');
  });
});
