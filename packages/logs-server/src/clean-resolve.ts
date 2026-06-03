// Pure decision helpers for the `clean` verb + the daemon's auto-clean timer:
// which db, which mode, full vs windowed sweep. Deliberately split out of
// clean.ts — clean.ts imports `bun:sqlite`, so its tests can only run under
// bun:test. These helpers touch no runtime, so keeping them here lets them be
// covered by the regular node/vitest suite (`pnpm test`).

import type { CleaningMode } from './clean.js';
import { parseDuration } from './duration.js';

export interface ResolveCleanTargetOpts {
  /** --db flag value (highest precedence). */
  dbFlag?: string;
  /** process.env.DIAG_DB. */
  envDb?: string;
  /** config._dbPathResolved (absolute) then config.dbPath (as-authored). */
  configDbResolved?: string;
  configDbPath?: string;
  /** join(repoRoot, '.davstack/logs/default.db') — injected to avoid a path dep here. */
  defaultForRepo: string;
  /** normalize a pinned path to absolute (paths.dbPath). */
  toAbs: (p: string) => string;
}

/**
 * Resolve the db path the `clean` verb operates on, mirroring `serve`'s
 * precedence: --db → DIAG_DB → config.dbPath → default-for-repo.
 */
export function resolveCleanTarget(opts: ResolveCleanTargetOpts): string {
  const pinned = opts.dbFlag || opts.envDb || opts.configDbResolved || opts.configDbPath;
  return pinned ? opts.toAbs(pinned) : opts.defaultForRepo;
}

/**
 * Resolve the cleaning mode. Throws on an explicit-but-invalid value so the CLI
 * surfaces it (rather than silently archiving when the user typed `delte`).
 */
export function resolveCleanMode(opts: { flag?: string; configMode?: CleaningMode }): CleaningMode {
  const raw = opts.flag ?? opts.configMode ?? 'archive';
  if (raw !== 'archive' && raw !== 'delete') {
    throw new Error(`invalid mode "${raw}" (expected archive|delete)`);
  }
  return raw;
}

/**
 * Resolve the sweep window: a `--window` string → ms (WINDOWED sweep); absence
 * → `undefined` (FULL sweep). Throws on a malformed window string.
 */
export function resolveCleanWindow(windowStr?: string): number | undefined {
  return windowStr ? parseDuration(windowStr) : undefined;
}
