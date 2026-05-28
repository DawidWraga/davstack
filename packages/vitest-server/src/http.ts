// HTTP adapter for vitest-server. Uses node:http (not Bun.serve) because
// Vitest's worker pool has gaps under Bun's worker_threads polyfill, so
// the whole daemon needs to be runnable under Node. Pure Node APIs keep
// both runtimes working.

import http, { type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { VitestSession } from './session.js';

export type ServeOpts = {
  session: VitestSession;
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
  const log = opts.log ?? ((...a) => console.log('[vitest-server]', ...a));
  const { session } = opts;
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true, pid: process.pid, refreshedAt: session.refreshedAt });
      }
      if (req.method === 'POST' && url.pathname === '/refresh') {
        return send(res, 200, await session.refresh());
      }
      if (req.method === 'POST' && url.pathname === '/run') {
        const body = await readBody(req);
        if (!body.file) return send(res, 400, { ok: false, error: "missing 'file'" });
        const result = await session.runOnce({
          file: String(body.file),
          testNamePattern: body.testNamePattern ? String(body.testNamePattern) : undefined,
        });
        return send(res, 200, result);
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
