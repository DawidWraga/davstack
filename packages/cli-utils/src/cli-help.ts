// Plain-text help formatter for the CLI helper. Kept layout-loose on
// purpose — tests assert content, not whitespace, so the visual can evolve.

import type { CliSpec, CommandSpec, FlagSpec, Positional } from './cli.ts';

export function formatHelp(commandPath: string[], spec: CliSpec): string {
  // Walk to the node we're describing.
  let node: CommandSpec = spec;
  for (const seg of commandPath) {
    const next = node.commands?.[seg];
    if (!next) break;
    node = next;
  }
  const title = [spec.name, ...commandPath].join(' ');
  const lines: string[] = [];
  lines.push(title);
  const desc = node.description ?? (commandPath.length === 0 ? spec.description : undefined);
  if (desc) lines.push(`  ${desc}`);
  lines.push('');

  const usageBits = ['Usage:', title];
  if (node.commands && Object.keys(node.commands).length) usageBits.push('<command>');
  if (node.flags && Object.keys(node.flags).length) usageBits.push('[flags]');
  for (const p of node.positionals ?? []) {
    usageBits.push(p.required ? `<${p.name}>` : `[${p.name}]`);
  }
  lines.push(`  ${usageBits.join(' ')}`);
  lines.push('');

  if (node.positionals && node.positionals.length) {
    lines.push('Positionals:');
    for (const p of node.positionals) lines.push(formatPositional(p));
    lines.push('');
  }

  if (node.flags && Object.keys(node.flags).length) {
    lines.push('Flags:');
    for (const [name, def] of Object.entries(node.flags)) {
      lines.push(formatFlag(name, def));
    }
    lines.push('');
  }

  if (node.commands && Object.keys(node.commands).length) {
    lines.push('Commands:');
    for (const [name, cmd] of Object.entries(node.commands)) {
      const d = cmd.description ? `  ${cmd.description}` : '';
      lines.push(`  ${name}${d}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatPositional(p: Positional): string {
  const tag = p.required ? '(required)' : '';
  const desc = p.description ?? '';
  return `  ${p.name}  ${tag}  ${desc}`.trimEnd();
}

function formatFlag(name: string, def: FlagSpec): string {
  const bits: string[] = [];
  bits.push(`--${name}`);
  bits.push(`<${def.type}>`);
  const meta: string[] = [];
  if (def.default !== undefined) meta.push(`default: ${JSON.stringify(def.default)}`);
  if (def.env) meta.push(`env: ${def.env}`);
  if (def.required) meta.push('required');
  const metaStr = meta.length ? `(${meta.join(', ')})` : '';
  const desc = def.description ?? '';
  return `  ${bits.join(' ')}  ${desc}  ${metaStr}`.trimEnd();
}
