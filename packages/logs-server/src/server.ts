// The always-on local Sentry log-ingest endpoint. Path-liberal: any POST is
// treated as an envelope (real SDKs hit /api/<id>/envelope/ via the DSN; the
// JS `tunnel` hits a relative path). It ALWAYS replies 200 and never throws —
// a sink that 5xx's or hangs would induce SDK retry storms and block the very
// app it observes (notes 03).

import type { Database } from 'bun:sqlite';
import { handleIngest } from './ingest.js';
import { decodeBody } from './decode.js';

export function startServer(opts: {
  db: Database;
  port?: number;
  host?: string;
}): { port: number; host: string; stop: () => void } {
  const host = opts.host ?? process.env.DIAG_HOST ?? '127.0.0.1';
  const server = Bun.serve({
    port: opts.port ?? (Number(process.env.DIAG_PORT) || 7077),
    hostname: host,
    async fetch(req) {
      if (req.method !== 'POST') return new Response('diag sink ok\n', { status: 200 });
      try {
        // Real SDKs gzip the envelope and set Content-Encoding; reading text()
        // on a gzip body silently produced zero rows. Decode by encoding.
        const bytes = new Uint8Array(await req.arrayBuffer());
        handleIngest(opts.db, decodeBody(bytes, req.headers.get('content-encoding')));
      } catch {
        // swallow — fire-and-forget; the app must never see a failure here
      }
      return new Response(null, { status: 200 });
    },
    error() {
      return new Response(null, { status: 200 });
    },
  });
  return { port: server.port, host, stop: () => server.stop(true) };
}
