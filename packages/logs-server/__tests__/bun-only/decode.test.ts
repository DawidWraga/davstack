import { test, expect } from 'bun:test';
import { deflateSync as nodeDeflateSync } from 'node:zlib';
import { decodeBody } from '../../src/decode.js';

// A realistic Sentry log envelope (newline-delimited JSON) — the exact shape
// the Python SDK ships, so the round-trip proves the real path.
const ENVELOPE = [
  JSON.stringify({ sdk: { name: 'sentry.python', version: '2.43.0' } }),
  JSON.stringify({ type: 'log', item_count: 1, content_type: 'application/vnd.sentry.items.log+json' }),
  JSON.stringify({ items: [{ timestamp: 1, trace_id: 'a'.repeat(32), level: 'info', body: 'hello', attributes: {} }] }),
].join('\n');

const enc = new TextEncoder();

test('gzip body (what the Python SDK sends) round-trips to the original envelope', () => {
  const gz = Bun.gzipSync(enc.encode(ENVELOPE));
  expect(decodeBody(gz, 'gzip')).toBe(ENVELOPE);
});

test('x-gzip alias is honoured', () => {
  const gz = Bun.gzipSync(enc.encode(ENVELOPE));
  expect(decodeBody(gz, 'x-gzip')).toBe(ENVELOPE);
});

test('deflate body (zlib-wrapped, RFC 7230) round-trips', () => {
  // What a standards-compliant HTTP client sends for `Content-Encoding: deflate`.
  const df = new Uint8Array(nodeDeflateSync(enc.encode(ENVELOPE)));
  expect(decodeBody(df, 'deflate')).toBe(ENVELOPE);
});

test('deflate body (raw DEFLATE) round-trips', () => {
  // What Bun.deflateSync and many real clients emit — raw, no zlib wrapper.
  const df = Bun.deflateSync(enc.encode(ENVELOPE));
  expect(decodeBody(df, 'deflate')).toBe(ENVELOPE);
});

test('no Content-Encoding (uncompressed) is unchanged — no regression of the old path', () => {
  expect(decodeBody(enc.encode(ENVELOPE), null)).toBe(ENVELOPE);
  expect(decodeBody(enc.encode(ENVELOPE), '')).toBe(ENVELOPE);
});

test('Content-Encoding casing/whitespace tolerated', () => {
  const gz = Bun.gzipSync(enc.encode(ENVELOPE));
  expect(decodeBody(gz, '  GZIP ')).toBe(ENVELOPE);
});

test('mislabelled gzip (actually plain text) falls back to raw decode, never throws', () => {
  // Header lies — body is not gzip. Must not throw; best-effort raw decode.
  expect(decodeBody(enc.encode(ENVELOPE), 'gzip')).toBe(ENVELOPE);
});

test('unknown encoding falls back to raw decode', () => {
  expect(decodeBody(enc.encode(ENVELOPE), 'br')).toBe(ENVELOPE);
});
