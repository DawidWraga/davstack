// Generate a mechanical CLI-reference block into each daemon skill.
//
// Imports each daemon's side-effect-free `cliSpec` (from
// packages/<server>/src/cli-spec.ts), walks the command tree the same way
// cli-help.ts renders --help, and injects a markdown command-reference table
// into the matching skills/<server>/SKILL.md between generated markers.
//
// Run via tsx:  pnpm gen:skill-cli
//
// Idempotent: running twice yields no diff. The judgment prose in each
// SKILL.md is never touched — only the marked block is regenerated.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import type { CliSpec, CommandSpec, FlagSpec, Positional } from '@davstack/cli-utils';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const BEGIN = '<!-- BEGIN cli-reference (generated — do not edit by hand) -->';
const END = '<!-- END cli-reference -->';

type Target = { server: string; specPath: string; skillPath: string };

const targets: Target[] = ['logs-server', 'vitest-server', 'playwright-server'].map(
  (server) => ({
    server,
    specPath: join(repoRoot, 'packages', server, 'src', 'cli-spec.ts'),
    skillPath: join(repoRoot, 'skills', server, 'SKILL.md'),
  }),
);

// ─── rendering ────────────────────────────────────────────────────────────

function mdEscape(s: string): string {
  // Escape pipe so descriptions don't break the markdown table.
  return s.replace(/\|/g, '\\|');
}

// Some flags default to `process.cwd()` (resolved at spec-eval time). That's
// a machine-specific absolute path and would make the generated doc both
// non-deterministic and non-idempotent across checkouts. Normalize it to a
// stable placeholder so committed output is reproducible everywhere.
const CWD = process.cwd();

function renderDefault(value: unknown): string {
  if (typeof value === 'string' && value === CWD) return '`(current directory)`';
  return `\`${JSON.stringify(value)}\``;
}

function renderFlag(name: string, def: FlagSpec): string {
  // Mirror cli-help.ts formatFlag semantics: name, type, then meta
  // (default / env / required), then description.
  const meta: string[] = [];
  if (def.default !== undefined) meta.push(`default: ${renderDefault(def.default)}`);
  if (def.env) meta.push(`env: \`${def.env}\``);
  if (def.required) meta.push('required');
  const metaStr = meta.length ? ` (${meta.join(', ')})` : '';
  const desc = def.description ? ` — ${def.description}` : '';
  return `\`--${name} <${def.type}>\`${metaStr}${desc}`;
}

function renderPositional(p: Positional): string {
  const tag = p.required ? `\`<${p.name}>\`` : `\`[${p.name}]\``;
  const desc = p.description ? ` — ${p.description}` : '';
  return `${tag}${desc}`;
}

// Walk the command tree (like parseArgs/formatHelp descend through
// `commands`), emitting one table row per command that has a run handler or
// is a leaf. Path segments are joined with spaces.
function collectRows(
  node: CommandSpec,
  path: string[],
  rows: { command: string; description: string; args: string }[],
): void {
  const children = node.commands ? Object.entries(node.commands) : [];

  // Emit a row for this node if it is runnable or a leaf (no children).
  const isRoot = path.length === 0;
  if (!isRoot && (node.run || children.length === 0)) {
    rows.push({
      command: path.join(' '),
      description: node.description ?? '',
      args: renderArgs(node),
    });
  }

  for (const [name, child] of children) {
    collectRows(child, [...path, name], rows);
  }
}

function renderArgs(node: CommandSpec): string {
  const parts: string[] = [];
  for (const p of node.positionals ?? []) parts.push(renderPositional(p));
  for (const [name, def] of Object.entries(node.flags ?? {})) {
    parts.push(renderFlag(name, def));
  }
  if (parts.length === 0) return '';
  return parts.map(mdEscape).join('<br>');
}

function renderTable(spec: CliSpec): string {
  const rows: { command: string; description: string; args: string }[] = [];
  collectRows(spec, [], rows);

  const lines: string[] = [];
  lines.push(`\`${spec.name}\` — ${spec.description ?? ''}`.trimEnd());
  lines.push('');
  lines.push('| Command | Description | Positionals & flags |');
  lines.push('| --- | --- | --- |');
  for (const r of rows) {
    const cmd = `\`${spec.name} ${r.command}\``;
    lines.push(`| ${cmd} | ${mdEscape(r.description)} | ${r.args || '—'} |`);
  }
  return lines.join('\n');
}

function renderBlock(spec: CliSpec): string {
  // The marker comments bracket a fully generated region. Stable formatting
  // (no timestamps) keeps regeneration idempotent.
  return [BEGIN, '', renderTable(spec), '', END].join('\n');
}

// ─── injection ──────────────────────────────────────────────────────────

function injectBlock(source: string, block: string): string {
  const beginIdx = source.indexOf(BEGIN);
  const endIdx = source.indexOf(END);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    const before = source.slice(0, beginIdx);
    const after = source.slice(endIdx + END.length);
    return before + block + after;
  }

  // No markers yet: append a `## CLI reference` section at the end.
  const trimmed = source.replace(/\s+$/, '');
  return `${trimmed}\n\n## CLI reference\n\n${block}\n`;
}

// ─── main ─────────────────────────────────────────────────────────────────

async function main() {
  let changed = 0;
  for (const t of targets) {
    // Absolute paths must be file:// URLs for the ESM loader on Windows.
    const mod = (await import(pathToFileURL(t.specPath).href)) as { cliSpec: CliSpec };
    const spec = mod.cliSpec;
    const block = renderBlock(spec);
    const source = await readFile(t.skillPath, 'utf8');
    const next = injectBlock(source, block);
    if (next !== source) {
      await writeFile(t.skillPath, next, 'utf8');
      changed++;
      console.log(`updated ${t.skillPath}`);
    } else {
      console.log(`unchanged ${t.skillPath}`);
    }
  }
  console.log(`done (${changed} file(s) changed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
