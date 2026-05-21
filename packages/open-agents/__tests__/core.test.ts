// core: SENTINEL slicing (extractDeliverable) + the compact index renderer.
// Slicing is the load-bearing contract — it must be byte-identical to the
// Phase-0 golden result files given the golden summary strings.

import { describe, expect, test } from 'vitest';
import { extractDeliverable, renderJobResult } from '../src/core/deliverable.ts';

const SENTINEL = '___FINAL_OUTPUT___';

describe('extractDeliverable — SENTINEL slicing', () => {
  test('slices everything after the last whole-line marker', () => {
    expect(extractDeliverable(`narration\n${SENTINEL}\nthe answer`)).toBe('the answer');
  });

  test('GOLDEN-EXPLORE summary → GOLDEN-EXPLORE.result.md (byte parity)', () => {
    const summary =
      `${SENTINEL}\n\n## List the exact signature and return type of every exported symbol in the scratch lib\n\n` +
      'src/math.ts:1-1\n```\nexport function add(a: number, b: number): number {\n```\n\n' +
      'src/math.ts:5-5\n```\nexport const subtract = (a: number, b: number): number => a - b\n```\n\n' +
      'src/strings.ts:1-1\n```\nexport function capitalize(s: string): string {\n```\n\n' +
      'src/index.ts:1-1\n```\nexport { add, subtract } from "./math"\n```\n\n' +
      'src/index.ts:2-2\n```\nexport { capitalize } from "./strings"\n```';
    const out = extractDeliverable(summary);
    expect(out.startsWith('## List the exact signature')).toBe(true);
    expect(out).not.toContain(SENTINEL);
    expect(out.endsWith('export { capitalize } from "./strings"\n```')).toBe(true);
  });

  test('GOLDEN-EDIT summary → fenced typescript block only', () => {
    const summary = `${SENTINEL}\n\n\`\`\`typescript\nexport function triple(n: number): number {\n  return n * 3\n}\n\`\`\``;
    expect(extractDeliverable(summary)).toBe(
      '```typescript\nexport function triple(n: number): number {\n  return n * 3\n}\n```',
    );
  });

  test('a preamble MENTION of the token does not mis-slice', () => {
    const t = `I will end with ${SENTINEL} later\n${SENTINEL}\nreal`;
    expect(extractDeliverable(t)).toBe('real');
  });

  test('quoted source containing the token mid-line cannot mis-slice', () => {
    const t = `${SENTINEL}\nconst x = "${SENTINEL}" // inside a string`;
    expect(extractDeliverable(t)).toBe(`const x = "${SENTINEL}" // inside a string`);
  });

  test('no marker → trimmed whole text; empty → placeholder', () => {
    expect(extractDeliverable('  just text  ')).toBe('just text');
    expect(extractDeliverable('')).toBe('(no final message captured)');
    expect(extractDeliverable(undefined)).toBe('(no final message captured)');
  });

  // Regression: a real ~9KB explore result was silently lost because composer
  // emitted the deliverable THEN the marker as a closing line — slicing only
  // after the marker yielded "" and the job still reported done.
  test('marker as TERMINATOR (deliverable before it, nothing after)', () => {
    expect(extractDeliverable(`## the answer\nline two\n${SENTINEL}`)).toBe(
      '## the answer\nline two',
    );
    expect(extractDeliverable(`## the answer\n${SENTINEL}\n\n  `)).toBe('## the answer');
  });

  test('separator wins when both a leading and trailing marker are present', () => {
    expect(extractDeliverable(`preamble\n${SENTINEL}\nthe answer\n${SENTINEL}`)).toBe(
      'the answer',
    );
  });

  test('a non-empty summary can never produce an empty deliverable', () => {
    expect(extractDeliverable(`real content\n${SENTINEL}`)).not.toBe('');
    expect(extractDeliverable(`${SENTINEL}\nreal content`)).not.toBe('');
  });
});

describe('renderJobResult — compact index', () => {
  const baseJob = {
    id: '20260519-161854-4bd9',
    status: 'done',
    exitCode: 0,
    model: 'composer-2.5',
    startedAt: '2026-05-19T15:18:54.316Z',
    finishedAt: '2026-05-19T15:19:38.850Z',
    prompt:
      '<goal>List the exact signature and return type of every exported symbol in the scratch lib, each with its path:line.</goal>',
    resultPath: 'C:/nonexistent/x.result.md',
    cursorChatId: 'd29d375e-f073-4da4-96dd-65eb7746887f',
  };

  test('explore index shape: header / label / result / follow-up, NO files-changed', () => {
    const { text, code } = renderJobResult(() => baseJob, '/repo', baseJob.id);
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      '### open-agent 20260519-161854-4bd9 — done (exit 0) · composer-2.5 · 45s',
    );
    expect(lines[1]).toBe(
      'label: List the exact signature and return type of every exported symbol in t',
    );
    expect(text).not.toContain('files changed:');
    expect(text).toContain('follow-up: cursor-agent --resume=d29d375e-f073-4da4-96dd-65eb7746887f');
    expect(code).toBe(0);
  });

  test('filesChanged populated → files-changed block appears', () => {
    const job = { ...baseJob, filesChanged: ['src/math.ts'] };
    const { text } = renderJobResult(() => job, '/repo', job.id);
    expect(text).toContain('files changed:');
    expect(text).toContain('  - src/math.ts');
  });

  test('failed job → code 1', () => {
    const job = { ...baseJob, status: 'failed', exitCode: 1 };
    expect(renderJobResult(() => job, '/repo', job.id).code).toBe(1);
  });

  test('missing job → (no job) code 1', () => {
    expect(renderJobResult(() => null, '/repo', 'x').code).toBe(1);
  });
});
