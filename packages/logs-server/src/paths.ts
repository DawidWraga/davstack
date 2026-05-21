// Where the one shared DB lives. Mirrors cursor-jobs/paths.ts: a single
// global data home, env-overridable. DIAG_DB pins an explicit file (used by
// tests and `--db`); else DIAG_HOME or ~/.claude/diag/diag.sqlite.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export function dataHome(): string {
  const e = process.env.DIAG_HOME;
  if (e && e.trim().length > 0) return resolve(e);
  return join(homedir(), '.claude', 'diag');
}

export function dbPath(override?: string): string {
  if (override && override.trim()) return resolve(override);
  const env = process.env.DIAG_DB;
  if (env && env.trim()) return resolve(env);
  return join(dataHome(), 'diag.sqlite');
}

export function ensureParent(file: string): string {
  mkdirSync(dirname(file), { recursive: true });
  return file;
}
