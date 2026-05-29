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
import type { CliSpec, CommandSpec } from '@davstack/cli-utils';

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
//
// We deliberately emit a LEAN list, not an exhaustive table: command +
// required positionals + the one-line description, plus a single pointer to
// `--help` for the full flag set. Dumping every optional flag here is just
// noise — an agent can run `<server> <command> --help` when it actually needs
// a flag. Optional positionals, flags, and deprecated aliases are omitted.

// Only required positionals are surfaced (e.g. `run <file>`).
function requiredPositionals(node: CommandSpec): string {
  return (node.positionals ?? [])
    .filter((p) => p.required)
    .map((p) => `<${p.name}>`)
    .join(' ');
}

// Walk the command tree (like parseArgs/formatHelp descend through
// `commands`), emitting one entry per runnable leaf command. Commands whose
// description marks them deprecated are skipped — this is a curated surface,
// not a 1:1 mirror of every alias.
function collectCommands(
  node: CommandSpec,
  path: string[],
  out: { command: string; description: string }[],
): void {
  const children = node.commands ? Object.entries(node.commands) : [];
  const isRoot = path.length === 0;
  const deprecated = /deprecated/i.test(node.description ?? '');

  if (!isRoot && (node.run || children.length === 0) && !deprecated) {
    const pos = requiredPositionals(node);
    out.push({
      command: pos ? `${path.join(' ')} ${pos}` : path.join(' '),
      description: node.description ?? '',
    });
  }

  for (const [name, child] of children) {
    collectCommands(child, [...path, name], out);
  }
}

function renderList(spec: CliSpec): string {
  const cmds: { command: string; description: string }[] = [];
  collectCommands(spec, [], cmds);

  const lines: string[] = [];
  lines.push(`\`${spec.name}\` — ${spec.description ?? ''}`.trimEnd());
  lines.push('');
  for (const c of cmds) {
    lines.push(`- \`${spec.name} ${c.command}\` — ${c.description}`);
  }
  lines.push('');
  lines.push(
    `Run \`${spec.name} <command> --help\` for the full flags and options of any command.`,
  );
  return lines.join('\n');
}

function renderBlock(spec: CliSpec): string {
  // The marker comments bracket a fully generated region. Stable formatting
  // (no timestamps) keeps regeneration idempotent.
  return [BEGIN, '', renderList(spec), '', END].join('\n');
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
