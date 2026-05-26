// cursor adapter: arg construction, stream parse, chat-id, tier map, and
// binary resolution (the vendored node-entrypoint resolution + CURSOR_AGENT_BIN
// precedence — no shim, no shell spawn).

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cursorAdapter,
  resolveBin,
  resolveCursorAgentNode,
} from '../src/adapters/cursor.js';

describe('cursor adapter — tier map', () => {
  test('smarter → composer-2.5, faster → composer-2-fast', () => {
    expect(cursorAdapter.tierModel('smarter')).toBe('composer-2.5');
    expect(cursorAdapter.tierModel('faster')).toBe('composer-2-fast');
  });
});

describe('cursor adapter — buildArgs', () => {
  test('ask mode appends --mode ask, no --force (explore parity)', () => {
    const a = cursorAdapter.buildArgs({ model: 'composer-2.5', mode: 'ask', prompt: 'P' });
    expect(a).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--trust',
      '--model',
      'composer-2.5',
      '--mode',
      'ask',
      'P',
    ]);
  });

  test('force mode appends --force, no --mode ask (edit parity)', () => {
    const a = cursorAdapter.buildArgs({ model: 'composer-2.5', mode: 'force', prompt: 'P' });
    expect(a).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--trust',
      '--model',
      'composer-2.5',
      '--force',
      'P',
    ]);
  });
});

describe('cursor adapter — parse', () => {
  test('parseLine returns object, null for junk', () => {
    expect(cursorAdapter.parseLine('{"type":"result","result":"hi"}')).toEqual({
      type: 'result',
      result: 'hi',
    });
    expect(cursorAdapter.parseLine('not json')).toBeNull();
    expect(cursorAdapter.parseLine('')).toBeNull();
  });

  test('summarise extracts final text; filesChanged stays [] (golden baseline)', () => {
    const events = [
      cursorAdapter.parseLine('{"type":"assistant","message":{"text":"working"}}'),
      cursorAdapter.parseLine('{"type":"result","result":"___FINAL_OUTPUT___\\nanswer"}'),
    ].filter(Boolean) as any[];
    const s = cursorAdapter.summarise(events);
    expect(s.summary).toBe('___FINAL_OUTPUT___\nanswer');
    expect(s.filesChanged).toEqual([]);
    expect(s.success).toBe(true);
  });

  test('extractChatId digs out a session id', () => {
    const events = [
      cursorAdapter.parseLine('{"type":"system","session_id":"abc-123"}'),
    ].filter(Boolean) as any[];
    expect(cursorAdapter.extractChatId(events)).toBe('abc-123');
  });
});

describe('cursor adapter — resolveBin', () => {
  const origBin = process.env.CURSOR_AGENT_BIN;
  afterEach(() => {
    if (origBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = origBin;
  });

  test('CURSOR_AGENT_BIN overrides everything: bin=env, no prelaunch, no shell', () => {
    process.env.CURSOR_AGENT_BIN = 'C:/some/wrapper.exe';
    expect(resolveBin()).toEqual({
      bin: 'C:/some/wrapper.exe',
      prelaunchArgs: [],
      shell: false,
    });
  });

  test('CURSOR_AGENT_BIN takes precedence over the vendored node entrypoint', () => {
    // Even on a machine with a real cursor-agent install, the override wins.
    process.env.CURSOR_AGENT_BIN = 'D:/custom/cursor-agent-wrapper';
    const r = resolveBin();
    expect(r.bin).toBe('D:/custom/cursor-agent-wrapper');
    expect(r.prelaunchArgs).toEqual([]);
  });

  test('no override → {bin, prelaunchArgs[], shell:false}; never a shell spawn', () => {
    delete process.env.CURSOR_AGENT_BIN;
    const r = resolveBin();
    expect(typeof r.bin).toBe('string');
    expect(r.bin.length).toBeGreaterThan(0);
    expect(Array.isArray(r.prelaunchArgs)).toBe(true);
    // The shim/shell-spawn avenue is gone entirely.
    expect(r.shell).toBe(false);
  });
});

describe('cursor adapter — resolveCursorAgentNode (mirrors cursor-agent.ps1)', () => {
  const origLocalAppData = process.env.LOCALAPPDATA;
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'cursor-agent-resolve-'));
    process.env.LOCALAPPDATA = sandbox;
  });
  afterEach(() => {
    if (origLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = origLocalAppData;
    rmSync(sandbox, { recursive: true, force: true });
  });

  const mkVersion = (name: string, files: { node?: boolean; index?: boolean }) => {
    const dir = join(sandbox, 'cursor-agent', 'versions', name);
    mkdirSync(dir, { recursive: true });
    if (files.node) writeFileSync(join(dir, 'node.exe'), 'x');
    if (files.index) writeFileSync(join(dir, 'index.js'), 'x');
    return dir;
  };

  test('null when LOCALAPPDATA unset', () => {
    delete process.env.LOCALAPPDATA;
    expect(resolveCursorAgentNode()).toBeNull();
  });

  test('null when no cursor-agent dir exists', () => {
    expect(resolveCursorAgentNode()).toBeNull();
  });

  test('prefers node.exe+index.js sitting directly in the base dir', () => {
    const base = join(sandbox, 'cursor-agent');
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'node.exe'), 'x');
    writeFileSync(join(base, 'index.js'), 'x');
    // A version dir also exists — the direct hit must still win.
    mkVersion('2026.05.16-abc123', { node: true, index: true });
    const r = resolveCursorAgentNode();
    expect(r).toEqual({
      node: join(base, 'node.exe'),
      index: join(base, 'index.js'),
    });
  });

  test('picks the NEWEST valid versions dir by numeric YYYYMMDD', () => {
    mkVersion('2026.05.09-0afadcc', { node: true, index: true });
    mkVersion('2026.05.15-3f71873', { node: true, index: true });
    const newest = mkVersion('2026.05.16-0338208', { node: true, index: true });
    const r = resolveCursorAgentNode();
    expect(r).toEqual({
      node: join(newest, 'node.exe'),
      index: join(newest, 'index.js'),
    });
  });

  test('numeric (not lexical) date ordering: 2026.5.9 < 2026.05.16', () => {
    // Lexical "2026.5.9" > "2026.05.16"; numeric 20260509 < 20260516.
    mkVersion('2026.5.9-aaaaaaa', { node: true, index: true });
    const newer = mkVersion('2026.05.16-bbbbbbb', { node: true, index: true });
    expect(resolveCursorAgentNode()).toEqual({
      node: join(newer, 'node.exe'),
      index: join(newer, 'index.js'),
    });
  });

  test('skips a newer dir missing node.exe/index.js, falls to the next valid', () => {
    const valid = mkVersion('2026.05.15-3f71873', { node: true, index: true });
    mkVersion('2026.05.16-0338208', { node: true, index: false }); // newest but incomplete
    const r = resolveCursorAgentNode();
    expect(r).toEqual({
      node: join(valid, 'node.exe'),
      index: join(valid, 'index.js'),
    });
  });

  test('ignores non-version-shaped dirs and stray files in versions/', () => {
    mkdirSync(join(sandbox, 'cursor-agent', 'versions'), { recursive: true });
    writeFileSync(join(sandbox, 'cursor-agent', 'versions', 'random.zip'), 'x');
    mkdirSync(join(sandbox, 'cursor-agent', 'versions', 'not-a-version'));
    expect(resolveCursorAgentNode()).toBeNull();
  });

  test('null when every candidate dir is incomplete', () => {
    mkVersion('2026.05.16-0338208', { node: true, index: false });
    mkVersion('2026.05.15-3f71873', { node: false, index: true });
    expect(resolveCursorAgentNode()).toBeNull();
  });

  test('resolveBin on win32 with a resolvable install → node bin + index prelaunch', () => {
    if (process.platform !== 'win32') return; // win32-only resolution branch
    delete process.env.CURSOR_AGENT_BIN;
    const newest = mkVersion('2026.05.16-0338208', { node: true, index: true });
    expect(resolveBin()).toEqual({
      bin: join(newest, 'node.exe'),
      prelaunchArgs: [join(newest, 'index.js')],
      shell: false,
    });
  });
});
