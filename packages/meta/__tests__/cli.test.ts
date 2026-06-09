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

  test('view supports agent preset and explicit output overrides', async () => {
    const root = await makeTempFolder();
    await mkdir(path.join(root, 'child'));
    await writeFile(path.join(root, 'child', 'child.ts'), 'export const childValue = true\n');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const code = await defineCli(cliSpec).run([
      'view',
      root,
      '--deep',
      '--agent',
      '--indent=true',
      '--file_paths=full',
    ]);

    expect(code).toBe(0);
    const output = log.mock.calls.map(([value]) => String(value)).join('\n');
    expect(output).toContain('\t<file path="child/child.ts">');
  });

  test('view rejects conflicting output presets', async () => {
    const root = await makeTempFolder();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    const code = await defineCli(cliSpec).run(['view', root, '--human', '--agent']);

    expect(code).toBe(1);
    expect(error.mock.calls.map(([value]) => String(value)).join('\n')).toContain(
      'Use only one output preset',
    );
  });
});
