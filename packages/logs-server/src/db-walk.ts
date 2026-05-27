// Enumerate every session DB file under `<repoRoot>/.davstack/logs/`.
// Used by the daemon's background prune tick and the `prune` CLI verb so
// "prune the logs" stays semantically global — same as the pre-2.0 single-DB
// behavior — without anyone tracking the live set of session names.

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DB_DIR } from './paths.js';

export function walkLogDbs(repoRoot: string): string[] {
  const root = join(repoRoot, DEFAULT_DB_DIR);
  const out: string[] = [];
  walk(root, out);
  return out;
}

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // dir doesn't exist yet — fine, nothing to prune
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(full, out);
    } else if (name.endsWith('.db')) {
      out.push(full);
    }
  }
}
