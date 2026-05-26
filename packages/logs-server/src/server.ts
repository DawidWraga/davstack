// The always-on local Sentry log-ingest endpoint. Path-liberal: any POST is
// treated as an envelope (real SDKs hit /api/<id>/envelope/ via the DSN; the
// JS `tunnel` hits a relative path). It ALWAYS replies 200 and never throws —
// a sink that 5xx's or hangs would induce SDK retry storms and block the very
// app it observes (notes 03).
//
// CORS: browser SDKs posting envelopes via DSN (Content-Type
// application/x-sentry-envelope is non-simple) trigger a preflight. Default
// policy is "*" — safe because the sink binds 127.0.0.1 only and never sets
// Allow-Credentials, so no readable response is exposed cross-origin. Lock
// down per-origin or disable via the `cors` config field.

import type { Database } from 'bun:sqlite';
import type { ServerConfig } from './config.ts';
import { handleIngest } from './ingest.ts';
import { decodeBody } from './decode.ts';

export function corsHeadersFor(
  origin: string | null,
  policy: ServerConfig['cors'],
): Headers {
  const h = new Headers();
  if (policy === false) return h;
  if (policy === '*' || policy === undefined) {
    h.set('Access-Control-Allow-Origin', '*');
  } else if (Array.isArray(policy) && origin && policy.includes(origin)) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Vary', 'Origin');
  } else {
    return h; // no match → no CORS headers → browser blocks
  }
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  h.set(
    'Access-Control-Allow-Headers',
    'content-type,content-encoding,sentry-trace,baggage,x-sentry-auth',
  );
  h.set('Access-Control-Max-Age', '86400');
  return h;
}

export function startServer(opts: {
  db: Database;
  port?: number;
  host?: string;
  cors?: ServerConfig['cors'];
}): { port: number; host: string; stop: () => void } {
  const host = opts.host ?? process.env.DIAG_HOST ?? '127.0.0.1';
  const corsPolicy = opts.cors;
  const server = Bun.serve({
    port: opts.port ?? (Number(process.env.DIAG_PORT) || 7077),
    hostname: host,
    async fetch(req) {
      const cors = corsHeadersFor(req.headers.get('origin'), corsPolicy);
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }
      if (req.method !== 'POST') {
        return new Response('diag sink ok\n', { status: 200, headers: cors });
      }
      try {
        // Real SDKs gzip the envelope and set Content-Encoding; reading text()
        // on a gzip body silently produced zero rows. Decode by encoding.
        const bytes = new Uint8Array(await req.arrayBuffer());
        handleIngest(opts.db, decodeBody(bytes, req.headers.get('content-encoding')));
      } catch {
        // swallow — fire-and-forget; the app must never see a failure here
      }
      return new Response(null, { status: 200, headers: cors });
    },
    error() {
      // No request in scope here — emit no CORS headers; browsers ignore a
      // failed response anyway, but server-side emitters still see a 200.
      return new Response(null, { status: 200 });
    },
  });
  return { port: server.port, host, stop: () => server.stop(true) };
}
