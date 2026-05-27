// The ingest seam. Parse a raw Sentry envelope, stamp the SERVER recv_ts on
// every row (clock-skew safety — prune keys on this, not client ts), persist.
// Wrapped so it can never throw to the HTTP layer: a sink that 500s or hangs
// would block the app it is meant to observe (notes 03).
//
// Two entry points:
//
//   handleIngest(db, raw, now)
//     Single-DB path — everything lands in `db`. Kept for tests and single-
//     handle callers; equivalent to `dispatchIngest(raw, { dispatch: () => db })`.
//
//   dispatchIngest(raw, { cache, defaultDbPath, repoRoot, warn? }, now)
//     Multi-DB path — each row's `davstack-logs.db` routing attribute is
//     validated and resolved (see db-route.ts), then the row is inserted into
//     the resolved file via the handle cache. Invalid / absent values fall
//     back to defaultDbPath.

import type { Database } from 'bun:sqlite';
import type { DbHandleCache } from './db-cache.js';
import { insertLogs, type LogRow } from './db.js';
import { resolveRoutedDb } from './db-route.js';
import { parseEnvelope, type ParsedLog } from './envelope.js';

export type IngestResult = { accepted: number; skipped: number };

export type DispatchContext = {
  cache: DbHandleCache;
  defaultDbPath: string;
  repoRoot: string;
  warn?: (msg: string) => void;
};

function stamp(rows: ParsedLog[], now: number): (LogRow & { routeDb?: string })[] {
  return rows.map((r) => ({ ...r, recv_ts: now }));
}

export function handleIngest(db: Database, rawBody: string, now: number = Date.now()): IngestResult {
  try {
    const { rows, skipped } = parseEnvelope(rawBody);
    const stamped = stamp(rows, now);
    const accepted = insertLogs(db, stamped);
    return { accepted, skipped };
  } catch {
    return { accepted: 0, skipped: 0 };
  }
}

export function dispatchIngest(
  rawBody: string,
  ctx: DispatchContext,
  now: number = Date.now(),
): IngestResult {
  try {
    const { rows, skipped } = parseEnvelope(rawBody);
    const stamped = stamp(rows, now);

    // Group by resolved DB path. One bad row in a batch must not affect
    // routing for the rest — each is classified independently.
    const groups = new Map<string, LogRow[]>();
    for (const r of stamped) {
      const target = resolveTarget(r.routeDb, ctx);
      const batch = groups.get(target) ?? [];
      batch.push(stripInternal(r));
      groups.set(target, batch);
    }

    let accepted = 0;
    for (const [path, batch] of groups) {
      const db = ctx.cache.getOrOpen(path);
      accepted += insertLogs(db, batch);
    }
    return { accepted, skipped };
  } catch {
    return { accepted: 0, skipped: 0 };
  }
}

function resolveTarget(routeDb: string | undefined, ctx: DispatchContext): string {
  if (!routeDb) return ctx.defaultDbPath;
  const r = resolveRoutedDb(routeDb, ctx.repoRoot, { warn: ctx.warn });
  return r.ok ? r.path : ctx.defaultDbPath;
}

function stripInternal(row: LogRow & { routeDb?: string }): LogRow {
  const { routeDb: _drop, ...rest } = row;
  void _drop;
  return rest;
}
