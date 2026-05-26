// Auto-load `.env` for daemons launched outside a dotenv-aware shell.
//
// Daemons started via `npx <name> serve` (or from a long-lived TUI host)
// otherwise see an empty process.env for user-scoped vars like
// E2E_USER_EMAIL — breaking config files that read process.env at boot.
// This walks up from the daemon's cwd to the first `.env` and folds it in
// without overriding already-set values (dotenv default semantics).
//
// Opt out with `DAVSTACK_NO_DOTENV=1` (CI / explicit-env environments).

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { findRepoRoot } from './config.js';

export type LoadDotenvResult =
  | { loaded: true; path: string; keys: number }
  | { loaded: false; reason: 'disabled' | 'not-found' | 'parse-error'; error?: string };

export type LoadDotenvOptions = {
  /** Starting directory for the walk-up. Defaults to process.cwd(). */
  cwd?: string;
  /** Override DAVSTACK_NO_DOTENV check (mainly for tests). */
  forceEnabled?: boolean;
  /** Hard cap on directories walked. Defaults to 8. */
  maxDepth?: number;
};

/**
 * Walk up from `cwd` looking for a `.env` file. Stops at the first match or
 * at the repo root (whichever comes first); also bounded by `maxDepth` to
 * avoid surprises on pathological mounts.
 *
 * Returns the absolute path, or `null` if nothing was found.
 */
export function findDotenv(
  cwd: string = process.cwd(),
  maxDepth = 8,
): string | null {
  const start = resolve(cwd);
  const root = findRepoRoot(start);
  let cur = start;
  for (let depth = 0; depth <= maxDepth; depth++) {
    const candidate = join(cur, '.env');
    if (existsSync(candidate)) {
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // unreadable — keep walking
      }
    }
    if (cur === root) break;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

/**
 * Locate and load `.env` into process.env. Existing keys are preserved
 * (explicit env wins). Returns a structured result so the caller can emit a
 * single, agent-friendly startup log line.
 *
 * Opt-out: setting `DAVSTACK_NO_DOTENV=1` skips the load entirely.
 */
export async function loadDotenv(
  opts: LoadDotenvOptions = {},
): Promise<LoadDotenvResult> {
  const enabled = opts.forceEnabled ?? process.env.DAVSTACK_NO_DOTENV !== '1';
  if (!enabled) return { loaded: false, reason: 'disabled' };

  const path = findDotenv(opts.cwd, opts.maxDepth);
  if (!path) return { loaded: false, reason: 'not-found' };

  let dotenv: typeof import('dotenv');
  try {
    dotenv = await import('dotenv');
  } catch (e) {
    return {
      loaded: false,
      reason: 'parse-error',
      error: `dotenv module not installed: ${(e as Error)?.message ?? e}`,
    };
  }

  const result = dotenv.config({ path, override: false, quiet: true });
  if (result.error) {
    return { loaded: false, reason: 'parse-error', error: result.error.message };
  }
  const keys = Object.keys(result.parsed ?? {}).length;
  return { loaded: true, path, keys };
}
