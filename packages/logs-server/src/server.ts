// The always-on local Sentry log-ingest endpoint. Path-liberal: any POST is
// treated as an envelope (real SDKs hit /api/<id>/envelope/ via the DSN; the
// JS `tunnel` hits a relative path). It ALWAYS replies 200 and never throws —
// a sink that 5xx's or hangs would induce SDK retry storms and block the very
// app it observes (notes 03).
//
// Two construction modes:
//   { db } ............... single-DB mode (tests / one-off scripts).
//   { cache, defaultDbPath, repoRoot } ... multi-DB dispatch (the daemon
//                                          surface; routes per the
//                                          `davstack-logs.db` attribute).
//
// CORS: browser SDKs posting envelopes via DSN (Content-Type
// application/x-sentry-envelope is non-simple) trigger a preflight. Default
// policy is "*" — safe because the sink binds 127.0.0.1 only and never sets
// Allow-Credentials, so no readable response is exposed cross-origin. Lock
// down per-origin or disable via the `cors` config field.

import type { Database } from 'bun:sqlite';
import type { ServerConfig } from './config.js';
import type { DbHandleCache } from './db-cache.js';
import { handleIngest, dispatchIngest } from './ingest.js';
import { decodeBody } from './decode.js';

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

export type ServerOpts =
  | {
      db: Database;
      cache?: undefined;
      defaultDbPath?: undefined;
      repoRoot?: undefined;
      port?: number;
      host?: string;
      cors?: ServerConfig['cors'];
      onRefresh?: () => Promise<RefreshResult> | RefreshResult;
    }
  | {
      cache: DbHandleCache;
      defaultDbPath: string;
      repoRoot: string;
      db?: undefined;
      port?: number;
      host?: string;
      cors?: ServerConfig['cors'];
      onRefresh?: () => Promise<RefreshResult> | RefreshResult;
    };

export type RefreshResult = {
  ok: boolean;
  refreshedAt: string;
  closedHandles: number;
  configReloaded: boolean;
};

export function startServer(opts: ServerOpts): { port: number; host: string; stop: () => void } {
  const host = opts.host ?? process.env.DIAG_HOST ?? '127.0.0.1';
  const corsPolicy = opts.cors;
  const ingest = makeIngest(opts);
  // Refreshed-at tracker for the daemon. Surfaced on GET /__health for
  // the TUI's "last refreshed" panel. The path is double-underscore to
  // avoid colliding with Sentry SDK envelope URLs (which are
  // `/api/<id>/envelope/`). Any non-control POST falls through to
  // envelope ingest as before.
  let refreshedAtIso: string | null = null;
  const onRefresh = opts.onRefresh;
  const server = Bun.serve({
    port: opts.port ?? (Number(process.env.DIAG_PORT) || 7077),
    hostname: host,
    async fetch(req) {
      const cors = corsHeadersFor(req.headers.get('origin'), corsPolicy);
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors });
      }
      // Control plane routes — explicit `__`-prefixed paths so they
      // can't collide with envelope URLs. Anything else still falls
      // through to the envelope sink for back-compat.
      const path = new URL(req.url).pathname;
      if (req.method === 'GET' && path === '/__health') {
        const body = { ok: true, pid: process.pid, refreshedAt: refreshedAtIso };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: jsonHeaders(cors),
        });
      }
      if (req.method === 'POST' && path === '/__shutdown') {
        // Reply first, then stop the server in the next tick so the
        // socket flushes the 200 before Bun.serve tears it down.
        queueMicrotask(() => {
          try {
            server.stop(true);
          } finally {
            // Exit the process so a parent supervisor (or `refresh --hard`
            // respawn) can take over. SIGTERM handlers in index.ts would
            // also fire, but exit(0) is the explicit, deterministic path.
            process.exit(0);
          }
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: jsonHeaders(cors),
        });
      }
      if (req.method === 'POST' && path === '/__refresh') {
        const refreshedAt = new Date().toISOString();
        let result: RefreshResult = {
          ok: true,
          refreshedAt,
          closedHandles: 0,
          configReloaded: false,
        };
        if (onRefresh) {
          try {
            const r = await onRefresh();
            result = { ...r, refreshedAt };
          } catch (e) {
            result = {
              ok: false,
              refreshedAt,
              closedHandles: 0,
              configReloaded: false,
            };
            // attach error for the client
            (result as RefreshResult & { error?: string }).error = String(
              (e as Error)?.message ?? e,
            );
          }
        }
        refreshedAtIso = refreshedAt;
        return new Response(JSON.stringify(result), {
          status: result.ok ? 200 : 500,
          headers: jsonHeaders(cors),
        });
      }
      if (req.method !== 'POST') {
        return new Response('diag sink ok\n', { status: 200, headers: cors });
      }
      try {
        // Real SDKs gzip the envelope and set Content-Encoding; reading text()
        // on a gzip body silently produced zero rows. Decode by encoding.
        const bytes = new Uint8Array(await req.arrayBuffer());
        ingest(decodeBody(bytes, req.headers.get('content-encoding')));
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

function jsonHeaders(cors: Headers): Headers {
  const h = new Headers(cors);
  h.set('content-type', 'application/json');
  return h;
}

function makeIngest(opts: ServerOpts): (raw: string) => void {
  if ('db' in opts && opts.db) {
    const db = opts.db;
    return (raw) => {
      handleIngest(db, raw);
    };
  }
  if (!('cache' in opts) || !opts.cache || !opts.defaultDbPath || !opts.repoRoot) {
    throw new Error('startServer: pass either { db } or { cache, defaultDbPath, repoRoot }');
  }
  const { cache, defaultDbPath, repoRoot } = opts;
  return (raw) => {
    dispatchIngest(raw, { cache, defaultDbPath, repoRoot });
  };
}
