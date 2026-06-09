import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineCli } from '@davstack/cli-utils';
import { GENERATED_META_FILE } from '../src/index.js';
import { cliSpec } from '../src/cli-spec.js';

async function makeTempFolder() {
  return await mkdtemp(path.join(os.tmpdir(), 'davstack-meta-cli-'));
}

describe('davstack-meta CLI', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('gen writes metadata and prints the generated file path', async () => {
    const root = await makeTempFolder();
    await writeFile(path.join(root, 'README.md'), '# CLI\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await defineCli(cliSpec).run(['gen', root]);

    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(path.join(root, GENERATED_META_FILE));
    await expect(readFile(path.join(root, GENERATED_META_FILE), 'utf8')).resolves.toContain(
      'h1 CLI',
    );
  });

  test('view prints existing metadata and supports deep generation', async () => {
    const root = await makeTempFolder();
    await mkdir(path.join(root, 'child'));
    await writeFile(path.join(root, 'README.md'), '# Root\n');
    await writeFile(path.join(root, 'child', 'child.ts'), 'export const childValue = true\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await defineCli(cliSpec).run(['view', root, '--deep']);

    expect(code).toBe(0);
    const output = log.mock.calls.map(([value]) => String(value)).join('\n');
    expect(output).toContain('h1 Root');
    expect(output).toContain('<folder path="child">');
    expect(output).toContain('<file path="child/child.ts">');
    expect(output).toContain('childValue');
  });
});
