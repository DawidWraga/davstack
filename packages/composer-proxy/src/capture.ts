// Capture tap — a transparent recording reverse-proxy. Point Claude Code's
// ANTHROPIC_BASE_URL at this and every request is forwarded verbatim to the
// real Anthropic API (so Claude Code works normally) while each request +
// response is recorded to a fixture file. The recordings — especially live
// streaming SSE and tool-use payloads — become test fixtures for the
// Anthropic-envelope translator we build next.
//
//   composer-capture [--port 8788] [--host 127.0.0.1]
//                    [--upstream https://api.anthropic.com] [--out <dir>]
//
// Env (flags override env; env overrides defaults):
//   ANTHROPIC_UPSTREAM        default https://api.anthropic.com
//   COMPOSER_CAPTURE_DIR      default packages/composer-proxy/.captures
//   COMPOSER_CAPTURE_PORT     default 8788
//   COMPOSER_CAPTURE_HOST     default 127.0.0.1
//
// Plain node:http + node:https so it runs under stock node on Windows with
// zero native deps. Auth passes through: the client's x-api-key / authorization
// headers are forwarded verbatim and never checked here.

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface CaptureConfig {
	host: string;
	port: number;
	/** Upstream base URL requests are forwarded to (e.g. https://api.anthropic.com). */
	upstream: string;
	/** Directory fixtures are written to. Created on startup if missing. */
	outDir: string;
}

// Headers that must not be forwarded as-is: hop-by-hop, or recomputed by the
// upstream client (host targets api.anthropic.com; content-length follows body).
// accept-encoding is dropped on purpose: it forces the upstream to reply
// UNCOMPRESSED, so the recorded bodyRaw is readable text (otherwise gzipped
// JSON — e.g. count_tokens — records as binary garbage). Claude Code handles an
// uncompressed reply fine.
const STRIP_REQUEST_HEADERS = new Set([
	'host',
	'connection',
	'content-length',
	'transfer-encoding',
	'accept-encoding',
]);

// Hop-by-hop response headers to drop before mirroring to the client — node
// frames the response itself, so forwarding these can conflict.
const STRIP_RESPONSE_HEADERS = new Set(['connection', 'transfer-encoding']);

// Request header values we must never write to disk.
const REDACT_HEADERS = new Set(['x-api-key', 'authorization']);

export function createCaptureServer(config: CaptureConfig) {
	mkdirSync(config.outDir, { recursive: true });
	let seq = 0;

	return createServer((req, res) => {
		seq += 1;
		handle(req, res, config, seq).catch((err) => {
			// Never crash the process: surface a 502 and move on.
			if (!res.headersSent) {
				sendJson(res, 502, { error: { type: 'capture_upstream_error', message: errMsg(err) } });
			} else {
				res.end();
			}
		});
	});
}

async function handle(req: IncomingMessage, res: ServerResponse, config: CaptureConfig, seq: number) {
	const method = req.method ?? 'GET';
	const rawUrl = req.url ?? '/';
	const qIndex = rawUrl.indexOf('?');
	const reqPath = qIndex >= 0 ? rawUrl.slice(0, qIndex) : rawUrl;
	const query = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '';

	const reqBodyBuf = await readBody(req);
	const upstream = new URL(rawUrl, config.upstream);
	const isHttps = upstream.protocol === 'https:';
	const doRequest = isHttps ? httpsRequest : httpRequest;

	// Forward client headers verbatim, minus hop-by-hop. Force the Host header
	// to the upstream so SNI/routing match the real API.
	const fwdHeaders: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
		fwdHeaders[key] = value;
	}
	fwdHeaders['host'] = upstream.host;

	await new Promise<void>((resolve, reject) => {
		const upstreamReq = doRequest(
			{
				protocol: upstream.protocol,
				hostname: upstream.hostname,
				port: upstream.port || (isHttps ? 443 : 80),
				method,
				path: upstream.pathname + upstream.search,
				headers: fwdHeaders,
			},
			(upstreamRes) => {
				const status = upstreamRes.statusCode ?? 502;
				const resHeaders = upstreamRes.headers;
				const contentType = String(resHeaders['content-type'] ?? '');
				const isSSE = contentType.includes('text/event-stream');

				// Mirror upstream status + headers to the client, minus hop-by-hop
				// headers node will frame itself.
				const clientHeaders: Record<string, string | string[]> = {};
				for (const [key, value] of Object.entries(resHeaders)) {
					if (value === undefined) continue;
					if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
					clientHeaders[key] = value;
				}
				res.writeHead(status, clientHeaders);

				// TEE: pipe chunks to the client live while accumulating for the fixture.
				const chunks: Buffer[] = [];
				upstreamRes.on('data', (chunk: Buffer) => {
					chunks.push(chunk);
					res.write(chunk);
				});
				upstreamRes.on('end', () => {
					res.end();
					const bodyRaw = Buffer.concat(chunks).toString('utf8');
					writeFixture({
						config,
						seq,
						request: { method, path: reqPath, query, headers: req.headers, body: reqBodyBuf },
						response: { status, headers: resHeaders, contentType, isSSE, bodyRaw },
					});
					resolve();
				});
				upstreamRes.on('error', reject);
			},
		);

		upstreamReq.on('error', (err) => {
			// Record the failed attempt, then surface a 502 to the client.
			writeFixture({
				config,
				seq,
				request: { method, path: reqPath, query, headers: req.headers, body: reqBodyBuf },
				response: { status: 502, headers: {}, contentType: '', isSSE: false, bodyRaw: '', error: errMsg(err) },
			});
			if (!res.headersSent) {
				sendJson(res, 502, { error: { type: 'capture_upstream_error', message: errMsg(err) } });
			} else {
				res.end();
			}
			resolve();
		});

		if (reqBodyBuf.length) upstreamReq.write(reqBodyBuf);
		upstreamReq.end();
	});
}

//* MARK: Fixture

interface WriteFixtureArgs {
	config: CaptureConfig;
	seq: number;
	request: {
		method: string;
		path: string;
		query: string;
		headers: IncomingMessage['headers'];
		body: Buffer;
	};
	response: {
		status: number;
		headers: Record<string, string | string[] | undefined>;
		contentType: string;
		isSSE: boolean;
		bodyRaw: string;
		error?: string;
	};
}

function writeFixture(args: WriteFixtureArgs) {
	try {
		const { config, seq, request, response } = args;

		const fixture: Record<string, unknown> = {
			request: {
				method: request.method,
				path: request.path,
				query: request.query,
				headers: redactHeaders(request.headers),
				body: parseBody(request.headers['content-type'], request.body),
			},
			response: {
				status: response.status,
				headers: response.headers,
				contentType: response.contentType,
				isSSE: response.isSSE,
				bodyRaw: response.bodyRaw,
				...(response.isSSE ? { events: parseSSE(response.bodyRaw) } : {}),
				...(response.error ? { error: response.error } : {}),
			},
		};

		const ts = new Date().toISOString().replace(/[:.]/g, '-');
		const lastSeg = lastPathSegment(request.path);
		const name = `${String(seq).padStart(3, '0')}-${ts}-${lastSeg}.json`;
		writeFileSync(path.join(config.outDir, name), JSON.stringify(fixture, null, 2));
	} catch {
		// Recording is best-effort: never let a fixture-write failure crash the tap.
	}
}

// Replace the VALUE of secret headers with "REDACTED" — never write real keys
// to disk. Header names are preserved so fixtures stay shape-accurate.
function redactHeaders(headers: IncomingMessage['headers']): Record<string, string | string[]> {
	const out: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (value === undefined) continue;
		out[key] = REDACT_HEADERS.has(key.toLowerCase()) ? 'REDACTED' : value;
	}
	return out;
}

// Parse a JSON request body when the content-type says JSON; otherwise keep the
// raw string. Falls back to the raw string if JSON.parse chokes.
function parseBody(contentType: string | undefined, body: Buffer): unknown {
	const raw = body.toString('utf8');
	if (!raw) return '';
	if ((contentType ?? '').includes('application/json')) {
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	}
	return raw;
}

// Parse an SSE stream into {event, data} records. bodyRaw stays the ground
// truth; this is a convenience view. data is JSON.parse'd when possible, else
// kept as a string.
interface SSEEvent {
	event?: string;
	data: unknown;
}

function parseSSE(bodyRaw: string): SSEEvent[] {
	const events: SSEEvent[] = [];
	// SSE records are separated by a blank line. Tolerate CRLF and LF.
	const blocks = bodyRaw.split(/\r?\n\r?\n/);
	for (const block of blocks) {
		if (!block.trim()) continue;
		let event: string | undefined;
		const dataLines: string[] = [];
		for (const line of block.split(/\r?\n/)) {
			if (line.startsWith('event:')) {
				event = line.slice('event:'.length).trim();
			} else if (line.startsWith('data:')) {
				dataLines.push(line.slice('data:'.length).trim());
			}
		}
		if (event === undefined && dataLines.length === 0) continue;
		const dataRaw = dataLines.join('\n');
		let data: unknown = dataRaw;
		try {
			data = JSON.parse(dataRaw);
		} catch {
			// keep as string
		}
		events.push({ ...(event !== undefined ? { event } : {}), data });
	}
	return events;
}

function lastPathSegment(reqPath: string): string {
	const segs = reqPath.split('/').filter(Boolean);
	const last = segs[segs.length - 1] ?? 'root';
	// Keep filenames safe.
	return last.replace(/[^a-zA-Z0-9._-]/g, '_') || 'root';
}

//* MARK: Http helpers

function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c as Buffer));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

function sendJson(res: ServerResponse, status: number, obj: unknown) {
	const payload = JSON.stringify(obj);
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(payload);
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

//* MARK: CLI

interface Cli {
	port: number;
	host: string;
	upstream: string;
	outDir: string;
}

function parseArgs(argv: string[]): Cli {
	const get = (flag: string) => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const port = Number(get('--port') ?? process.env.COMPOSER_CAPTURE_PORT ?? 8788);
	const host = get('--host') ?? process.env.COMPOSER_CAPTURE_HOST ?? '127.0.0.1';
	const upstream = get('--upstream') ?? process.env.ANTHROPIC_UPSTREAM ?? 'https://api.anthropic.com';
	const outDir =
		get('--out') ??
		process.env.COMPOSER_CAPTURE_DIR ??
		path.join(process.cwd(), 'packages', 'composer-proxy', '.captures');
	return { port, host, upstream, outDir };
}

function main() {
	const { port, host, upstream, outDir } = parseArgs(process.argv.slice(2));
	const server = createCaptureServer({ host, port, upstream, outDir });

	server.listen(port, host, () => {
		console.log(`composer-capture → http://${host}:${port}  (upstream: ${upstream})`);
		console.log(`Recording fixtures to ${outDir}`);
		console.log('Point ANTHROPIC_BASE_URL at this base URL.');
	});

	const shutdown = () => server.close(() => process.exit(0));
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

// Only run the CLI when invoked directly, not when imported (e.g. by tests).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
	main();
}
