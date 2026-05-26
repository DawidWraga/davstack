// The ingest seam. Parse a raw Sentry envelope, stamp the SERVER recv_ts on
// every row (clock-skew safety — prune keys on this, not client ts), persist.
// Wrapped so it can never throw to the HTTP layer: a sink that 500s or hangs
// would block the app it is meant to observe (notes 03).

import type { Database } from 'bun:sqlite';
import { insertLogs, type LogRow } from './db.js';
import { parseEnvelope } from './envelope.js';

export function handleIngest(
  db: Database,
  rawBody: string,
  now: number = Date.now(),
): { accepted: number; skipped: number } {
  try {
    const { rows, skipped } = parseEnvelope(rawBody);
    const stamped: LogRow[] = rows.map((r) => ({ ...r, recv_ts: now }));
    const accepted = insertLogs(db, stamped);
    return { accepted, skipped };
  } catch {
    return { accepted: 0, skipped: 0 };
  }
}
