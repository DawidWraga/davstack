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
      <file path="notes.md">
      - h1 Overview
      - h2 Details
      </file>
      <file path="sample.py">
      [ln 1] const CONSTANT
      [ln 3-4] class Worker
      [ln 6-7] function run
      </file>
      <file path="tools.ts">
      [ln 5] class LocalThing
      [ln 1] interface Config
      [ln 2] type Mode
      [ln 3] const value
      [ln 4] function build
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

  test('summarizes js, mjs, and mdx files with existing extractors', async () => {
    const root = await makeTempFolder();
    await writeFile(path.join(root, 'component.mdx'), '# Component\n');
    await writeFile(path.join(root, 'script.js'), 'export function boot() {\n  return true\n}\n');
    await writeFile(path.join(root, 'module.mjs'), 'export const mode = {\n  format: "esm"\n}\n');

    const metadata = await scanFolderMetadata(root);

    expect(metadata).toContain('<file path="component.mdx">');
    expect(metadata).toContain('- h1 Component');
    expect(metadata).toContain('<file path="script.js">');
    expect(metadata).toContain('[ln 1-3] function boot');
    expect(metadata).toContain('<file path="module.mjs">');
    expect(metadata).toContain('[ln 1-3] const mode');
    expect(metadata).not.toContain('omitted_files');
  });

  test('wraps deep child folders and reports omitted files per folder', async () => {
    const root = await makeTempFolder();
    await mkdir(path.join(root, 'child', 'grandchild'), { recursive: true });
    await writeFile(path.join(root, 'root.ts'), 'export const rootValue = true\n');
    await writeFile(path.join(root, 'asset.png'), 'not code\n');
    await writeFile(path.join(root, 'child', 'child.py'), 'def child_function():\n    pass\n');
    await writeFile(path.join(root, 'child', 'data.json'), '{"hidden":true}\n');
    await writeFile(path.join(root, 'child', 'grandchild', 'notes.md'), '# Nested\n');

    await expect(scanFolderMetadata(root, { deep: true })).resolves.toMatchInlineSnapshot(`
      "# Folder Metadata

      <folder path=".">
      <file path="root.ts">
      [ln 1] const rootValue
      </file>
      <folder path="child">
      	<file path="child/child.py">
      	[ln 1-2] function child_function
      	</file>
      	<folder path="child/grandchild">
      		<file path="child/grandchild/notes.md">
      		- h1 Nested
      		</file>
      	</folder>
      	<omitted_files>
      	- data.json
      	</omitted_files>
      </folder>
      <omitted_files>
      - asset.png
      </omitted_files>
      </folder>
      "
    `);
  });

  test('uses git repo relative paths when scanning a nested folder', async () => {
    const root = await makeTempFolder();
    await execFileAsync('git', ['init'], { cwd: root });
    const scanRoot = path.join(root, 'apps', 'web');
    await mkdir(path.join(scanRoot, 'src'), { recursive: true });
    await writeFile(path.join(scanRoot, 'src', 'widget.ts'), 'export class Widget {}\n');

    await expect(scanFolderMetadata(scanRoot, { deep: true })).resolves.toMatchInlineSnapshot(`
      "# Folder Metadata

      <folder path="apps/web">
      <folder path="apps/web/src">
      	<file path="apps/web/src/widget.ts">
      	[ln 1] class Widget
      	</file>
      </folder>
      </folder>
      "
    `);
  });
});

describe('generated folder metadata', () => {
  test('gen writes the generated metadata file in the scanned folder', async () => {
    const root = await makeTempFolder();
    await writeFile(path.join(root, 'README.md'), '# Root\n');

    const result = await generateFolderMetadata(root);

    expect(result.path).toBe(path.join(root, GENERATED_META_FILE));
    await expect(readFile(result.path, 'utf8')).resolves.toBe(result.content);
    expect(result.content).toContain('<file path="README.md">');
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
    expect(deep).toContain('<folder path="child">');
    expect(deep).toContain('<file path="child/child.ts">');
    expect(deep).toContain('childValue');
  });
});
