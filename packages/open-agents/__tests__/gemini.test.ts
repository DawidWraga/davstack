// gemini adapter: tier map, --approval-mode arg construction, the delta-
// concatenating stream summarise (gemini has no result event), session-id
// extraction, and binary resolution (GEMINI_CLI_BIN precedence + the Windows
// npm-global node-entrypoint resolution). Plus the cli-level --provider /
// --adapter selection wiring.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  geminiAdapter,
  resolveBin,
  resolveGeminiEntry,
  summariseGemini,
} from '../src/adapters/gemini.js';
import { cursorAdapter } from '../src/adapters/cursor.js';
import { parseFlags, pickAdapter } from '../src/cli.js';

describe('gemini adapter — tier map', () => {
  test('smarter → 3-pro-preview, faster → 3.1-flash-lite-preview', () => {
    expect(geminiAdapter.tierModel('smarter')).toBe('gemini-3-pro-preview');
    expect(geminiAdapter.tierModel('faster')).toBe('gemini-3.1-flash-lite-preview');
  });
});

describe('gemini adapter — buildArgs', () => {
  // explore (ask) uses yolo, NOT plan: gemini's plan mode suppresses tool
  // execution so the model never reads and fabricates an answer. Read-only
  // is enforced by the profile prompt scaffold instead.
  test('ask mode → --approval-mode yolo (tools usable; never plan)', () => {
    const a = geminiAdapter.buildArgs({ model: 'gemini-3-flash-preview', mode: 'ask', prompt: 'P' });
    expect(a).toEqual([
      '-m',
      'gemini-3-flash-preview',
      '-o',
      'stream-json',
      '--approval-mode',
      'yolo',
      '-p',
      'P',
    ]);
    expect(a).not.toContain('plan');
  });

  test('force mode → --approval-mode yolo (edit auto-approve)', () => {
    const a = geminiAdapter.buildArgs({ model: 'gemini-3-pro-preview', mode: 'force', prompt: 'P' });
    expect(a).toEqual([
      '-m',
      'gemini-3-pro-preview',
      '-o',
      'stream-json',
      '--approval-mode',
      'yolo',
      '-p',
      'P',
    ]);
    expect(a).not.toContain('plan');
  });

  test('the multi-line prompt is a single trailing argv element (shell-free)', () => {
    const prompt = 'line1\nline2\n___FINAL_OUTPUT___\nanswer';
    const a = geminiAdapter.buildArgs({ model: 'm', mode: 'ask', prompt });
    expect(a[a.length - 2]).toBe('-p');
    expect(a[a.length - 1]).toBe(prompt);
  });
});

describe('gemini adapter — guardAddendum (flash explore line-verify)', () => {
  test('explore + default/faster tier → the cat -n line-verify directive', () => {
    const def = geminiAdapter.guardAddendum!('explore', undefined);
    expect(def).toContain('cat -n');
    expect(def).toContain('LINE NUMBERS');
    expect(geminiAdapter.guardAddendum!('explore', 'faster')).toBe(def);
  });

  test('explore + smarter (pro self-verifies) → no addendum', () => {
    expect(geminiAdapter.guardAddendum!('explore', 'smarter')).toBe('');
  });

  test('non-explore profile → no addendum regardless of tier', () => {
    expect(geminiAdapter.guardAddendum!('edit', undefined)).toBe('');
    expect(geminiAdapter.guardAddendum!('edit', 'faster')).toBe('');
  });

  test('cursor adapter contributes no addendum (optional, unimplemented)', () => {
    expect(cursorAdapter.guardAddendum).toBeUndefined();
  });
});

describe('gemini adapter — parse / summarise', () => {
  test('parseLine returns object, null for junk', () => {
    expect(geminiAdapter.parseLine('{"type":"init","session_id":"s1"}')).toEqual({
      type: 'init',
      session_id: 's1',
    });
    expect(geminiAdapter.parseLine('not json')).toBeNull();
    expect(geminiAdapter.parseLine('')).toBeNull();
  });

  test('summarise concatenates assistant deltas IN ORDER, skips user role', () => {
    const events = [
      { type: 'init', session_id: 's1', model: 'gemini-3.1-flash' },
      { type: 'message', role: 'user', content: 'IGNORE ME' },
      { type: 'message', role: 'assistant', content: '___FINAL', delta: true },
      { type: 'message', role: 'assistant', content: '_OUTPUT___\n', delta: true },
      { type: 'message', role: 'assistant', content: 'the answer', delta: true },
    ];
    const s = summariseGemini(events);
    // No spurious separators: delta chunks reconstruct the raw model text so
    // the SENTINEL stays a whole line for core.extractDeliverable.
    expect(s.summary).toBe('___FINAL_OUTPUT___\nthe answer');
    expect(s.summary).not.toContain('IGNORE ME');
    expect(s.success).toBe(true);
    expect(s.exitReason).toBe('completed');
  });

  test('summarise pulls filesChanged from write-ish tool_use, ignores reads', () => {
    const events = [
      {
        type: 'tool_use',
        tool_name: 'list_directory',
        parameters: { dir_path: '.' },
      },
      {
        type: 'tool_use',
        tool_name: 'write_file',
        parameters: { file_path: 'src/a.ts', content: 'x' },
      },
      {
        type: 'tool_use',
        tool_name: 'replace',
        parameters: { file_path: 'src/b.ts' },
      },
      { type: 'message', role: 'assistant', content: 'done', delta: true },
    ];
    const s = summariseGemini(events);
    expect(s.filesChanged.sort()).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('no assistant content → placeholder summary', () => {
    expect(summariseGemini([{ type: 'init', session_id: 's1' }]).summary).toBe(
      '(no final message captured)',
    );
  });

  test('error result event → success:false + the API message as exitReason', () => {
    // Verbatim shape from a real run with a bad model id (404).
    const events = [
      { type: 'init', session_id: 's1', model: 'gemini-3.1-flash' },
      { type: 'message', role: 'user', content: '<spec…>' },
      {
        type: 'result',
        status: 'error',
        error: { type: 'Error', message: '[API Error: Requested entity was not found.]' },
        stats: { total_tokens: 0 },
      },
    ];
    const s = summariseGemini(events);
    expect(s.success).toBe(false); // run loop ⇒ job 'failed', not silent 'done'
    expect(s.exitReason).toBe('[API Error: Requested entity was not found.]');
    expect(s.summary).toBe('(no final message captured)');
  });

  test('success result keeps success:true; deltas still win the summary', () => {
    const events = [
      { type: 'message', role: 'assistant', content: '___FINAL_OUTPUT___\nok', delta: true },
      { type: 'result', status: 'success', stats: { total_tokens: 5 } },
    ];
    const s = summariseGemini(events);
    expect(s.success).toBe(true);
    expect(s.exitReason).toBe('completed');
    expect(s.summary).toBe('___FINAL_OUTPUT___\nok');
  });

  test('result-carried text is the fallback when nothing streamed', () => {
    const s = summariseGemini([{ type: 'result', status: 'success', response: 'from-result' }]);
    expect(s.summary).toBe('from-result');
    expect(s.success).toBe(true);
  });

  test('extractChatId digs the session_id gemini puts on its init event', () => {
    const events = [geminiAdapter.parseLine('{"type":"init","session_id":"abc-123"}')].filter(
      Boolean,
    ) as any[];
    expect(geminiAdapter.extractChatId(events)).toBe('abc-123');
  });

  test('preSpawn/postExit are no-ops (gemini does not litter the repo)', () => {
    expect(geminiAdapter.preSpawn('/repo')).toBeNull();
    expect(() => geminiAdapter.postExit('/repo', null)).not.toThrow();
  });
});

describe('gemini adapter — resolveBin', () => {
  const origBin = process.env.GEMINI_CLI_BIN;
  afterEach(() => {
    if (origBin === undefined) delete process.env.GEMINI_CLI_BIN;
    else process.env.GEMINI_CLI_BIN = origBin;
  });

  test('GEMINI_CLI_BIN overrides everything: bin=env, no prelaunch, no shell', () => {
    process.env.GEMINI_CLI_BIN = 'C:/some/gemini-wrapper.exe';
    expect(resolveBin()).toEqual({
      bin: 'C:/some/gemini-wrapper.exe',
      prelaunchArgs: [],
      shell: false,
    });
  });

  test('no override → {bin, prelaunchArgs[], shell:false}; never a shell spawn', () => {
    delete process.env.GEMINI_CLI_BIN;
    const r = resolveBin();
    expect(typeof r.bin).toBe('string');
    expect(r.bin.length).toBeGreaterThan(0);
    expect(Array.isArray(r.prelaunchArgs)).toBe(true);
    expect(r.shell).toBe(false);
  });
});

describe('gemini adapter — resolveGeminiEntry (Windows npm-global root)', () => {
  const origAppData = process.env.APPDATA;
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'gemini-resolve-'));
    process.env.APPDATA = sandbox;
  });
  afterEach(() => {
    if (origAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = origAppData;
    rmSync(sandbox, { recursive: true, force: true });
  });

  test('null when APPDATA unset', () => {
    delete process.env.APPDATA;
    expect(resolveGeminiEntry()).toBeNull();
  });

  test('null when the package is not at the default npm root', () => {
    expect(resolveGeminiEntry()).toBeNull();
  });

  test('resolves …\\npm\\node_modules\\@google\\gemini-cli\\dist\\index.js', () => {
    const dist = join(sandbox, 'npm', 'node_modules', '@google', 'gemini-cli', 'dist');
    mkdirSync(dist, { recursive: true });
    const idx = join(dist, 'index.js');
    writeFileSync(idx, 'x');
    expect(resolveGeminiEntry()).toBe(idx);
  });

  test('win32 resolveBin with a resolvable install → node bin + index prelaunch', () => {
    if (process.platform !== 'win32') return; // win32-only resolution branch
    delete process.env.GEMINI_CLI_BIN;
    const dist = join(sandbox, 'npm', 'node_modules', '@google', 'gemini-cli', 'dist');
    mkdirSync(dist, { recursive: true });
    const idx = join(dist, 'index.js');
    writeFileSync(idx, 'x');
    expect(resolveBin()).toEqual({ bin: 'node', prelaunchArgs: [idx], shell: false });
  });
});

describe('cli --provider / --adapter selection', () => {
  test('--provider gemini and --provider=gemini both set the adapter', () => {
    expect(parseFlags(['--provider', 'gemini']).flags.adapter).toBe('gemini');
    expect(parseFlags(['--provider=gemini']).flags.adapter).toBe('gemini');
  });

  test('--adapter stays a working alias for --provider', () => {
    expect(parseFlags(['--adapter', 'gemini']).flags.adapter).toBe('gemini');
  });

  test('pickAdapter: explicit gemini selects the gemini adapter', () => {
    expect(pickAdapter({ adapter: 'gemini' }).name).toBe('gemini');
  });

  test('pickAdapter: unknown adapter falls back to default', () => {
    expect(pickAdapter({ adapter: 'nope' }).name).toBe(pickAdapter({}).name);
  });
});
