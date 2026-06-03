// Orchestration for the `clean` CLI verb, lifted out of cli-spec.ts to keep
// that spec thin. Resolves the target/mode/window (pure helpers in
// clean-resolve.ts), runs the core (clean.ts), then best-effort refreshes the
// daemon so its cached handle picks up the rewritten file. Returns a plain
// summary the CLI formats — no printing here.

import { dirname } from 'node:path';
import { openDb } from './db.js';
import { cleanDb, type CleanResult, type CleaningMode } from './clean.js';
import { dbPath as toAbsDbPath, defaultDbPathForRepo } from './paths.js';
import { resolveCleanMode, resolveCleanTarget, resolveCleanWindow } from './clean-resolve.js';
import { refresh } from './client.js';
import type { LoadedConfig } from './config.js';

export interface RunCleanOpts {
  config: LoadedConfig;
  dbFlag?: string;
  modeFlag?: string;
  windowFlag?: string;
  host?: string;
  port?: number;
}

export interface RunCleanSummary extends CleanResult {
  ok: true;
  db: string;
  mode: CleaningMode;
  sweep: 'full' | 'windowed';
  daemonRefreshed: boolean;
}

export async function runClean(opts: RunCleanOpts): Promise<RunCleanSummary> {
  const { config } = opts;
  const repoRoot = config._repoRoot ?? process.cwd();

  const targetDb = resolveCleanTarget({
    dbFlag: opts.dbFlag,
    envDb: process.env.DIAG_DB,
    configDbResolved: config._dbPathResolved,
    configDbPath: config.dbPath,
    repoRoot,
    defaultForRepo: defaultDbPathForRepo(repoRoot),
    toAbs: toAbsDbPath,
  });
  const mode = resolveCleanMode({ flag: opts.modeFlag, configMode: config.cleaningMode });
  const windowMs = resolveCleanWindow(opts.windowFlag); // undefined → full sweep

  const db = openDb(targetDb);
  let result: CleanResult;
  try {
    result = cleanDb({ db, dbPath: targetDb, mode, logsDir: dirname(targetDb), windowMs });
  } finally {
    db.close();
  }

  // Stale-handle safety: we modified the file out-of-band, so a running daemon
  // still points at the old pages ("HTTP 200 but persists 0 rows", doc §8).
  // Best-effort POST /__refresh; no daemon → swallow.
  let daemonRefreshed = false;
  try {
    const r = await refresh({ host: opts.host ?? '127.0.0.1', port: opts.port ?? 7077 });
    daemonRefreshed = !!r?.ok;
  } catch {
    /* no daemon listening — fine */
  }

  return {
    ok: true,
    db: targetDb,
    mode,
    sweep: windowMs !== undefined ? 'windowed' : 'full',
    ...result,
    daemonRefreshed,
  };
}

export function formatCleanSummary(s: RunCleanSummary): string {
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1);
  return (
    `cleaned ${s.db}\n` +
    `  sweep=${s.sweep} mode=${s.mode} removed=${s.rowsRemoved}\n` +
    `  size ${mb(s.bytesBefore)}MB → ${mb(s.bytesAfter)}MB` +
    (s.archivePath ? `\n  archive ${s.archivePath}` : '') +
    `\n  daemonRefreshed=${s.daemonRefreshed}\n`
  );
}
