import { execFile, spawn } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

export const GENERATED_PEEK_FILE = '.folder-peek.generated.md';
const execFileAsync = promisify(execFile);

export type ScanOptions = {
  deep?: boolean;
  preset?: PeekOutputPresetName;
  indent?: boolean;
  filePaths?: PeekFilePathMode;
  file_paths?: PeekFilePathMode;
  includeLinesCount?: boolean;
  include_lines_count?: boolean;
};

type FileSummary = {
  path: string;
  kind: 'markdown' | 'typescript' | 'python';
  lines: number;
  items: string[];
};

export type PeekFilePathMode = 'concise' | 'full';
export type PeekOutputPresetName = 'agent' | 'human';

export type PeekOutputConfig = {
  deep: boolean;
  indent: boolean;
  filePaths: PeekFilePathMode;
  includeLinesCount: boolean;
};

export const PEEK_OUTPUT_PRESETS: Record<PeekOutputPresetName, PeekOutputConfig> = {
  human: {
    deep: true,
    indent: true,
    filePaths: 'full',
    includeLinesCount: true,
  },
  agent: {
    deep: true,
    indent: false,
    filePaths: 'concise',
    includeLinesCount: true,
  },
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

const SKIP_FILES = new Set([GENERATED_PEEK_FILE]);

export async function scanFolderPeek(folder: string, options: ScanOptions = {}): Promise<string> {
  const root = path.resolve(folder);
  const repoRoot = await findRepoRoot(root);
  const outputConfig = resolveOutputConfig(options);
  const fileLimit = createLimiter(64);
  const summary = await collectFolderSummary(
    root,
    repoRoot,
    root,
    outputConfig.deep,
    outputConfig,
    fileLimit,
  );

  return `${renderFolderSummary(summary, outputConfig)}\n`;
}

export async function generateFolderPeek(
  folder: string,
  options: ScanOptions = {},
): Promise<{ path: string; content: string }> {
  const root = path.resolve(folder);
  const content = await scanFolderPeek(root, options);
  const outPath = path.join(root, GENERATED_PEEK_FILE);
  await mkdir(root, { recursive: true });
  await writeFile(outPath, content, 'utf8');
  return { path: outPath, content };
}

export async function peekFolder(folder: string, options: ScanOptions = {}): Promise<string> {
  const root = path.resolve(folder);
  const generatedPath = path.join(root, GENERATED_PEEK_FILE);
  try {
    if (!options.deep && !hasOutputOverrides(options)) return await readFile(generatedPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return (await generateFolderPeek(root, options)).content;
}

async function collectFolderSummary(
  root: string,
  repoRoot: string,
  dir: string,
  deep: boolean,
  outputConfig: PeekOutputConfig,
  fileLimit: <T>(task: () => Promise<T>) => Promise<T>,
): Promise<FolderSummary> {
  const entries = await readdir(dir, { withFileTypes: true });
  const fileTasks: Array<Promise<{ name: string; summary: FileSummary | null }>> = [];
  const folderTasks: Array<Promise<FolderSummary>> = [];
  const omittedFiles: string[] = [];
  const ignoredPaths = await checkIgnoredPaths(root, entries.map((entry) => path.join(dir, entry.name)));

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(dir, entry.name);
    if (ignoredPaths.has(toPosix(path.relative(root, fullPath)))) continue;

    if (entry.isDirectory()) {
      if (!deep || shouldSkipDirectory(entry.name)) continue;
      folderTasks.push(collectFolderSummary(root, repoRoot, fullPath, deep, outputConfig, fileLimit));
      continue;
    }
    if (!entry.isFile() || shouldSkipFile(entry.name)) continue;

    fileTasks.push(
      fileLimit(async () => ({
        name: entry.name,
        summary: await summarizeFile(root, repoRoot, fullPath, outputConfig),
      })),
    );
  }

  const fileResults = await Promise.all(fileTasks);
  const files = fileResults
    .map((result) => result.summary)
    .filter((summary): summary is FileSummary => summary !== null);
  omittedFiles.push(
    ...fileResults
      .filter((result) => result.summary === null)
      .map((result) => result.name),
  );
  const folders = await Promise.all(folderTasks);

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

function renderFolderSummary(
  summary: FolderSummary,
  outputConfig: PeekOutputConfig,
  depth = 0,
): string {
  const indent = outputConfig.indent ? '\t'.repeat(Math.max(0, depth - 1)) : '';
  const childIndent = outputConfig.indent ? '\t'.repeat(depth) : '';
  const lines = [`${indent}<folder path="${escapeAttribute(summary.path)}">`];

  for (const file of summary.files) {
    const lineCount = outputConfig.includeLinesCount ? ` lines="${file.lines}"` : '';
    lines.push(`${childIndent}<file path="${escapeAttribute(file.path)}"${lineCount}>`);
    for (const item of file.items) {
      const prefix = item.startsWith('[ln ') ? '' : '- ';
      lines.push(`${childIndent}${prefix}${item}`);
    }
    lines.push(`${childIndent}</file>`);
  }

  for (const folder of summary.folders) {
    lines.push(renderFolderSummary(folder, outputConfig, depth + 1));
  }

  if (summary.omittedFiles.length > 0) {
    lines.push(`${childIndent}<omitted_files>`);
    for (const omittedFile of summary.omittedFiles) {
      lines.push(`${childIndent}- ${escapeText(omittedFile)}`);
    }
    lines.push(`${childIndent}</omitted_files>`);
  }

  lines.push(`${indent}</folder>`);
  return lines.join('\n');
}

async function summarizeFile(
  root: string,
  repoRoot: string,
  fullPath: string,
  outputConfig: PeekOutputConfig,
): Promise<FileSummary | null> {
  const extension = path.extname(fullPath);
  const relativePath = formatFilePath(root, repoRoot, fullPath, outputConfig.filePaths);

  if (extension === '.md' || extension === '.mdx') {
    const text = await readFile(fullPath, 'utf8');
    return {
      path: relativePath,
      kind: 'markdown',
      lines: countLines(text),
      items: extractMarkdownHeadings(text),
    };
  }
  if (isTypeScriptLikeFile(extension, fullPath)) {
    const text = await readFile(fullPath, 'utf8');
    return {
      path: relativePath,
      kind: 'typescript',
      lines: countLines(text),
      items: extractTypeScriptSymbols(text),
    };
  }
  if (extension === '.py') {
    const text = await readFile(fullPath, 'utf8');
    return {
      path: relativePath,
      kind: 'python',
      lines: countLines(text),
      items: extractPythonSymbols(text),
    };
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
  const items: Array<{ start: number; value: string }> = [];
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
      items.push({
        start: range.start,
        value: `${formatLineRange(range)} ${label} ${match[1]}`,
      });
    }
  }
  items.push(...extractTypeScriptTestCalls(source));
  return uniqueSortedItems(items);
}

function extractTypeScriptTestCalls(text: string): Array<{ start: number; value: string }> {
  const items: Array<{ start: number; value: string }> = [];
  const pattern = /^\s*(describe|test|it)\s*\(\s*(['"`])((?:\\.|(?!\2)[\s\S])*?)\2/gm;

  for (const match of text.matchAll(pattern)) {
    const callName = match[1];
    const quote = match[2];
    const title = match[3];
    const range = lineRangeForCallExpression(text, match.index ?? 0);
    items.push({
      start: range.start,
      value: `${formatLineRange(range)} ${callName}(${quote}${title}${quote})`,
    });
  }

  return items;
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

function uniqueSortedItems(items: Array<{ start: number; value: string }>): string[] {
  const seen = new Set<string>();
  return items
    .sort((a, b) => a.start - b.start || a.value.localeCompare(b.value))
    .filter((item) => {
      if (seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    })
    .map((item) => item.value);
}

function createLimiter(maxConcurrent: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function limit<T>(task: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
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

function lineRangeForCallExpression(text: string, index: number): { start: number; end: number } {
  const start = lineNumberAt(text, index);
  const openingParen = text.indexOf('(', index);
  if (openingParen === -1) return { start, end: start };

  const closingParen = findMatchingParen(text, openingParen);
  if (closingParen === -1) return { start, end: start };
  return { start, end: lineNumberAt(text, closingParen) };
}

function findMatchingParen(text: string, openingParen: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openingParen; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
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

function formatFilePath(
  root: string,
  repoRoot: string,
  fullPath: string,
  filePaths: PeekFilePathMode,
): string {
  if (filePaths === 'concise') return `/${path.basename(fullPath)}`;
  const base = isInsidePath(repoRoot, fullPath) ? repoRoot : root;
  return toPosix(path.relative(base, fullPath));
}

function resolveOutputConfig(options: ScanOptions): PeekOutputConfig {
  const presetName = options.preset ?? 'human';
  const preset = PEEK_OUTPUT_PRESETS[presetName];
  if (!preset) throw new Error(`Unknown peek output preset: ${presetName}`);

  return {
    deep: options.deep ?? preset.deep,
    indent: options.indent ?? preset.indent,
    filePaths: normalizeFilePathMode(options.filePaths ?? options.file_paths ?? preset.filePaths),
    includeLinesCount:
      options.includeLinesCount ?? options.include_lines_count ?? preset.includeLinesCount,
  };
}

function normalizeFilePathMode(value: PeekFilePathMode): PeekFilePathMode {
  if (value === 'concise' || value === 'full') return value;
  throw new Error(`Unknown peek file path mode: ${String(value)}`);
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  const newlineCount = text.match(/\r\n|\r|\n/g)?.length ?? 0;
  return newlineCount + (/(?:\r\n|\r|\n)$/.test(text) ? 0 : 1);
}

function hasOutputOverrides(options: ScanOptions): boolean {
  return (
    options.preset !== undefined ||
    options.indent !== undefined ||
    options.filePaths !== undefined ||
    options.file_paths !== undefined ||
    options.includeLinesCount !== undefined ||
    options.include_lines_count !== undefined
  );
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

async function checkIgnoredPaths(root: string, fullPaths: string[]): Promise<Set<string>> {
  const relativePaths = fullPaths
    .map((fullPath) => toPosix(path.relative(root, fullPath)))
    .filter((relativePath) => relativePath && !relativePath.startsWith('..'));

  if (relativePaths.length === 0) return new Set();

  return await new Promise((resolve) => {
    const child = spawn('git', ['-C', root, 'check-ignore', '--stdin'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let stdout = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('error', () => resolve(new Set()));
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        resolve(new Set());
        return;
      }
      resolve(new Set(stdout.split(/\r?\n/).filter(Boolean)));
    });

    child.stdin.end(relativePaths.join('\n'));
  });
}

async function findRepoRoot(root: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'rev-parse', '--show-toplevel']);
    return path.resolve(stdout.trim());
  } catch {
    return root;
  }
}
