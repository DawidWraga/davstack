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

test('tolerant: unknown items ignored, malformed lines skipped, never throws', () => {
  // envelope header, an unknown `profile` item (header+payload), a `log` item,
  // then a malformed trailing line. Only the log records parse; nothing throws.
  // (`event` items ARE persisted now — see the Events section below; this case
  // uses `profile` to exercise the genuinely-ignored branch.)
  const raw = [
    JSON.stringify({ sdk: { name: 'sentry.javascript.browser', version: '9.41.0' } }),
    JSON.stringify({ type: 'profile', content_type: 'application/json' }),
    JSON.stringify({ profile: 'not handled' }),
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

test('ISO-8601 string timestamps (python sentry_sdk) yield real ts + duration, not ts=0/null', () => {
  // python sentry_sdk serializes transaction start_timestamp/timestamp as
  // ISO-8601 strings, where the JS SDK sends epoch-second floats. The sink must
  // coerce both so backend spans don't land at ts=0 / null duration.
  const iso = transaction({
    start_timestamp: '2026-06-01T00:00:00.000Z',
    timestamp: '2026-06-01T00:00:00.250Z', // 250ms root window
  });
  iso.spans[0].start_timestamp = '2026-06-01T00:00:00.000Z';
  iso.spans[0].timestamp = '2026-06-01T00:00:00.020Z'; // 20ms child
  const { rows, skipped } = parseEnvelope(txEnvelope(iso, 'sentry.python'));
  expect(skipped).toBe(0);
  const root = rows[0];
  expect(root.ts).toBe(Date.parse('2026-06-01T00:00:00.000Z') / 1000); // epoch seconds
  expect(root.ts).toBeGreaterThan(0);
  expect(root.duration_ms).toBeCloseTo(250, 3);
  expect(rows[1].duration_ms).toBeCloseTo(20, 3);
});

//* MARK: Transaction metadata (web vitals + request)

// Web vitals ride at the EVENT level (`event.measurements`), NOT on any span.
// The architecture stores transaction-level metadata ONCE on the ROOT span row
// (the segment); child spans never carry it. The key convention is
// `attrs["measurement.<vital>"] = <value>` (value only, unit implied) and
// `attrs["request.url"] / ["request.method"]`. trace-view.ts reads these.

const measurements = {
  lcp: { value: 1234.5, unit: 'millisecond' },
  cls: { value: 0.01, unit: '' },
  fcp: { value: 800.2, unit: 'millisecond' },
  ttfb: { value: 120, unit: 'millisecond' },
  inp: { value: 80, unit: 'millisecond' },
};

test('root row attrs carry web vitals from event.measurements (value extracted)', () => {
  const { rows } = parseEnvelope(txEnvelope(transaction({ measurements })));
  const root = JSON.parse(rows[0].attrs as string) as Record<string, unknown>;
  expect(root['measurement.lcp']).toBe(1234.5);
  expect(root['measurement.cls']).toBe(0.01);
  expect(root['measurement.fcp']).toBe(800.2);
  expect(root['measurement.ttfb']).toBe(120);
  expect(root['measurement.inp']).toBe(80);
  // the trace context's own data is preserved alongside the vitals
  expect(root.op).toBe('http.server');
  expect(root['diag.project']).toBe('titanium');
});

test('child span rows do NOT carry the transaction web vitals', () => {
  const { rows } = parseEnvelope(txEnvelope(transaction({ measurements })));
  for (const child of rows.slice(1)) {
    const a = JSON.parse(child.attrs as string) as Record<string, unknown>;
    expect(a['measurement.lcp']).toBeUndefined();
    expect(a['measurement.cls']).toBeUndefined();
  }
});

test('no measurements / no request ⇒ nothing added (back-compat baseline)', () => {
  const { rows } = parseEnvelope(txEnvelope(transaction()));
  const root = JSON.parse(rows[0].attrs as string) as Record<string, unknown>;
  expect(Object.keys(root).some((k) => k.startsWith('measurement.'))).toBe(false);
  expect(root['request.url']).toBeUndefined();
  expect(root['request.method']).toBeUndefined();
});

test('a measurement with a non-numeric value is skipped (never corrupts attrs)', () => {
  const { rows } = parseEnvelope(
    txEnvelope(transaction({ measurements: { lcp: { value: 'oops', unit: '' } } })),
  );
  const root = JSON.parse(rows[0].attrs as string) as Record<string, unknown>;
  expect(root['measurement.lcp']).toBeUndefined();
});

test('root row attrs capture request.url and request.method when present', () => {
  const { rows } = parseEnvelope(
    txEnvelope(transaction({ request: { url: 'https://app.test/dashboard', method: 'GET' } })),
  );
  const root = JSON.parse(rows[0].attrs as string) as Record<string, unknown>;
  expect(root['request.url']).toBe('https://app.test/dashboard');
  expect(root['request.method']).toBe('GET');
  // and child spans still do not carry request metadata
  const child = JSON.parse(rows[1].attrs as string) as Record<string, unknown>;
  expect(child['request.url']).toBeUndefined();
});

test('vitals attach to the root even when the trace context had no data block', () => {
  // A trace context with no `data` ⇒ root.attrs would be null without vitals.
  // Merging must still produce a valid attrs object carrying the measurements.
  const tx = transaction({ measurements: { lcp: { value: 999, unit: 'millisecond' } } });
  delete (tx.contexts.trace as Record<string, unknown>).data;
  const { rows } = parseEnvelope(txEnvelope(tx));
  const root = JSON.parse(rows[0].attrs as string) as Record<string, unknown>;
  expect(root['measurement.lcp']).toBe(999);
});

//* MARK: Span tolerance

// The sink's prime directive: never throw, never emit a corrupt row. These
// exercise the degenerate trace shapes the span path already guards but that
// the faithful-fixture cases above never hit. Each asserts the ACTUAL guard
// behavior in envelope.ts — not an aspirational one.

test('duration_ms is null (never NaN) when the root window has no top-level timestamp', () => {
  // A transaction MISSING `timestamp` (and one missing `start_timestamp`): the
  // root span window is undeterminable. durationMs() must yield null so the
  // INSERT can't be corrupted with NaN/undefined.
  const noEnd = transaction();
  delete (noEnd as Record<string, unknown>).timestamp;
  const r1 = parseEnvelope(txEnvelope(noEnd)).rows[0];
  expect(r1.duration_ms).toBeNull();
  expect(Number.isNaN(r1.duration_ms as unknown as number)).toBe(false);

  const noStart = transaction();
  delete (noStart as Record<string, unknown>).start_timestamp;
  const r2 = parseEnvelope(txEnvelope(noStart)).rows[0];
  expect(r2.duration_ms).toBeNull();
});

test('duration_ms is null (never NaN) for a child span missing its timestamp', () => {
  // Corrupt one child: drop its end `timestamp`. That child row's duration is
  // null; the well-formed sibling is unaffected. No throw, no NaN.
  const tx = transaction();
  delete (tx.spans[0] as Record<string, unknown>).timestamp;
  const { rows, skipped } = parseEnvelope(txEnvelope(tx));
  expect(skipped).toBe(0);
  expect(rows).toHaveLength(3); // still root + 2 children
  expect(rows[1].duration_ms).toBeNull(); // the corrupted child
  expect(rows[2].duration_ms).toBeCloseTo(11.539, 3); // healthy sibling intact
});

test('root-only transaction (empty spans[]) emits exactly the single root span row', () => {
  const { rows, skipped } = parseEnvelope(txEnvelope(transaction({ spans: [] })));
  expect(skipped).toBe(0);
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('span');
  expect(rows[0].msg).toBe('GET /api/test'); // the root transaction name
});

test('root-only transaction (spans key absent entirely) emits exactly the single root span row', () => {
  const noSpans = transaction();
  delete (noSpans as Record<string, unknown>).spans;
  const { rows, skipped } = parseEnvelope(txEnvelope(noSpans));
  expect(skipped).toBe(0);
  expect(rows).toHaveLength(1);
  expect(rows[0].kind).toBe('span');
  expect(rows[0].msg).toBe('GET /api/test');
});

test('a transaction missing contexts.trace is tolerated: no root row, no throw', () => {
  // No `contexts.trace` ⇒ the root guard (`if (trace && typeof trace === 'object')`)
  // skips the root, and with no `spans[]` the result is zero span rows. The
  // documented best-effort behavior here is "emit nothing, never throw".
  const noTrace = transaction({ spans: [] });
  delete (noTrace as Record<string, unknown>).contexts;
  let result: ReturnType<typeof parseEnvelope> | undefined;
  expect(() => {
    result = parseEnvelope(txEnvelope(noTrace));
  }).not.toThrow();
  expect(result!.rows).toHaveLength(0); // no contexts.trace, no spans → nothing
  expect(result!.skipped).toBe(0); // a parseable-but-empty tx is not "skipped"
});

test('a transaction missing contexts.trace still emits its child spans (best-effort)', () => {
  // Same missing-root case but WITH children: the root is skipped, yet the
  // self-timed child spans are still emitted (best-effort, not all-or-nothing).
  const noTrace = transaction();
  delete (noTrace as Record<string, unknown>).contexts;
  const { rows, skipped } = parseEnvelope(txEnvelope(noTrace));
  expect(skipped).toBe(0);
  expect(rows).toHaveLength(2); // the two children, no root
  expect(rows.every((r) => r.kind === 'span')).toBe(true);
  expect(rows.map((r) => r.msg)).toEqual(['db.query users', 'http.client fetch']);
});

test('a malformed transaction payload is skipped, never throws, and a sibling log still parses', () => {
  // transaction item header followed by a non-object garbage payload (a bare
  // JSON string), then a perfectly good log item in the same envelope. The
  // transaction is counted in `skipped`; the log still parses.
  const raw = [
    JSON.stringify({ sdk: { name: 'sentry.javascript.node', version: '10.16.0' } }),
    JSON.stringify({ type: 'transaction' }),
    JSON.stringify('not-a-transaction-object'), // valid JSON, but not an object
    JSON.stringify({ type: 'log', item_count: 1, content_type: 'application/vnd.sentry.items.log+json' }),
    JSON.stringify({ items: [log({ body: 'the surviving log' })] }),
  ].join('\n');
  let result: ReturnType<typeof parseEnvelope> | undefined;
  expect(() => {
    result = parseEnvelope(raw);
  }).not.toThrow();
  expect(result!.skipped).toBe(1); // the garbage transaction payload
  expect(result!.rows).toHaveLength(1);
  expect(result!.rows[0].kind).toBe('log');
  expect(result!.rows[0].msg).toBe('the surviving log');
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

//* MARK: Runtime

// The `runtime` column records which Next.js runtime (browser|node|edge)
// emitted the row, stamped at the Sentry config source. Logs read it from
// `attributes.runtime`; spans from the span's plain `data.runtime`; events from
// `tags.runtime` (falling back to Sentry's native `contexts.runtime.name`).

test('log runtime comes from attributes.runtime', () => {
  const { rows } = parseEnvelope(envelope([log({ attributes: { runtime: a('browser') } })]));
  expect(rows[0].runtime).toBe('browser');
});

test('log runtime is null when attributes.runtime is absent', () => {
  const { rows } = parseEnvelope(envelope([log()]));
  expect(rows[0].runtime).toBeNull();
});

test('span runtime comes from the span/trace plain data.runtime, root + children', () => {
  const tx = transaction();
  (tx.contexts.trace.data as Record<string, unknown>).runtime = 'node';
  (tx.spans[0].data as Record<string, unknown>).runtime = 'node';
  (tx.spans[1].data as Record<string, unknown>).runtime = 'node';
  const { rows } = parseEnvelope(txEnvelope(tx));
  expect(rows.every((r) => r.runtime === 'node')).toBe(true);
});

test('span runtime is null when data.runtime is absent', () => {
  const { rows } = parseEnvelope(txEnvelope(transaction()));
  expect(rows.every((r) => r.runtime === null)).toBe(true);
});

test('event runtime prefers tags.runtime', () => {
  const ev = exceptionEvent({ tags: { runtime: 'edge' } });
  expect(parseEnvelope(eventEnvelope(ev)).rows[0].runtime).toBe('edge');
});

test('event runtime falls back to contexts.runtime.name when no tag', () => {
  // exceptionEvent() carries contexts.runtime = { name: 'node', ... }
  expect(parseEnvelope(eventEnvelope(exceptionEvent())).rows[0].runtime).toBe('node');
});

test('event runtime is null when neither tags.runtime nor contexts.runtime present', () => {
  const bare = { event_id: 'deadbeef', level: 'info', timestamp: 1.0 };
  expect(parseEnvelope(eventEnvelope(bare)).rows[0].runtime).toBeNull();
});

//* MARK: Events (exceptions)

// Real error/message events. Both fixtures below are the verbatim payloads
// captured live from @sentry/node 10.16.0 (a custom transport dumped the
// serialized envelope from Sentry.captureException / Sentry.captureMessage —
// real wire, not a guess). Sentry packages an exception as a `{type:"event"}`
// item whose payload carries `exception.values[].stacktrace` + mechanism; a
// captureMessage event carries a top-level `message`. Both were silently
// dropped before — this is the whole reason errors never reached the sink.

// The captured exception event. One added frame has in_app:true (the captured
// frames were all in_app:false because the probe ran inside node_modules) so
// the headline-frame attr is exercised against a realistic shape.
function exceptionEvent(over: Record<string, unknown> = {}) {
  return {
    exception: {
      values: [
        {
          type: 'TypeError',
          value: "Cannot read properties of undefined (reading 'id')",
          stacktrace: {
            frames: [
              {
                filename: 'node:internal/modules/run_main',
                module: 'run_main',
                function: 'asyncRunEntryPointWithESMLoader',
                lineno: 101,
                colno: 5,
                in_app: false,
              },
              {
                filename: 'src/server/handler.ts',
                module: 'handler',
                function: 'loadUser',
                lineno: 42,
                colno: 9,
                in_app: true,
              },
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
      trace: {
        trace_id: 'd7bb35a9330f4576938454c270be61b2',
        span_id: '94a0c549144838cb',
      },
      runtime: { name: 'node', version: 'v24.13.0' },
    },
    server_name: 'dawid-laptop',
    timestamp: 1780505594.791,
    environment: 'production',
    sdk: {
      name: 'sentry.javascript.node',
      version: '10.16.0',
      integrations: [],
      packages: [{ name: 'npm:@sentry/node', version: '10.16.0' }],
    },
    ...over,
  };
}

// The captured captureMessage event (no exception, top-level `message`).
function messageEvent(over: Record<string, unknown> = {}) {
  return {
    event_id: 'b00c74f911c1490ba300541b0db3a0cc',
    level: 'warning',
    message: 'something noteworthy happened',
    platform: 'node',
    contexts: {
      trace: {
        trace_id: 'd7bb35a9330f4576938454c270be61b2',
        span_id: '9e620021461e3a30',
      },
      runtime: { name: 'node', version: 'v24.13.0' },
    },
    server_name: 'dawid-laptop',
    timestamp: 1780505594.798,
    environment: 'production',
    sdk: { name: 'sentry.javascript.node', version: '10.16.0' },
    ...over,
  };
}

// An `{type:"event"}` envelope (item header + payload), modelled on the real wire.
function eventEnvelope(ev: Record<string, unknown>, sdkName = 'sentry.javascript.node') {
  return [
    JSON.stringify({
      sdk: { name: sdkName, version: '10.16.0' },
      trace: { trace_id: 'd7bb35a9330f4576938454c270be61b2' },
    }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(ev),
  ].join('\n');
}

test('an exception event is persisted as a single kind:"event" row', () => {
  const { rows, skipped } = parseEnvelope(eventEnvelope(exceptionEvent()));
  expect(skipped).toBe(0);
  expect(rows).toHaveLength(1);
  const r = rows[0];
  expect(r.kind).toBe('event');
  // msg = "{type}: {value}" of the LAST (innermost) exception value
  expect(r.msg).toBe("TypeError: Cannot read properties of undefined (reading 'id')");
  expect(r.level).toBe('error');
  expect(r.severity_number).toBe(17); // OTel error
  expect(r.trace_id).toBe('d7bb35a9330f4576938454c270be61b2');
  expect(r.span_id).toBe('94a0c549144838cb');
  expect(r.service).toBe('sentry.javascript.node');
  expect(r.duration_ms).toBeNull();
  expect(r.ts).toBe(1780505594.791);
});

test('the full stacktrace/exception survives verbatim in data', () => {
  const { rows } = parseEnvelope(eventEnvelope(exceptionEvent()));
  const data = JSON.parse(rows[0].data) as Record<string, any>;
  // the whole exception object round-trips deep-equal (this is the payload that
  // was being dropped before — the stacktrace must be intact)
  expect(data.exception).toEqual(exceptionEvent().exception);
  expect(data.exception.values[0].stacktrace.frames).toHaveLength(2);
});

test('event attrs surface queryable headline fields (type, mechanism, top in_app frame)', () => {
  const { rows } = parseEnvelope(eventEnvelope(exceptionEvent()));
  const attrs = JSON.parse(rows[0].attrs as string) as Record<string, unknown>;
  expect(attrs.exception_type).toBe('TypeError');
  expect(attrs.handled).toBe(true);
  expect(attrs.mechanism).toBe('generic');
  // the FIRST in_app frame is surfaced as the headline frame
  expect(attrs.function).toBe('loadUser');
  expect(attrs.filename).toBe('src/server/handler.ts');
  expect(attrs.lineno).toBe(42);
});

test('a captureMessage event yields kind:"event", msg = the message', () => {
  const { rows, skipped } = parseEnvelope(eventEnvelope(messageEvent()));
  expect(skipped).toBe(0);
  expect(rows).toHaveLength(1);
  const r = rows[0];
  expect(r.kind).toBe('event');
  expect(r.msg).toBe('something noteworthy happened');
  expect(r.level).toBe('warning');
  expect(r.severity_number).toBe(13); // OTel warning
  expect(r.trace_id).toBe('d7bb35a9330f4576938454c270be61b2');
});

test('event trace_id falls back to the envelope header when contexts.trace is absent', () => {
  const ev = messageEvent();
  delete (ev as Record<string, unknown>).contexts;
  const { rows } = parseEnvelope(eventEnvelope(ev));
  expect(rows[0].trace_id).toBe('d7bb35a9330f4576938454c270be61b2'); // from header trace
  expect(rows[0].span_id).toBe('');
});

test('a degenerate event (no exception, no message) falls back to event_id for msg', () => {
  const bare = { event_id: 'deadbeef', level: 'info', timestamp: 1.0 };
  const { rows, skipped } = parseEnvelope(eventEnvelope(bare));
  expect(skipped).toBe(0);
  expect(rows[0].kind).toBe('event');
  expect(rows[0].msg).toBe('deadbeef');
  expect(rows[0].severity_number).toBe(9); // info
});

test('a malformed event payload is skipped, never throws, sibling log survives', () => {
  const raw = [
    JSON.stringify({ sdk: { name: 'sentry.javascript.node', version: '10.16.0' } }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify('not-an-event-object'),
    JSON.stringify({ type: 'log', item_count: 1, content_type: 'application/vnd.sentry.items.log+json' }),
    JSON.stringify({ items: [log({ body: 'the surviving log' })] }),
  ].join('\n');
  let result: ReturnType<typeof parseEnvelope> | undefined;
  expect(() => {
    result = parseEnvelope(raw);
  }).not.toThrow();
  expect(result!.skipped).toBe(1);
  expect(result!.rows).toHaveLength(1);
  expect(result!.rows[0].kind).toBe('log');
});

test('event routing: davstack-logs.db hint is honored and stripped from data', () => {
  const ev = exceptionEvent({ tags: { 'davstack-logs.db': 'crash-bug', feature: 'checkout' } });
  const { rows } = parseEnvelope(eventEnvelope(ev));
  expect(rows[0].routeDb).toBe('crash-bug');
  const data = JSON.parse(rows[0].data) as { tags: Record<string, unknown> };
  expect(data.tags['davstack-logs.db']).toBeUndefined();
  expect(data.tags.feature).toBe('checkout'); // siblings preserved
});

test('event tag is pulled from tags.diag.tag (best-effort), null otherwise', () => {
  const tagged = exceptionEvent({ tags: { 'diag.tag': 'H4' } });
  expect(parseEnvelope(eventEnvelope(tagged)).rows[0].tag).toBe('H4');
  expect(parseEnvelope(eventEnvelope(exceptionEvent())).rows[0].tag).toBeNull();
});
