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
  const repoRoot = await findRepoRoot(root);
  const summary = await collectFolderSummary(root, repoRoot, root, options.deep === true);

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
  repoRoot: string,
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
      folders.push(await collectFolderSummary(root, repoRoot, fullPath, deep));
      continue;
    }
    if (!entry.isFile() || shouldSkipFile(entry.name)) continue;

    const summary = await summarizeFile(root, repoRoot, fullPath);
    if (summary) {
      files.push(summary);
    } else {
      omittedFiles.push(entry.name);
    }
  }

  return {
    path: formatFolderPath(root, repoRoot, dir),
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    folders: folders.sort((a, b) => a.path.localeCompare(b.path)),
    omittedFiles: omittedFiles.sort((a, b) => a.localeCompare(b)),
  };
}

function formatFolderPath(root: string, repoRoot: string, dir: string): string {
  const base = isInsidePath(repoRoot, dir) ? repoRoot : root;
  const relativePath = toPosix(path.relative(base, dir));
  return relativePath || '.';
}

function renderFolderSummary(summary: FolderSummary, depth = 0): string[] {
  const indent = '\t'.repeat(Math.max(0, depth - 1));
  const childIndent = '\t'.repeat(depth);
  const lines = [`${indent}<folder path="${escapeAttribute(summary.path)}">`];

  for (const file of summary.files) {
    lines.push(`${childIndent}<file path="${escapeAttribute(file.path)}">`);
    for (const item of file.items) {
      const prefix = item.startsWith('[ln ') ? '' : '- ';
      lines.push(`${childIndent}${prefix}${item}`);
    }
    lines.push(`${childIndent}</file>`);
  }

  for (const folder of summary.folders) lines.push(...renderFolderSummary(folder, depth + 1));

  if (summary.omittedFiles.length > 0) {
    lines.push(`${childIndent}<omitted_files>`);
    for (const omittedFile of summary.omittedFiles) {
      lines.push(`${childIndent}- ${escapeText(omittedFile)}`);
    }
    lines.push(`${childIndent}</omitted_files>`);
  }

  lines.push(`${indent}</folder>`);
  return lines;
}

async function summarizeFile(root: string, repoRoot: string, fullPath: string): Promise<FileSummary | null> {
  const extension = path.extname(fullPath);
  const relativePath = formatFilePath(root, repoRoot, fullPath);

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
    for (const match of source.matchAll(pattern)) {
      const range = lineRangeForTypeScriptSymbol(source, match.index ?? 0);
      items.push(`${formatLineRange(range)} ${label} ${match[1]}`);
    }
  }
  return unique(items);
}

function extractPythonSymbols(text: string): string[] {
  const items: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    let match = /^class\s+([A-Za-z_]\w*)\s*[:(]/.exec(line);
    if (match) {
      items.push(`${formatLineRange(lineRangeForPythonBlock(lines, index))} class ${match[1]}`);
      continue;
    }
    match = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
    if (match) {
      items.push(`${formatLineRange(lineRangeForPythonBlock(lines, index))} function ${match[1]}`);
      continue;
    }
    match = /^([A-Z][A-Z0-9_]*)\s*[:=]/.exec(line);
    if (match) items.push(`${formatLineRange({ start: lineNumber, end: lineNumber })} const ${match[1]}`);
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
  return text.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\r\n]/g, ' '),
  );
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function lineNumberAt(text: string, index: number): number {
  let lineNumber = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (text.charCodeAt(offset) === 10) lineNumber += 1;
  }
  return lineNumber;
}

function lineRangeForTypeScriptSymbol(text: string, index: number): { start: number; end: number } {
  const start = lineNumberAt(text, index);
  const lineEnd = text.indexOf('\n', index);
  const declarationEnd = lineEnd === -1 ? text.length : lineEnd;
  const openingBrace = text.indexOf('{', index);

  if (openingBrace !== -1 && openingBrace < declarationEnd) {
    const closingBrace = findMatchingBrace(text, openingBrace);
    if (closingBrace !== -1) return { start, end: lineNumberAt(text, closingBrace) };
  }

  const semicolon = text.indexOf(';', index);
  if (semicolon !== -1 && semicolon < declarationEnd) {
    return { start, end: lineNumberAt(text, semicolon) };
  }

  return { start, end: start };
}

function findMatchingBrace(text: string, openingBrace: number): number {
  let depth = 0;
  for (let index = openingBrace; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function lineRangeForPythonBlock(
  lines: string[],
  startIndex: number,
): { start: number; end: number } {
  const startIndent = indentationLength(lines[startIndex] ?? '');
  let endIndex = startIndex;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      endIndex = index;
      continue;
    }
    if (indentationLength(line) <= startIndent) break;
    endIndex = index;
  }

  while (endIndex > startIndex && (lines[endIndex] ?? '').trim() === '') endIndex -= 1;
  return { start: startIndex + 1, end: endIndex + 1 };
}

function indentationLength(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0;
}

function formatLineRange(range: { start: number; end: number }): string {
  return range.start === range.end ? `[ln ${range.start}]` : `[ln ${range.start}-${range.end}]`;
}

function formatFilePath(root: string, repoRoot: string, fullPath: string): string {
  const base = isInsidePath(repoRoot, fullPath) ? repoRoot : root;
  return toPosix(path.relative(base, fullPath));
}

function isInsidePath(parent: string, child: string): boolean {
  const relativePath = path.relative(parent, child);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
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

async function findRepoRoot(root: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', '--show-toplevel']);
    return path.resolve(stdout.trim());
  } catch {
    return root;
  }
}
