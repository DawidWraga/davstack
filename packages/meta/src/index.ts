import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const GENERATED_META_FILE = '.folder-meta.generated.md';
const execFileAsync = promisify(execFile);

export type ScanOptions = {
  deep?: boolean;
};

type FileSummary = {
  path: string;
  kind: 'markdown' | 'typescript' | 'python';
  items: string[];
};

type FolderSummary = {
  path: string;
  files: FileSummary[];
  folders: FolderSummary[];
  omittedFiles: string[];
};

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'dist-ssr',
  'node_modules',
]);

const SKIP_FILES = new Set([GENERATED_META_FILE]);

export async function scanFolderMetadata(folder: string, options: ScanOptions = {}): Promise<string> {
  const root = path.resolve(folder);
  const summary = await collectFolderSummary(root, root, options.deep === true);

  const lines = ['# Folder Metadata', '', ...renderFolderSummary(summary), ''];
  return lines.join('\n');
}

export async function generateFolderMetadata(
  folder: string,
  options: ScanOptions = {},
): Promise<{ path: string; content: string }> {
  const root = path.resolve(folder);
  const content = await scanFolderMetadata(root, options);
  const outPath = path.join(root, GENERATED_META_FILE);
  await mkdir(root, { recursive: true });
  await writeFile(outPath, content, 'utf8');
  return { path: outPath, content };
}

export async function viewFolderMetadata(folder: string, options: ScanOptions = {}): Promise<string> {
  const root = path.resolve(folder);
  const generatedPath = path.join(root, GENERATED_META_FILE);
  try {
    if (!options.deep) return await readFile(generatedPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return (await generateFolderMetadata(root, options)).content;
}

async function collectFolderSummary(
  root: string,
  dir: string,
  deep: boolean,
): Promise<FolderSummary> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: FileSummary[] = [];
  const folders: FolderSummary[] = [];
  const omittedFiles: string[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(dir, entry.name);
    if (await isGitIgnored(root, fullPath)) continue;

    if (entry.isDirectory()) {
      if (!deep || shouldSkipDirectory(entry.name)) continue;
      folders.push(await collectFolderSummary(root, fullPath, deep));
      continue;
    }
    if (!entry.isFile() || shouldSkipFile(entry.name)) continue;

    const summary = await summarizeFile(root, fullPath);
    if (summary) {
      files.push(summary);
    } else {
      omittedFiles.push(entry.name);
    }
  }

  return {
    path: formatFolderPath(root, dir),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    folders: folders.sort((a, b) => a.path.localeCompare(b.path)),
    omittedFiles: omittedFiles.sort((a, b) => a.localeCompare(b)),
  };
}

function formatFolderPath(root: string, dir: string): string {
  const relativePath = toPosix(path.relative(root, dir));
  return relativePath ? `/${relativePath}` : '.';
}

function renderFolderSummary(summary: FolderSummary): string[] {
  const lines = [`<folder path="${escapeAttribute(summary.path)}">`];

  for (const file of summary.files) {
    lines.push(`<file path="${escapeAttribute(path.basename(file.path))}">`);
    for (const item of file.items) lines.push(`- ${item}`);
    lines.push('</file>');
  }

  if (summary.omittedFiles.length > 0) {
    lines.push('<omitted_files>');
    for (const omittedFile of summary.omittedFiles) {
      lines.push(`- ${escapeText(omittedFile)}`);
    }
    lines.push('</omitted_files>');
  }

  for (const folder of summary.folders) lines.push(...renderFolderSummary(folder));

  lines.push('</folder>');
  return lines;
}

async function summarizeFile(root: string, fullPath: string): Promise<FileSummary | null> {
  const extension = path.extname(fullPath);
  const relativePath = toPosix(path.relative(root, fullPath));

  if (extension === '.md' || extension === '.mdx') {
    const text = await readFile(fullPath, 'utf8');
    return { path: relativePath, kind: 'markdown', items: extractMarkdownHeadings(text) };
  }
  if (isTypeScriptLikeFile(extension, fullPath)) {
    const text = await readFile(fullPath, 'utf8');
    return { path: relativePath, kind: 'typescript', items: extractTypeScriptSymbols(text) };
  }
  if (extension === '.py') {
    const text = await readFile(fullPath, 'utf8');
    return { path: relativePath, kind: 'python', items: extractPythonSymbols(text) };
  }
  return null;
}

function isTypeScriptLikeFile(extension: string, fullPath: string): boolean {
  return ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs'].includes(extension) && !fullPath.endsWith('.d.ts');
}

function extractMarkdownHeadings(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => /^(#{1,6})\s+(.+?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => `h${match[1].length} ${match[2].replace(/\s+#+$/, '').trim()}`);
}

function extractTypeScriptSymbols(text: string): string[] {
  const items: string[] = [];
  const source = stripBlockComments(text);
  const patterns: Array<[RegExp, string]> = [
    [/^(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, 'class'],
    [/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm, 'interface'],
    [/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/gm, 'type'],
    [/^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm, 'const'],
    [
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
      'function',
    ],
  ];

  for (const [pattern, label] of patterns) {
    for (const match of source.matchAll(pattern)) items.push(`${label} ${match[1]}`);
  }
  return unique(items);
}

function extractPythonSymbols(text: string): string[] {
  const items: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    let match = /^class\s+([A-Za-z_]\w*)\s*[:(]/.exec(line);
    if (match) {
      items.push(`class ${match[1]}`);
      continue;
    }
    match = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
    if (match) {
      items.push(`function ${match[1]}`);
      continue;
    }
    match = /^([A-Z][A-Z0-9_]*)\s*[:=]/.exec(line);
    if (match) items.push(`const ${match[1]}`);
  }
  return unique(items);
}

function shouldSkipDirectory(name: string): boolean {
  return SKIP_DIRS.has(name);
}

function shouldSkipFile(name: string): boolean {
  return SKIP_FILES.has(name) || name.endsWith('.map');
}

function stripBlockComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '');
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

async function isGitIgnored(root: string, fullPath: string): Promise<boolean> {
  const relativePath = toPosix(path.relative(root, fullPath));
  if (!relativePath || relativePath.startsWith('..')) return false;

  try {
    await execFileAsync('git', ['-C', root, 'check-ignore', '--quiet', '--', relativePath]);
    return true;
  } catch (error) {
    const code = (error as { code?: number | string }).code;
    if (code === 1 || code === 128 || code === 'ENOENT') return false;
    return false;
  }
}
