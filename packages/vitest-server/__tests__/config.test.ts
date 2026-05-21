// Tests for the consumer-config loader. Mirrors playwright-server/auth.ts's
// shape: optional `vitest-server.config.ts` in CWD overrides defaults.

import { test, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.ts';

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop()!, { recursive: true, force: true });
});
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'vitest-srv-'));
  tmps.push(d);
  return d;
}

test('loadConfig returns defaults when no config file exists', async () => {
  const cfg = await loadConfig(tmp());
  expect(cfg).toEqual({ ...DEFAULT_CONFIG });
});

test('loadConfig merges user config with defaults', async () => {
  const cwd = tmp();
  writeFileSync(
    join(cwd, 'vitest-server.config.ts'),
    `export default { project: 'unit', primeFile: 'src/foo.test.ts' }`,
  );
  const cfg = await loadConfig(cwd);
  expect(cfg.project).toBe('unit');
  expect(cfg.primeFile).toBe('src/foo.test.ts');
});

test('loadConfig throws on malformed config', async () => {
  const cwd = tmp();
  writeFileSync(join(cwd, 'vitest-server.config.ts'), `this is not valid {`);
  await expect(loadConfig(cwd)).rejects.toThrow(/failed to load/);
});
