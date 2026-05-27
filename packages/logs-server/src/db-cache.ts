// Per-path Database handle pool for the multi-DB ingest seam. Each unique
// absolute path opens at most one Database; subsequent ingests reuse it. An
// idle sweeper closes handles untouched for `idleCloseMs` — memory pressure
// is negligible (just a fd + WAL state) but unbounded growth would still bite
// a long-running daemon with thousands of one-off session DBs.
//
// Schema-boot is delegated to openDb() — every new DB file gets the same
// logs table + correlation index + logs_v view on first open, without any
// caller having to remember.

import type { Database } from 'bun:sqlite';
import { openDb } from './db.js';
import { ensureParent } from './paths.js';

const DEFAULT_IDLE_CLOSE_MS = 30 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type Entry = { db: Database; lastUsed: number };

export class DbHandleCache {
  private handles = new Map<string, Entry>();
  private readonly idleCloseMs: number;
  private timer?: ReturnType<typeof setInterval>;

  constructor(opts: { idleCloseMs?: number } = {}) {
    this.idleCloseMs = opts.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS;
  }

  getOrOpen(absPath: string): Database {
    const cached = this.handles.get(absPath);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached.db;
    }
    ensureParent(absPath);
    const db = openDb(absPath);
    this.handles.set(absPath, { db, lastUsed: Date.now() });
    return db;
  }

  startIdleSweeper(intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => this._sweepForTests(Date.now()), intervalMs);
    // unref so a hung daemon shutdown isn't blocked on the timer
    (this.timer as { unref?: () => void }).unref?.();
  }

  stopIdleSweeper(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  closeAll(): void {
    this.stopIdleSweeper();
    for (const [, entry] of this.handles) {
      try {
        entry.db.close();
      } catch {}
    }
    this.handles.clear();
  }

  _sweepForTests(now: number): void {
    const cutoff = now - this.idleCloseMs;
    for (const [path, entry] of this.handles) {
      if (entry.lastUsed < cutoff) {
        try {
          entry.db.close();
        } catch {}
        this.handles.delete(path);
      }
    }
  }

  _sizeForTests(): number {
    return this.handles.size;
  }
}
