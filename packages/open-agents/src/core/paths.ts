// Path resolution for job state. Data-home is ~/.davstack
// (override with OPEN_AGENTS_HOME). CURSOR_JOBS_HOME is honoured as a
// deprecated fallback for one release; the old ~/.cursor-jobs job state is
// ephemeral and is not migrated.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function dataHome(): string {
  const fromEnv = process.env.OPEN_AGENTS_HOME;
  if (fromEnv && fromEnv.trim().length > 0) return resolve(fromEnv);
  const legacy = process.env.CURSOR_JOBS_HOME; // deprecated; one-release grace
  if (legacy && legacy.trim().length > 0) return resolve(legacy);
  return join(homedir(), '.davstack');
}

// Stable 12-hex-char SHA-256 prefix of the repo's canonical absolute path.
export function repoHash(repoRoot: string): string {
  const canonical = existsSync(repoRoot) ? realpathSync(repoRoot) : resolve(repoRoot);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

export function jobsDir(repoRoot: string): string {
  return join(dataHome(), 'jobs', repoHash(repoRoot));
}

export function logsDir(repoRoot: string): string {
  return join(jobsDir(repoRoot), 'logs');
}

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}
