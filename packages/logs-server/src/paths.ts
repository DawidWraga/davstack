// Where the per-repo DB files live. Default: `<repoRoot>/.davstack/logs/default.db`,
// with per-session siblings (`.davstack/logs/<name>.db`) created on demand.
// DIAG_DB pins an explicit file (used by tests and `--db`); DIAG_HOME /
// ~/.claude/diag is the global fallback when no repo root is in play.

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const DEFAULT_DB_FILENAME = 'default.db';
export const DEFAULT_DB_DIR = join('.davstack', 'logs');
export const LEGACY_DB_RELATIVE = join('.davstack', 'logs.db');

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

export function defaultDbPathForRepo(repoRoot: string): string {
  return join(repoRoot, DEFAULT_DB_DIR, DEFAULT_DB_FILENAME);
}

export function legacyDbPathForRepo(repoRoot: string): string {
  return join(repoRoot, LEGACY_DB_RELATIVE);
}

export function ensureParent(file: string): string {
  mkdirSync(dirname(file), { recursive: true });
  return file;
}
