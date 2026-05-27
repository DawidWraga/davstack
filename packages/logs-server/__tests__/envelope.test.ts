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
