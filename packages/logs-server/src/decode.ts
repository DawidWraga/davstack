// HTTP body decode for the ingest seam. Real Sentry SDKs (Python especially)
// gzip the envelope body and send `Content-Encoding: gzip`. The server read
// the body as text(), so a gzip body decoded as UTF-8 became garbage, the
// tolerant envelope parser skipped every line, and the run produced ZERO rows
// with NO error — a silent failure that looks exactly like "diag is broken".
//
// This decodes per Content-Encoding before the envelope parser sees it.
// Tolerant by design (same philosophy as the rest of the sink): an unknown or
// corrupt encoding falls back to a best-effort UTF-8 decode rather than
// throwing — a sink that rejects bodies would induce SDK retry storms.

const td = new TextDecoder();

export function decodeBody(
  bytes: Uint8Array,
  contentEncoding: string | null,
): string {
  const enc = (contentEncoding ?? '').trim().toLowerCase();
  try {
    if (enc === 'gzip' || enc === 'x-gzip') {
      return td.decode(Bun.gunzipSync(bytes));
    }
    if (enc === 'deflate') {
      return td.decode(Bun.inflateSync(bytes));
    }
  } catch {
    // Corrupt/mislabelled stream — fall through to raw decode. Better to feed
    // the parser something (it is itself tolerant) than to drop the batch.
  }
  return td.decode(bytes);
}
