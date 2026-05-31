// RED first. The Sentry log-envelope parser — the part we deliberately OWN
// (notes 03: fully Sentry-coupled, tiny TOLERANT parser, unknown -> raw blob,
// never throw to the caller = "sink down/garbage in must not crash the app").
// Fixtures are built from the authoritative wire spec in notes 03 (3-line
// NDJSON envelope; log item `{value,type}` attributes; native `items[]`
// batch) so this is a faithful contract, not a shallow seam.

import { test, expect } from 'vitest';
import { parseEnvelope } from '../src/envelope.js';

const a = (value: unknown, type = 'string') => ({ value, type });

function log(over: Record<string, unknown> = {}) {
  return {
    timestamp: 1544719860.0,
    trace_id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    span_id: 'bbbbbbbbbbbbbbbb',
    level: 'info',
    body: 'User John has logged in!',
    severity_number: 9,
    attributes: {
      'sentry.origin': a('auto.http.server'),
      'sentry.message.template': a('User %s has logged in!'),
      'sentry.message.parameter.0': a('John'),
      'diag.project': a('traffease_man'),
      'diag.run_id': a('eval-run-42'),
      'diag.tag': a('H3'),
    },
    ...over,
  };
}

// 3-line NDJSON: envelope header, item header, item payload.
function envelope(items: unknown[], sdkName = 'sentry.python') {
  return [
    JSON.stringify({ sdk: { name: sdkName, version: '2.43.0' } }),
    JSON.stringify({
      type: 'log',
      item_count: items.length,
      content_type: 'application/vnd.sentry.items.log+json',
    }),
    JSON.stringify({ items }),
  ].join('\n');
}

test('parses a well-formed single-log envelope with full field mapping', () => {
  const { rows, skipped } = parseEnvelope(envelope([log()]));
  expect(skipped).toBe(0);
  expect(rows).toHaveLength(1);
  const r = rows[0];
  expect(r.ts).toBe(1544719860.0);
  expect(r.trace_id).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  expect(r.span_id).toBe('bbbbbbbbbbbbbbbb');
  expect(r.level).toBe('info');
  expect(r.severity_number).toBe(9);
  expect(r.msg).toBe('User John has logged in!');
  expect(r.service).toBe('sentry.python'); // from envelope sdk.name
  expect(r.logger).toBe('auto.http.server'); // from sentry.origin attr
  expect(r.project).toBe('traffease_man'); // from diag.project attr
  expect(r.run_id).toBe('eval-run-42'); // from diag.run_id attr
  expect(r.tag).toBe('H3'); // from diag.tag attr
  // `data` is the raw log record, verbatim (round-trips deep-equal).
  expect(JSON.parse(r.data)).toEqual(log());
});

test('honors the native items[] batch, in order', () => {
  const { rows } = parseEnvelope(
    envelope([log({ body: 'first' }), log({ body: 'second' }), log({ body: 'third' })]),
  );
  expect(rows.map((r) => r.msg)).toEqual(['first', 'second', 'third']);
});

test('missing optional fields default sanely; data still verbatim', () => {
  const bare = { timestamp: 1.0, trace_id: 'c'.repeat(32), level: 'debug', body: 'x' };
  const { rows, skipped } = parseEnvelope(envelope([bare]));
  expect(skipped).toBe(0);
  const r = rows[0];
  expect(r.span_id).toBe('');
  expect(r.severity_number).toBe(0);
  expect(r.logger).toBe('');
  expect(r.project).toBe('');
  expect(r.run_id).toBe('');
  expect(r.tag).toBeNull();
  expect(JSON.parse(r.data)).toEqual(bare);
});

test('tolerant: non-log items ignored, malformed lines skipped, never throws', () => {
  // envelope header, an `event` item (header+payload), a `log` item, then a
  // malformed trailing line. Only the log records parse; nothing throws.
  const raw = [
    JSON.stringify({ sdk: { name: 'sentry.javascript.browser', version: '9.41.0' } }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify({ message: 'an error event, not a log' }),
    JSON.stringify({ type: 'log', item_count: 1, content_type: 'application/vnd.sentry.items.log+json' }),
    JSON.stringify({ items: [log({ body: 'the real log' })] }),
    '{ this is not json',
  ].join('\n');
  let result: ReturnType<typeof parseEnvelope> | undefined;
  expect(() => {
    result = parseEnvelope(raw);
  }).not.toThrow();
  expect(result!.rows.map((r) => r.msg)).toEqual(['the real log']);
  expect(result!.rows[0].service).toBe('sentry.javascript.browser');
  expect(result!.skipped).toBeGreaterThanOrEqual(1); // the malformed line
});

test('empty / whitespace body never throws and yields nothing', () => {
  for (const raw of ['', '\n', '   \n  ']) {
    const { rows, skipped } = parseEnvelope(raw);
    expect(rows).toHaveLength(0);
    expect(skipped).toBe(0);
  }
});

// Multi-DB routing: the `davstack-logs.db` attribute is the wire that tells the
// daemon which file to drop the row into. It is consumed by the dispatch loop
// and stripped before persistence — the DB file is the session indicator, and
// nothing inside the row should record which bucket it landed in.

test('surfaces the davstack-logs.db attribute as routeDb', () => {
  const { rows } = parseEnvelope(
    envelope([log({ attributes: { 'davstack-logs.db': a('reorder-bug') } })]),
  );
  expect(rows[0].routeDb).toBe('reorder-bug');
});

test('strips the davstack-logs.db attribute from persisted data', () => {
  const { rows } = parseEnvelope(
    envelope([
      log({
        body: 'p',
        attributes: {
          'davstack-logs.db': a('reorder-bug'),
          'diag.project': a('proj'),
          'diag.run_id': a('r-1'),
        },
      }),
    ]),
  );
  const persisted = JSON.parse(rows[0].data) as { attributes: Record<string, unknown> };
  expect(persisted.attributes['davstack-logs.db']).toBeUndefined();
  expect(persisted.attributes['diag.project']).toEqual(a('proj'));
  expect(persisted.attributes['diag.run_id']).toEqual(a('r-1'));
});

test('routeDb is undefined when no attribute is set (back-compat baseline)', () => {
  const { rows } = parseEnvelope(envelope([log()]));
  expect(rows[0].routeDb).toBeUndefined();
});

// attrs is computed at parse time. Stored as JSON text: OTel {value,type}
// wrapper stripped, NULL when no attributes are present.

test('attrs flattens the OTel {value,type} wrapper to plain key→value', () => {
  const { rows } = parseEnvelope(envelope([log()]));
  expect(rows[0].attrs).not.toBeNull();
  const flat = JSON.parse(rows[0].attrs as string) as Record<string, unknown>;
  expect(flat['sentry.origin']).toBe('auto.http.server');
  expect(flat['diag.project']).toBe('traffease_man');
  expect(flat['diag.run_id']).toBe('eval-run-42');
  expect(flat['diag.tag']).toBe('H3');
});

test('attrs is NULL when the record has no attributes block', () => {
  const bare = { timestamp: 1.0, trace_id: 'c'.repeat(32), level: 'debug', body: 'x' };
  const { rows } = parseEnvelope(envelope([bare]));
  expect(rows[0].attrs).toBeNull();
});

test('attrs is NULL for an empty attributes object (matches old view CASE)', () => {
  const { rows } = parseEnvelope(envelope([log({ attributes: {} })]));
  expect(rows[0].attrs).toBeNull();
});

test('attrs excludes the davstack-logs.db routing key', () => {
  const { rows } = parseEnvelope(
    envelope([
      log({
        attributes: {
          'davstack-logs.db': a('reorder-bug'),
          seam: a('after-fetch'),
        },
      }),
    ]),
  );
  const flat = JSON.parse(rows[0].attrs as string) as Record<string, unknown>;
  expect(flat['davstack-logs.db']).toBeUndefined();
  expect(flat.seam).toBe('after-fetch');
});

//* MARK: Transactions (spans)

// Trace ingestion. The fixture below was captured live from @sentry/node
// 10.16.0 (a real wire envelope, not a guess — see the parser's header comment
// for the captured shape). A transaction item is `{type:"transaction"}` whose
// payload is the transaction *event*: the ROOT span lives in `contexts.trace`
// and is timed by the event's TOP-LEVEL start_timestamp/timestamp (the trace
// context itself carries no timing); child spans live in `spans[]` and are
// self-timed. Span `data` is a PLAIN object — NOT the {value,type} log wrapper.

// One transaction envelope (item header + payload), modelled on the real wire.
function txEnvelope(tx: Record<string, unknown>, sdkName = 'sentry.javascript.node') {
  return [
    JSON.stringify({ sdk: { name: sdkName, version: '10.16.0' }, trace: { trace_id: 't'.repeat(32) } }),
    JSON.stringify({ type: 'transaction' }),
    JSON.stringify(tx),
  ].join('\n');
}

// A faithful transaction event: a root http.server span with two children.
function transaction(over: Record<string, unknown> = {}) {
  return {
    contexts: {
      trace: {
        span_id: '90c3461b7a51e4b6',
        trace_id: 'cf8a364a6a3a7fbf3d6dcf31a1710bec',
        data: {
          'sentry.source': 'custom',
          'sentry.op': 'http.server',
          'sentry.origin': 'auto.http.otel.http',
          'diag.project': 'titanium',
          'diag.run_id': 'run-7',
          'diag.tag': 'H2',
        },
        origin: 'auto.http.otel.http',
        op: 'http.server',
        status: 'ok',
      },
    },
    spans: [
      {
        span_id: 'effb0f75cd2f106a',
        trace_id: 'cf8a364a6a3a7fbf3d6dcf31a1710bec',
        data: { 'sentry.origin': 'manual', 'sentry.op': 'db.sql.query', 'db.system': 'postgresql' },
        description: 'db.query users',
        parent_span_id: '90c3461b7a51e4b6',
        start_timestamp: 1780233556.335,
        timestamp: 1780233556.3555682, // ~20.6ms
        status: 'ok',
        op: 'db.sql.query',
        origin: 'manual',
      },
      {
        span_id: 'e0207084d4bbc6b7',
        trace_id: 'cf8a364a6a3a7fbf3d6dcf31a1710bec',
        data: { 'sentry.origin': 'manual', 'sentry.op': 'http.client' },
        description: 'http.client fetch',
        parent_span_id: '90c3461b7a51e4b6',
        start_timestamp: 1780233556.357,
        timestamp: 1780233556.368539, // ~11.5ms
        status: 'ok',
        op: 'http.client',
        origin: 'manual',
      },
    ],
    start_timestamp: 1780233556.333,
    timestamp: 1780233556.3694255, // root ~36.4ms
    transaction: 'GET /api/test',
    type: 'transaction',
    ...over,
  };
}

test('a transaction with N child spans yields N+1 span rows, root first, in order', () => {
  const { rows, skipped } = parseEnvelope(txEnvelope(transaction()));
  expect(skipped).toBe(0);
  expect(rows).toHaveLength(3); // root + 2 children
  expect(rows.every((r) => r.kind === 'span')).toBe(true);
  // root row: msg = transaction name, timed by the event's top-level window
  const root = rows[0];
  expect(root.msg).toBe('GET /api/test');
  expect(root.span_id).toBe('90c3461b7a51e4b6');
  expect(root.ts).toBe(1780233556.333);
  expect(root.level).toBe(''); // spans carry no level
  expect(root.severity_number).toBe(0);
  expect(root.duration_ms).toBeCloseTo(36.4255, 3);
  // children, in array order, self-timed
  expect(rows.slice(1).map((r) => r.msg)).toEqual(['db.query users', 'http.client fetch']);
  expect(rows[1].duration_ms).toBeCloseTo(20.5682, 3);
  expect(rows[2].duration_ms).toBeCloseTo(11.539, 3);
});

test('span rows surface op/status/parent/description/duration_ms into json-queryable attrs', () => {
  const { rows } = parseEnvelope(txEnvelope(transaction()));
  const child = JSON.parse(rows[1].attrs as string) as Record<string, unknown>;
  expect(child.op).toBe('db.sql.query');
  expect(child.status).toBe('ok');
  expect(child.parent_span_id).toBe('90c3461b7a51e4b6');
  expect(child.description).toBe('db.query users');
  expect(child.duration_ms).toBeCloseTo(20.5682, 3);
  // the span's own plain data is merged in (NOT unwrapped — it's already plain)
  expect(child['db.system']).toBe('postgresql');
});

test('span attribution: project/run_id/logger pulled from span data, tag from diag.tag', () => {
  const { rows } = parseEnvelope(txEnvelope(transaction()));
  const root = rows[0];
  expect(root.project).toBe('titanium'); // diag.project from contexts.trace.data
  expect(root.run_id).toBe('run-7');
  expect(root.tag).toBe('H2');
  expect(root.logger).toBe('auto.http.otel.http'); // sentry.origin
  expect(root.service).toBe('sentry.javascript.node'); // envelope sdk.name
  // child has no diag.* — project/run_id default empty, logger from origin
  expect(rows[1].project).toBe('');
  expect(rows[1].run_id).toBe('');
  expect(rows[1].logger).toBe('manual');
});

test('span data is persisted verbatim', () => {
  const { rows } = parseEnvelope(txEnvelope(transaction()));
  // child span data round-trips deep-equal to the source span object
  const src = transaction().spans[1];
  expect(JSON.parse(rows[2].data)).toEqual(src);
});

test('davstack-logs.db routing is honored for spans and stripped from persisted data', () => {
  const tx = transaction();
  // inject the routing hint into the root trace data (where the http.server
  // root attributes live on the real wire)
  (tx.contexts.trace.data as Record<string, unknown>)['davstack-logs.db'] = 'trace-bug';
  const { rows } = parseEnvelope(txEnvelope(tx));
  const root = rows[0];
  expect(root.routeDb).toBe('trace-bug');
  const persisted = JSON.parse(root.data) as { data: Record<string, unknown> };
  expect(persisted.data['davstack-logs.db']).toBeUndefined();
  expect(persisted.data['diag.project']).toBe('titanium'); // siblings preserved
  // and it must not leak into the flattened attrs either
  const flat = JSON.parse(root.attrs as string) as Record<string, unknown>;
  expect(flat['davstack-logs.db']).toBeUndefined();
});

test('a standalone type:"span" item is handled defensively as one span row', () => {
  const span = {
    span_id: 'aa11bb22cc33dd44',
    trace_id: 'd'.repeat(32),
    description: 'cache.get user:42',
    op: 'cache.get',
    status: 'ok',
    origin: 'auto.cache',
    start_timestamp: 100.0,
    timestamp: 100.25, // 250ms
    data: { 'cache.hit': true },
  };
  const raw = [
    JSON.stringify({ sdk: { name: 'sentry.javascript.node', version: '10.16.0' } }),
    JSON.stringify({ type: 'span' }),
    JSON.stringify(span),
  ].join('\n');
  const { rows, skipped } = parseEnvelope(raw);
  expect(skipped).toBe(0);
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('span');
  expect(rows[0].msg).toBe('cache.get user:42');
  expect(rows[0].duration_ms).toBeCloseTo(250, 6);
});

test('back-compat: a mixed envelope (log item + transaction item) yields both kinds', () => {
  // One envelope carrying a log item AND a transaction item — the parser must
  // emit a kind:'log' row AND kind:'span' rows from the same body.
  const raw = [
    JSON.stringify({ sdk: { name: 'sentry.javascript.node', version: '10.16.0' } }),
    JSON.stringify({ type: 'log', item_count: 1, content_type: 'application/vnd.sentry.items.log+json' }),
    JSON.stringify({ items: [log({ body: 'a log line' })] }),
    JSON.stringify({ type: 'transaction' }),
    JSON.stringify(transaction()),
  ].join('\n');
  const { rows, skipped } = parseEnvelope(raw);
  expect(skipped).toBe(0);
  const byKind = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.kind] = (acc[r.kind] ?? 0) + 1;
    return acc;
  }, {});
  expect(byKind).toEqual({ log: 1, span: 3 });
  const logRow = rows.find((r) => r.kind === 'log')!;
  expect(logRow.msg).toBe('a log line');
  expect(logRow.duration_ms).toBeNull();
});
