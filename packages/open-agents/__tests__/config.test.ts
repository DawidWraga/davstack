// Config loader for @davstack/open-agents — verifies the merge precedence
// (flag > config > built-in) and the validation that bad config values are
// silently dropped rather than poisoning runtime defaults.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';

describe('loadConfig — no config file present', () => {
  let sandbox: string;
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'oa-cfg-none-'));
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test('returns empty config with _repoRoot but no _source', async () => {
    const cfg = await loadConfig(sandbox);
    expect(cfg._source).toBeUndefined();
    expect(cfg._repoRoot).toBeTruthy();
    expect(cfg.defaultModel).toBeUndefined();
    expect(cfg.defaultAdapter).toBeUndefined();
    expect(cfg.defaultTimeoutSec).toBeUndefined();
  });
});

describe('loadConfig — .davstack/config/open-agents.config.ts present', () => {
  let sandbox: string;
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'oa-cfg-'));
    // Make this dir look like a repo root so findRepoRoot stops walking up.
    writeFileSync(join(sandbox, 'package.json'), JSON.stringify({ workspaces: ['x'] }));
    mkdirSync(join(sandbox, '.davstack', 'config'), { recursive: true });
  });
  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test('reads valid fields', async () => {
    writeFileSync(
      join(sandbox, '.davstack', 'config', 'open-agents.config.ts'),
      `export default {
        defaultModel: 'composer-2-fast',
        defaultAdapter: 'cursor',
        defaultTimeoutSec: 900,
      }`,
    );
    const cfg = await loadConfig(sandbox);
    expect(cfg.defaultModel).toBe('composer-2-fast');
    expect(cfg.defaultAdapter).toBe('cursor');
    expect(cfg.defaultTimeoutSec).toBe(900);
    expect(cfg._source).toContain('open-agents.config.ts');
  });

  test('drops invalid defaultAdapter (typo) silently', async () => {
    writeFileSync(
      join(sandbox, '.davstack', 'config', 'open-agents.config.ts'),
      `export default { defaultAdapter: 'cursorr' }`,
    );
    const cfg = await loadConfig(sandbox);
    expect(cfg.defaultAdapter).toBeUndefined();
  });

  test('drops non-positive defaultTimeoutSec', async () => {
    writeFileSync(
      join(sandbox, '.davstack', 'config', 'open-agents.config.ts'),
      `export default { defaultTimeoutSec: 0 }`,
    );
    const cfg = await loadConfig(sandbox);
    expect(cfg.defaultTimeoutSec).toBeUndefined();
  });

  test('drops wrong-typed defaultModel', async () => {
    writeFileSync(
      join(sandbox, '.davstack', 'config', 'open-agents.config.ts'),
      `export default { defaultModel: 42 }`,
    );
    const cfg = await loadConfig(sandbox);
    expect(cfg.defaultModel).toBeUndefined();
  });

  test('preserves profiles object as-authored', async () => {
    writeFileSync(
      join(sandbox, '.davstack', 'config', 'open-agents.config.ts'),
      `export default {
        profiles: {
          explore: { systemPromptExtension: 'cite path:line' },
          edit: { systemPromptExtension: 'no gen-api/' },
        }
      }`,
    );
    const cfg = await loadConfig(sandbox);
    expect(cfg.profiles?.explore?.systemPromptExtension).toBe('cite path:line');
    expect(cfg.profiles?.edit?.systemPromptExtension).toBe('no gen-api/');
  });
});
