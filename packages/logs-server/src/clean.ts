// The `clean` core. Pure functions over a bun:sqlite Database so the whole
// thing is TDD-able with temp DBs (no daemon, no HTTP). Two orthogonal axes
// (notes/multi-db 03 §3-§4):
//
//   sweep   : FULL (manual default — every row, ignores window) vs
//             WINDOWED (auto-clean — rows older than now-windowMs by recv_ts).
//   mode    : 'delete'  → DELETE the targeted rows, then VACUUM.
//             'archive' → write a self-contained .sql.br dump of the targeted
//                         rows FIRST, then DELETE, then VACUUM.
//
// Why VACUUM: SQLite DELETE leaves the freed pages in the file — 300 MB stays
// 300 MB until VACUUM rewrites it. VACUUM cannot run inside a transaction, so
// it runs on its own connection-level statement after the delete commits.
//
// Why hand-roll the SQL dump (vs `VACUUM INTO`): we archive a *subset* of rows
// (the windowed sweep), and we never shell out to a `sqlite3` binary (can't
// assume it exists). So we read the CREATE TABLE from sqlite_master and emit
// INSERT statements with values escaped to round-trip exactly. Compression is
// Node-stdlib Brotli — zero new dependency; the repetitive log payloads
// compress ~10-20×.

import type { Database } from 'bun:sqlite';
import { brotliCompressSync } from 'node:zlib';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseDuration } from './duration.js';

export type CleaningMode = 'archive' | 'delete';

export interface CleanDbOpts {
  /** Open handle to the hot DB being cleaned. */
  db: Database;
  /** Filesystem path of `db` — needed to stat the file size before/after. */
  dbPath: string;
  /** archive (lossless) or delete (drop). */
  mode: CleaningMode;
  /** Directory under which `archive/<ts>.sql.br` is written (archive mode). */
  logsDir: string;
  /**
   * WINDOWED sweep: remove rows with `recv_ts < now - windowMs`. Omit for a
   * FULL sweep (remove every row — the manual `clean` default).
   */
  windowMs?: number;
  /** Injectable clock for the window cutoff + archive filename. */
  now?: number;
}

export interface CleanResult {
  rowsRemoved: number;
  archivePath: string | null;
  bytesBefore: number;
  bytesAfter: number;
}

export function cleanDb(opts: CleanDbOpts): CleanResult {
  const { db, dbPath, mode, logsDir, windowMs } = opts;
  const now = opts.now ?? Date.now();
  // The DB runs in WAL mode, so recent rows live in the `-wal` sidecar and the
  // main file barely grows until a checkpoint folds them in. Checkpoint first
  // so `bytesBefore` reflects real on-disk size — otherwise the VACUUM shrink
  // (the whole point) is invisible in the before/after the CLI prints.
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* non-WAL DB or busy — size reporting is best-effort */
  }
  const bytesBefore = fileSize(dbPath);

  // WHERE clause selecting the targeted rows. FULL sweep targets everything.
  const cutoff = windowMs !== undefined ? now - windowMs : undefined;
  const where = cutoff !== undefined ? `WHERE recv_ts < ${cutoff}` : '';

  const rowsRemoved = (
    db.query(`SELECT count(*) c FROM logs ${where}`).get() as { c: number }
  ).c;

  if (rowsRemoved === 0) {
    return { rowsRemoved: 0, archivePath: null, bytesBefore, bytesAfter: bytesBefore };
  }

  let archivePath: string | null = null;
  if (mode === 'archive') {
    const sql = dumpRowsSql({ db, where });
    archivePath = writeArchive({ logsDir, now, sql });
  }

  // DELETE then VACUUM. VACUUM cannot run inside a transaction; the DELETE
  // auto-commits (no explicit BEGIN), so VACUUM is free to run next.
  db.exec(`DELETE FROM logs ${where}`);
  db.exec('VACUUM');
  // VACUUM in WAL mode writes the rewritten (smaller) DB through the WAL; the
  // main file isn't truncated until a checkpoint folds it back. Checkpoint so
  // the reclaim is realized on disk now (and `bytesAfter` reflects it).
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    /* best-effort */
  }

  return { rowsRemoved, archivePath, bytesBefore, bytesAfter: fileSize(dbPath) };
}

//* MARK: Dump

interface DumpRowsSqlOpts {
  db: Database;
  where: string;
}

/**
 * Emit a self-contained SQL text dump of the targeted rows: the CREATE TABLE
 * (read verbatim from sqlite_master) + one INSERT per row with values escaped
 * so they re-exec into an identical row (INTEGER/REAL/TEXT/NULL preserved).
 */
function dumpRowsSql(opts: DumpRowsSqlOpts): string {
  const { db, where } = opts;
  const createStmt = (
    db
      .query("SELECT sql FROM sqlite_master WHERE type='table' AND name='logs'")
      .get() as { sql: string } | null
  )?.sql;
  if (!createStmt) throw new Error('clean: logs table not found while dumping');

  const cols = (db.query('PRAGMA table_info(logs)').all() as { name: string }[]).map(
    (c) => c.name,
  );
  const colList = cols.map(quoteIdent).join(', ');

  const rows = db.query(`SELECT * FROM logs ${where} ORDER BY id`).all() as Record<
    string,
    unknown
  >[];

  const lines: string[] = [];
  lines.push('PRAGMA foreign_keys=OFF;');
  lines.push('BEGIN TRANSACTION;');
  lines.push(`${createStmt};`);
  for (const r of rows) {
    const values = cols.map((c) => sqlLiteral(r[c])).join(',');
    lines.push(`INSERT INTO logs (${colList}) VALUES (${values});`);
  }
  lines.push('COMMIT;');
  return lines.join('\n') + '\n';
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Uint8Array) {
    let hex = '';
    for (const b of value) hex += b.toString(16).padStart(2, '0');
    return `X'${hex}'`;
  }
  // TEXT — single-quote escaped.
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

//* MARK: Archive write

interface WriteArchiveOpts {
  logsDir: string;
  now: number;
  sql: string;
}

function writeArchive(opts: WriteArchiveOpts): string {
  const { logsDir, now, sql } = opts;
  const archiveDir = join(logsDir, 'archive');
  mkdirSync(archiveDir, { recursive: true });
  // Filesystem-safe + sortable: ISO with ':' → '-'.
  const stamp = new Date(now).toISOString().replace(/:/g, '-');
  const path = join(archiveDir, `${stamp}.sql.br`);
  writeFileSync(path, brotliCompressSync(Buffer.from(sql, 'utf8')));
  return path;
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

//* MARK: Auto-clean

export interface StartAutoCleanOpts {
  /** Sweep cadence string, e.g. "10m". */
  interval: string;
  /** Retention window string, e.g. "24h". */
  window: string;
  mode: CleaningMode;
  /** Absolute path of the daemon's default db. */
  dbPath: string;
  /**
   * Returns the daemon's OWN live handle for `dbPath` (the cache's handle), so
   * the timer never touches a stale connection — it's our connection.
   */
  getDb: () => Database;
  /** Test/inject points. */
  setIntervalFn?: typeof setInterval;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export interface AutoCleanHandle {
  stop: () => void;
}

/**
 * Daemon-owned auto-clean loop: every `interval`, run a WINDOWED sweep on the
 * daemon's own handle. A single in-flight guard prevents a slow VACUUM from
 * overlapping the next tick. Caller decides whether to start it (unset
 * interval → off) and must own pinned-mode exclusion.
 */
export function startAutoClean(opts: StartAutoCleanOpts): AutoCleanHandle {
  const intervalMs = parseDuration(opts.interval);
  const windowMs = parseDuration(opts.window);
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const logsDir = dirname(opts.dbPath);
  let sweeping = false;

  const timer = setIntervalFn(() => {
    if (sweeping) return; // overlap guard
    sweeping = true;
    try {
      const res = cleanDb({
        db: opts.getDb(),
        dbPath: opts.dbPath,
        mode: opts.mode,
        logsDir,
        windowMs,
      });
      if (res.rowsRemoved > 0) {
        opts.log?.(
          `auto-clean removed ${res.rowsRemoved} rows (${res.bytesBefore}→${res.bytesAfter} bytes)`,
        );
      }
    } catch (e) {
      opts.warn?.(`auto-clean failed: ${(e as Error)?.message ?? e}`);
    } finally {
      sweeping = false;
    }
  }, intervalMs);
  (timer as { unref?: () => void }).unref?.();

  return { stop: () => clearInterval(timer as ReturnType<typeof setInterval>) };
}
