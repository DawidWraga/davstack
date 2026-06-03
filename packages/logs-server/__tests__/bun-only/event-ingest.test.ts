// Proves the WHOLE event pipe end-to-end, not just the parser: boot the REAL
// Bun ingest server, POST a REAL `{type:"event"}` envelope (captured live from
// @sentry/node 10.16.0 — the exact wire Sentry.captureException emits), then
// query the db and assert a kind='event' row landed with the full stacktrace
// intact. Before this feature these exception events were silently dropped.

import { test, expect } from 'bun:test';
import { openDb, type LogRow } from '../../src/db.js';
import { startServer } from '../../src/server.js';

// Verbatim exception-event envelope (header / item header / payload), as
// serialized by @sentry/node 10.16.0's transport.
const EVENT_ENVELOPE = [
  JSON.stringify({
    event_id: 'bcfa99a9ca694e69b484691dc8cf4f20',
    sdk: { name: 'sentry.javascript.node', version: '10.16.0' },
    trace: { trace_id: 'd7bb35a9330f4576938454c270be61b2', public_key: 'abc' },
  }),
  JSON.stringify({ type: 'event' }),
  JSON.stringify({
    exception: {
      values: [
        {
          type: 'TypeError',
          value: "Cannot read properties of undefined (reading 'id')",
          stacktrace: {
            frames: [
              { filename: 'src/server/handler.ts', function: 'loadUser', lineno: 42, colno: 9, in_app: true },
            ],
          },
          mechanism: { type: 'generic', handled: true },
        },
      ],
    },
    event_id: 'bcfa99a9ca694e69b484691dc8cf4f20',
    level: 'error',
    platform: 'node',
    contexts: {
      trace: { trace_id: 'd7bb35a9330f4576938454c270be61b2', span_id: '94a0c549144838cb' },
    },
    timestamp: 1780505594.791,
  }),
].join('\n');

test('end-to-end: a real exception event is ingested as a kind=event row with stacktrace', async () => {
  const db = openDb(':memory:');
  const srv = startServer({ db, port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/42/envelope/`, {
      method: 'POST',
      body: EVENT_ENVELOPE,
    });
    expect(res.status).toBe(200);

    const rows = db
      .query("SELECT * FROM logs WHERE kind = 'event'")
      .all() as LogRow[];
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.kind).toBe('event');
    expect(r.msg).toBe("TypeError: Cannot read properties of undefined (reading 'id')");
    expect(r.level).toBe('error');
    expect(r.severity_number).toBe(17);
    expect(r.trace_id).toBe('d7bb35a9330f4576938454c270be61b2');

    // the full stacktrace survived the whole HTTP→parse→persist pipe
    const data = JSON.parse(r.data) as Record<string, any>;
    expect(data.exception.values[0].stacktrace.frames[0].function).toBe('loadUser');
  } finally {
    srv.stop();
  }
});
