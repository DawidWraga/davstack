// HTTP adapter around a PlaywrightSession. Routes:
//   GET  /health
//   POST /run            { file: string }
//   POST /goto           { url: string }
//   POST /refresh
//   POST /refresh-auth
//   POST /shutdown
//
// Kept dumb on purpose — all the lifecycle / serialisation lives in
// session.ts. This file is just argv → method calls.
//
// Uses node:http (not Bun.serve) so the daemon runs under both Node and
// Bun. Bun has known incompatibilities with Playwright's chromium debug
// protocol (chromium.launch hangs on the remote-debugging pipe under Bun);
// Node + tsx is the supported launcher today.

import http, { type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { PlaywrightSession } from './session.js';

export type ServeOpts = {
  session: PlaywrightSession;
  port: number;
  host: string;
  log?: (...args: unknown[]) => void;
};

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

export function startServer(opts: ServeOpts): Server {
  const log = opts.log ?? ((...a) => console.log('[playwright-server]', ...a));
  const { session } = opts;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, {
          ok: true,
          pid: process.pid,
          url: session.pageUrl,
          refreshedAt: session.refreshedAt,
        });
      }
      if (req.method === 'POST' && url.pathname === '/refresh') {
        const r = await session.refresh();
        return send(res, 200, r);
      }
      if (req.method === 'POST' && url.pathname === '/run') {
        const body = await readBody(req);
        if (!body.file) return send(res, 400, { ok: false, error: "missing 'file'" });
        const db = typeof body.db === 'string' && body.db.length > 0 ? body.db : undefined;
        return send(res, 200, await session.runOnce(String(body.file), { db }));
      }
      if (req.method === 'POST' && url.pathname === '/refresh-auth') {
        const r = await session.refreshAuth();
        return send(res, r.ok ? 200 : 500, r);
      }
      if (req.method === 'POST' && url.pathname === '/goto') {
        const body = await readBody(req);
        if (!body.url) return send(res, 400, { ok: false, error: "missing 'url'" });
        return send(res, 200, await session.goto(String(body.url)));
      }
      if (req.method === 'POST' && url.pathname === '/shutdown') {
        send(res, 200, { ok: true });
        log('shutdown requested');
        await session.shutdown();
        process.exit(0);
        return;
      }
      send(res, 404, { ok: false, error: 'not found' });
    } catch (e) {
      log('handler error', e);
      send(res, 500, {
        ok: false,
        error: String((e as Error)?.message ?? e),
        stack: (e as Error)?.stack ?? null,
      });
    }
  });
  server.listen(opts.port, opts.host);
  return server;
}
