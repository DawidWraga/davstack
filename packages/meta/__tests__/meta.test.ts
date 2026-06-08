import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import {
  GENERATED_META_FILE,
  generateFolderMetadata,
  scanFolderMetadata,
  viewFolderMetadata,
} from '../src/index.js';

const execFileAsync = promisify(execFile);

async function makeTempFolder() {
  return await mkdtemp(path.join(os.tmpdir(), 'davstack-meta-'));
}

describe('scanFolderMetadata', () => {
  test('summarizes markdown headings and top-level code symbols in deterministic order', async () => {
    const root = await makeTempFolder();
    await writeFile(path.join(root, 'notes.md'), '# Overview\n\n## Details\n');
    await writeFile(
      path.join(root, 'sample.py'),
      'CONSTANT = 1\n\nclass Worker:\n    pass\n\ndef run():\n    pass\n',
    );
    await writeFile(
      path.join(root, 'tools.ts'),
      'export interface Config {}\nexport type Mode = "fast"\nexport const value = 1\nexport function build() {}\nclass LocalThing {}\n',
    );

    await expect(scanFolderMetadata(root)).resolves.toMatchInlineSnapshot(`
      "# Folder Metadata

      <folder path=".">
      <file path="notes.md" kind="markdown">
      - h1 Overview
      - h2 Details
      </file>
      <file path="sample.py" kind="python">
      - const CONSTANT
      - class Worker
      - function run
      </file>
      <file path="tools.ts" kind="typescript">
      - class LocalThing
      - interface Config
      - type Mode
      - const value
      - function build
      </file>
      </folder>
      "
    `);
  });

  test('skips generated metadata and default ignored folders', async () => {
    const root = await makeTempFolder();
    await writeFile(path.join(root, GENERATED_META_FILE), '# stale generated file\n');
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'node_modules', 'ignored.ts'), 'export const ignored = true\n');
    await writeFile(path.join(root, 'visible.ts'), 'export const visible = true\n');

    const metadata = await scanFolderMetadata(root, { deep: true });

    expect(metadata).toContain('path="visible.ts"');
    expect(metadata).toContain('const visible');
    expect(metadata).not.toContain(GENERATED_META_FILE);
    expect(metadata).not.toContain('ignored');
  });

  test('skips files ignored by git when scanning a git worktree', async () => {
    const root = await makeTempFolder();
    await execFileAsync('git', ['init'], { cwd: root });
    await writeFile(path.join(root, '.gitignore'), 'ignored.ts\n');
    await writeFile(path.join(root, 'ignored.ts'), 'export const ignored = true\n');
    await writeFile(path.join(root, 'visible.ts'), 'export const visible = true\n');

    const metadata = await scanFolderMetadata(root);

    expect(metadata).toContain('visible.ts');
    expect(metadata).not.toContain('ignored.ts');
    expect(metadata).not.toContain('const ignored');
  });
});

describe('generated folder metadata', () => {
  test('gen writes the generated metadata file in the scanned folder', async () => {
    const root = await makeTempFolder();
    await writeFile(path.join(root, 'README.md'), '# Root\n');

    const result = await generateFolderMetadata(root);

    expect(result.path).toBe(path.join(root, GENERATED_META_FILE));
    await expect(readFile(result.path, 'utf8')).resolves.toBe(result.content);
    expect(result.content).toContain('<file path="README.md" kind="markdown">');
  });

  test('view prints existing metadata, generating it when missing', async () => {
    const root = await makeTempFolder();
    await writeFile(path.join(root, GENERATED_META_FILE), '# Existing\n');

    await expect(viewFolderMetadata(root)).resolves.toBe('# Existing\n');

    const missing = await makeTempFolder();
    await writeFile(path.join(missing, 'README.md'), '# Created\n');

    const generated = await viewFolderMetadata(missing);
    expect(generated).toContain('h1 Created');
    await expect(readFile(path.join(missing, GENERATED_META_FILE), 'utf8')).resolves.toBe(generated);
  });

  test('deep scans child folders while the default view stays shallow', async () => {
    const root = await makeTempFolder();
    await mkdir(path.join(root, 'child'));
    await writeFile(path.join(root, 'root.ts'), 'export const rootValue = true\n');
    await writeFile(path.join(root, 'child', 'child.ts'), 'export const childValue = true\n');

    const shallow = await scanFolderMetadata(root);
    const deep = await scanFolderMetadata(root, { deep: true });

    expect(shallow).toContain('rootValue');
    expect(shallow).not.toContain('childValue');
    expect(deep).toContain('rootValue');
    expect(deep).toContain('child/child.ts');
    expect(deep).toContain('childValue');
  });
});
