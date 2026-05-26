// agy adapter: arg construction (mode→permission-flag mapping), plain-text
// parse/summarise (no stream-json, no result event), .antigravitycli/ litter
// sweep, binary resolution (LOCALAPPDATA exe + AGY_CLI_BIN precedence), and
// cli-level --provider agy selection wiring.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agyAdapter,
  brainBaseDir,
  continueUntilComplete,
  extractFromBrainTranscript,
  resetBrainSnapshot,
  resolveAgyExe,
  resolveBin,
  summariseAgy,
  sweepLitterDir,
  TRUNCATION_RE,
} from '../src/adapters/agy.js';
import { parseFlags, pickAdapter } from '../src/cli.js';

describe('agy adapter — tier map (no-op: CLI has no model selection)', () => {
  test('tierModel returns empty for both tiers; defaultModel matches', () => {
    expect(agyAdapter.tierModel('smarter')).toBe('');
    expect(agyAdapter.tierModel('faster')).toBe('');
    expect(agyAdapter.defaultModel()).toBe('');
  });
});

describe('agy adapter — buildArgs', () => {
  test('ask mode → --sandbox (explore is read-only intent)', () => {
    const a = agyAdapter.buildArgs({ model: '', mode: 'ask', prompt: 'P' });
    expect(a).toEqual(['--print-timeout', '30m', '--sandbox', '-p', 'P']);
    expect(a).not.toContain('--dangerously-skip-permissions');
  });

  test('force mode → --dangerously-skip-permissions (edit auto-approve)', () => {
    const a = agyAdapter.buildArgs({ model: '', mode: 'force', prompt: 'P' });
    expect(a).toEqual([
      '--print-timeout',
      '30m',
      '--dangerously-skip-permissions',
      '-p',
      'P',
    ]);
    expect(a).not.toContain('--sandbox');
  });

  test('model arg is intentionally omitted (agy CLI exposes no --model)', () => {
    const a = agyAdapter.buildArgs({ model: 'gemini-3-pro', mode: 'ask', prompt: 'P' });
    expect(a).not.toContain('--model');
    expect(a).not.toContain('-m');
    expect(a).not.toContain('gemini-3-pro');
  });

  test('multi-line prompt is a single trailing argv element (shell-free)', () => {
    const prompt = 'line1\nline2\n___FINAL_OUTPUT___\nanswer';
    const a = agyAdapter.buildArgs({ model: '', mode: 'force', prompt });
    expect(a[a.length - 1]).toBe(prompt);
  });
});

describe('agy adapter — parse / summarise (TTY path)', () => {
  beforeEach(() => {
    // Brain fallback off — these tests assert the stream-only path.
    resetBrainSnapshot();
  });

  test('parseLine wraps each non-empty line as {type:text, content}', () => {
    expect(agyAdapter.parseLine('hello')).toEqual({ type: 'text', content: 'hello' });
    expect(agyAdapter.parseLine('')).toBeNull();
  });

  test('summarise joins content in stream order with newlines', () => {
    const events = [
      agyAdapter.parseLine('___FINAL_OUTPUT___'),
      agyAdapter.parseLine('the answer'),
    ].filter(Boolean) as any[];
    const s = summariseAgy(events);
    expect(s.summary).toBe('___FINAL_OUTPUT___\nthe answer');
    expect(s.filesChanged).toEqual([]);
    expect(s.success).toBe(true);
    expect(s.exitReason).toBe('completed');
  });

  test('no text events AND no brain snapshot → placeholder + success:false', () => {
    const s = summariseAgy([]);
    expect(s.summary).toBe('(no final message captured)');
    expect(s.success).toBe(false);
    expect(s.exitReason).toBe('no-output');
  });

  test('extractChatId is undefined (v1: agy stdout carries no session id)', () => {
    expect(agyAdapter.extractChatId([{ type: 'text', content: 'whatever' }])).toBeUndefined();
  });
});

describe('agy adapter — resolveBin', () => {
  const origBin = process.env.AGY_CLI_BIN;
  afterEach(() => {
    if (origBin === undefined) delete process.env.AGY_CLI_BIN;
    else process.env.AGY_CLI_BIN = origBin;
  });

  test('AGY_CLI_BIN overrides everything: bin=env, no prelaunch, no shell', () => {
    process.env.AGY_CLI_BIN = 'C:/some/agy-wrapper.exe';
    expect(resolveBin()).toEqual({
      bin: 'C:/some/agy-wrapper.exe',
      prelaunchArgs: [],
      shell: false,
    });
  });

  test('no override → {bin, prelaunchArgs[], shell:false}; never a shell spawn', () => {
    delete process.env.AGY_CLI_BIN;
    const r = resolveBin();
    expect(typeof r.bin).toBe('string');
    expect(r.bin.length).toBeGreaterThan(0);
    expect(Array.isArray(r.prelaunchArgs)).toBe(true);
    expect(r.shell).toBe(false);
  });
});

describe('agy adapter — resolveAgyExe (Windows LOCALAPPDATA install)', () => {
  const origLocalAppData = process.env.LOCALAPPDATA;
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'agy-resolve-'));
    process.env.LOCALAPPDATA = sandbox;
  });
  afterEach(() => {
    if (origLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = origLocalAppData;
    rmSync(sandbox, { recursive: true, force: true });
  });

  test('null when LOCALAPPDATA unset', () => {
    delete process.env.LOCALAPPDATA;
    expect(resolveAgyExe()).toBeNull();
  });

  test('null when agy.exe missing under %LOCALAPPDATA%\\agy\\bin', () => {
    expect(resolveAgyExe()).toBeNull();
  });

  test('resolves %LOCALAPPDATA%\\agy\\bin\\agy.exe when present', () => {
    const binDir = join(sandbox, 'agy', 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(binDir, 'agy.exe');
    writeFileSync(exe, 'x');
    expect(resolveAgyExe()).toBe(exe);
  });

  test('win32 resolveBin with a resolvable install → the agy.exe directly', () => {
    if (process.platform !== 'win32') return; // win32-only resolution branch
    delete process.env.AGY_CLI_BIN;
    const binDir = join(sandbox, 'agy', 'bin');
    mkdirSync(binDir, { recursive: true });
    const exe = join(binDir, 'agy.exe');
    writeFileSync(exe, 'x');
    expect(resolveBin()).toEqual({ bin: exe, prelaunchArgs: [], shell: false });
  });
});

describe('agy adapter — sweepLitterDir (.antigravitycli/)', () => {
  let sandbox: string;
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'agy-litter-'));
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test('removes an empty .antigravitycli/ that did not exist before the run', () => {
    mkdirSync(join(sandbox, '.antigravitycli'));
    sweepLitterDir(sandbox, { exists: false, empty: false });
    // Re-check: dir should be gone.
    let stillThere = true;
    try {
      // statSync would throw if missing; use a probe write to confirm absence.
      writeFileSync(join(sandbox, '.antigravitycli', 'probe'), 'x');
    } catch {
      stillThere = false;
    }
    expect(stillThere).toBe(false);
  });

  test('keeps .antigravitycli/ that has content (never deletes real data)', () => {
    const dir = join(sandbox, '.antigravitycli');
    mkdirSync(dir);
    writeFileSync(join(dir, 'real-data.json'), '{}');
    sweepLitterDir(sandbox, { exists: false, empty: false });
    // Probe write should still succeed → dir still exists.
    expect(() => writeFileSync(join(dir, 'probe'), 'x')).not.toThrow();
  });

  test('keeps a .antigravitycli/ that already had content before this run', () => {
    const dir = join(sandbox, '.antigravitycli');
    mkdirSync(dir);
    writeFileSync(join(dir, 'pre-existing.json'), '{}');
    sweepLitterDir(sandbox, { exists: true, empty: false });
    expect(() => writeFileSync(join(dir, 'probe'), 'x')).not.toThrow();
  });

  test('no-op when .antigravitycli/ does not exist', () => {
    expect(() => sweepLitterDir(sandbox, null)).not.toThrow();
  });

  test('preSpawn returns a snapshot; postExit accepts it without throwing', () => {
    const before = agyAdapter.preSpawn(sandbox);
    expect(() => agyAdapter.postExit(sandbox, before)).not.toThrow();
  });
});

describe('agy adapter — brain-dir extraction (non-TTY stdout workaround)', () => {
  const origUserProfile = process.env.USERPROFILE;
  const origHome = process.env.HOME;
  let sandboxHome: string;

  beforeEach(() => {
    sandboxHome = mkdtempSync(join(tmpdir(), 'agy-brain-'));
    process.env.USERPROFILE = sandboxHome;
    process.env.HOME = sandboxHome;
    resetBrainSnapshot();
  });
  afterEach(() => {
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    rmSync(sandboxHome, { recursive: true, force: true });
    resetBrainSnapshot();
  });

  const writeBrainTranscript = (uuid: string, lines: object[]) => {
    const dir = join(brainBaseDir(), uuid, '.system_generated', 'logs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'transcript.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
      'utf8',
    );
  };

  test('extractFromBrainTranscript pulls all PLANNER_RESPONSE content in order', () => {
    writeBrainTranscript('uuid-1', [
      { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: '<USER_REQUEST>say hi</USER_REQUEST>' },
      { source: 'SYSTEM', type: 'CONVERSATION_HISTORY' },
      { source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'Hello,' },
      { source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'world.' },
    ]);
    const out = extractFromBrainTranscript('uuid-1');
    expect(out.text).toBe('Hello,\nworld.');
    expect(out.files).toEqual([]);
  });

  test('extractFromBrainTranscript skips non-MODEL/PLANNER_RESPONSE rows', () => {
    writeBrainTranscript('uuid-2', [
      { source: 'USER_EXPLICIT', type: 'USER_INPUT', content: 'IGNORE-ME' },
      { source: 'MODEL', type: 'TOOL_RESULT', content: 'IGNORE-ME-TOO' },
      { source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'KEEP-ME' },
    ]);
    const out = extractFromBrainTranscript('uuid-2');
    expect(out.text).toBe('KEEP-ME');
    expect(out.text).not.toContain('IGNORE-ME');
  });

  test('extractFromBrainTranscript pulls file paths from write-ish tool_calls', () => {
    writeBrainTranscript('uuid-3', [
      {
        source: 'MODEL',
        type: 'PLANNER_RESPONSE',
        content: 'done',
        tool_calls: [
          { name: 'list_dir', args: { DirectoryPath: '.' } }, // read-only, skip
          { name: 'write_file', args: { FilePath: 'src/a.ts' } },
          { name: 'replace_in_file', args: { file_path: 'src/b.ts' } },
        ],
      },
    ]);
    const out = extractFromBrainTranscript('uuid-3');
    expect(out.files.sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  // The "summariseAgy falls back to brain extraction" test moved to
  // __tests__/bun-only/agy-brain-fallback.test.ts — passes under bun (and
  // standalone node), fails under vitest+node. See that file's header for
  // the rationale.

  test('summariseAgy ignores pre-existing brain UUIDs (only new ones count)', () => {
    // A prior agy session left transcript on disk.
    writeBrainTranscript('old-uuid', [
      { source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'OLD-RESPONSE' },
    ]);
    // Snapshot now → old-uuid is in the baseline.
    agyAdapter.preSpawn(sandboxHome);
    // No new dir created (agy ran but crashed before persisting).
    const s = summariseAgy([]);
    expect(s.summary).not.toContain('OLD-RESPONSE');
    expect(s.success).toBe(false);
    expect(s.exitReason).toBe('no-output');
  });

  // "parallel summarise: two sequential calls claim two distinct fresh UUIDs"
  // also moved to __tests__/bun-only/agy-brain-fallback.test.ts.

  test('TTY-path events still win when present (brain fallback skipped)', () => {
    mkdirSync(brainBaseDir(), { recursive: true });
    agyAdapter.preSpawn(sandboxHome);
    writeBrainTranscript('new-uuid', [
      { source: 'MODEL', type: 'PLANNER_RESPONSE', content: 'FROM-BRAIN' },
    ]);
    const s = summariseAgy([{ type: 'text', content: 'FROM-STREAM' }]);
    expect(s.summary).toBe('FROM-STREAM');
    expect(s.exitReason).toBe('completed'); // not 'completed (brain)'
  });

  // "summariseAgy: brain text without/with marker" pair also moved to
  // __tests__/bun-only/agy-brain-fallback.test.ts.
});

describe('agy adapter — auto-continue on Antigravity hardcap truncation', () => {
  test('TRUNCATION_RE matches the marker variants the model emits', () => {
    expect(TRUNCATION_RE.test('foo\n<truncated 13937 bytes>\nbar')).toBe(true);
    expect(TRUNCATION_RE.test('<TRUNCATED 200 BYTES>')).toBe(true);
    expect(TRUNCATION_RE.test('<truncated   42 bytes>')).toBe(true);
    expect(TRUNCATION_RE.test('plain text, no marker')).toBe(false);
    expect(TRUNCATION_RE.test('<truncated bytes>')).toBe(false); // no digits
  });

  test('continueUntilComplete: no marker ⇒ zero turns, text unchanged', () => {
    const calls: number[] = [];
    const out = continueUntilComplete({ text: 'clean text', files: ['a.ts'] }, () => {
      calls.push(1);
      return 'should not be called';
    });
    expect(out.turns).toBe(0);
    expect(out.text).toBe('clean text');
    expect(out.files).toEqual(['a.ts']);
    expect(calls.length).toBe(0);
  });

  test('continueUntilComplete: marker present ⇒ runs continue, concatenates', () => {
    const replies = ['continuation chunk 1'];
    const out = continueUntilComplete(
      { text: 'head\n<truncated 100 bytes>\ntail', files: [] },
      () => replies.shift() ?? null,
    );
    expect(out.turns).toBe(1);
    expect(out.text).toContain('head');
    expect(out.text).toContain('continuation chunk 1');
  });

  test('continueUntilComplete: caps at maxTurns even if model keeps truncating', () => {
    const out = continueUntilComplete(
      { text: 'a<truncated 1 bytes>b', files: [] },
      () => 'still<truncated 1 bytes>more',
      2,
    );
    expect(out.turns).toBe(2);
  });

  test('continueUntilComplete: bails when runner returns null (e.g. agy failed)', () => {
    const out = continueUntilComplete(
      { text: 'x<truncated 9 bytes>y', files: [] },
      () => null,
    );
    expect(out.turns).toBe(0);
  });

});

describe('cli --provider agy selection', () => {
  test('--provider agy and --provider=agy both set the adapter', () => {
    expect(parseFlags(['--provider', 'agy']).flags.adapter).toBe('agy');
    expect(parseFlags(['--provider=agy']).flags.adapter).toBe('agy');
  });

  test('--adapter stays a working alias for --provider', () => {
    expect(parseFlags(['--adapter', 'agy']).flags.adapter).toBe('agy');
  });

  test('pickAdapter: explicit agy selects the agy adapter', () => {
    expect(pickAdapter({ adapter: 'agy' }).name).toBe('agy');
  });
});

describe('cli --background / --no-inline flag aliases', () => {
  test('--background sets detach (same slot as --detach/--bg/--no-wait)', () => {
    expect(parseFlags(['--background']).flags.detach).toBe(true);
    expect(parseFlags(['--detach']).flags.detach).toBe(true);
    expect(parseFlags(['--bg']).flags.detach).toBe(true);
    expect(parseFlags(['--no-wait']).flags.detach).toBe(true);
  });

  test('default: detach unset (submit blocks) and noInline unset (inline ON)', () => {
    const f = parseFlags(['--provider', 'agy']).flags;
    expect(f.detach).toBeUndefined();
    expect(f.noInline).toBeUndefined();
  });

  test('--no-inline opts out of inline deliverable rendering', () => {
    expect(parseFlags(['--no-inline']).flags.noInline).toBe(true);
  });
});
