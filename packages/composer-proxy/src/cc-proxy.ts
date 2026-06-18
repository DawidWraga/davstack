// Claude Code proxy. Point Claude Code's ANTHROPIC_BASE_URL at this and it
// serves Anthropic's /v1/messages two ways, branching on the request model:
//
//   model === composerModelId  → run Cursor Composer as a self-executing agent
//                                 in the user's REAL repo and stream its work
//                                 back as Anthropic *text* SSE (no tool_use
//                                 blocks). Composer runs its own tools on cwd;
//                                 we narrate those actions as visible text.
//   model is a real claude-*    → transparent passthrough to the upstream
//                                 Anthropic API (main loop untouched).
//
// This lets Claude Code spawn subagents on the "haiku" slot and have Composer
// do the work with no Anthropic credits, while staying visible. Reuses the
// transparent-forward approach from capture.ts (minus the fixture recording).
//
// Plain node:http + node:https so it runs under stock node on Windows with zero
// native deps. Auth passes through on the passthrough branch; the composer
// branch holds CURSOR_API_KEY server-side and never exposes it.

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { runComposerAgent } from './cursor.js';
import {
	contentBlockDelta,
	contentBlockStart,
	contentBlockStop,
	encodeSSE,
	messageDelta,
	messageStart,
	messageStop,
	ping,
} from './anthropic-sse.js';
import {
	estimateInputTokens,
	extractCwd,
	flattenRequest,
	type AnthropicMessagesRequest,
} from './anthropic-request.js';

export interface CcProxyConfig {
	/** Cursor Dashboard API key for @cursor/sdk. */
	apiKey: string;
	host: string;
	port: number;
	/** Request model that routes to Composer (e.g. "composer-2.5"). */
	composerModelId: string;
	/** Upstream Anthropic base URL for the passthrough branch. */
	upstream: string;
	/** When set, overrides the cwd Composer runs in (else extracted from body). */
	cwdOverride?: string;
}

// Same posture as capture.ts: drop hop-by-hop + accept-encoding (force an
// uncompressed upstream reply so node frames it cleanly) on the way up, and
// hop-by-hop on the way back.
const STRIP_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'accept-encoding']);
const STRIP_RESPONSE_HEADERS = new Set(['connection', 'transfer-encoding']);

export function createCcProxyServer(config: CcProxyConfig) {
	return createServer((req, res) => {
		handle(req, res, config).catch((err) => {
			if (!res.headersSent) {
				sendJson(res, 502, { error: { type: 'cc_proxy_error', message: errMsg(err) } });
			} else {
				res.end();
			}
		});
	});
}

//* MARK: Router

async function handle(req: IncomingMessage, res: ServerResponse, config: CcProxyConfig) {
	const method = req.method ?? 'GET';
	const rawUrl = req.url ?? '/';
	const reqPath = rawUrl.split('?')[0];

	if (method === 'GET' && (reqPath === '/' || reqPath === '/health')) {
		return sendJson(res, 200, {
			ok: true,
			service: 'composer-cc',
			composerModelId: config.composerModelId,
			upstream: config.upstream,
		});
	}

	if (method === 'POST' && reqPath === '/v1/messages') {
		const buf = await readBody(req);
		const body = parseJson(buf) as AnthropicMessagesRequest;
		const isComposer = body?.model === config.composerModelId;
		trace(`POST /v1/messages  model=${body?.model}  →  ${isComposer ? 'COMPOSER 🟢' : 'passthrough → Anthropic'}`);
		if (isComposer) return handleComposer(res, body, config);
		return passthrough(req, res, buf, config);
	}

	if (method === 'POST' && reqPath === '/v1/messages/count_tokens') {
		const buf = await readBody(req);
		const body = parseJson(buf) as AnthropicMessagesRequest;
		const isComposer = body?.model === config.composerModelId;
		trace(`POST /count_tokens  model=${body?.model}  →  ${isComposer ? 'estimate (Composer)' : 'passthrough'}`);
		if (isComposer) {
			return sendJson(res, 200, { input_tokens: estimateInputTokens(body) });
		}
		return passthrough(req, res, buf, config);
	}

	return sendJson(res, 404, { error: { type: 'not_found', message: `no route for ${method} ${reqPath}` } });
}

//* MARK: Composer branch

async function handleComposer(res: ServerResponse, body: AnthropicMessagesRequest, config: CcProxyConfig) {
	const model = body.model ?? config.composerModelId;

	// Probe guard: Claude Code pings tiny max_tokens requests to test the model.
	// Don't spin up Composer for those — return a minimal valid "ok".
	if (body.max_tokens != null && body.max_tokens <= 4) {
		trace(`  probe guard (max_tokens=${body.max_tokens}) → quick ok, Composer NOT invoked`);
		return body.stream ? streamProbe(res, model) : nonStreamMessage(res, model, 'ok');
	}

	const cwd = config.cwdOverride ?? extractCwd(body) ?? process.cwd();
	const prompt = flattenRequest(body);
	const inputTokens = estimateInputTokens(body);
	trace(`  ⚙ invoking Composer agent  cwd=${cwd}  promptChars=${prompt.length}  stream=${!!body.stream}`);

	if (body.stream) {
		return streamComposer(res, { config, model, prompt, cwd, inputTokens });
	}

	// Non-stream: run to completion, return a single Anthropic message. Narration
	// is interleaved so the user still sees what Composer did.
	const narration: string[] = [];
	const { text } = await runComposerAgent({
		apiKey: config.apiKey,
		model,
		prompt,
		cwd,
		onToolActivity: (line) => {
			trace(`    ${line}`);
			narration.push(line);
		},
	});
	trace(`  ✓ Composer done (${narration.length} tool calls, ${text.length} chars)`);
	const full = (narration.length ? narration.join('\n') + '\n\n' : '') + text;
	return nonStreamMessage(res, model, full, inputTokens);
}

async function streamComposer(
	res: ServerResponse,
	args: { config: CcProxyConfig; model: string; prompt: string; cwd: string; inputTokens: number },
) {
	const { config, model, prompt, cwd, inputTokens } = args;
	const id = messageId();
	writeSSEHead(res);

	res.write(encodeSSE('message_start', messageStart({ id, model, inputTokens })));
	res.write(encodeSSE('content_block_start', contentBlockStart({ index: 0 })));
	res.write(encodeSSE('ping', ping()));

	let outChars = 0;
	let toolCalls = 0;
	const writeText = (text: string) => {
		if (!text) return;
		outChars += text.length;
		res.write(encodeSSE('content_block_delta', contentBlockDelta({ index: 0, text })));
	};

	const { text } = await runComposerAgent({
		apiKey: config.apiKey,
		model,
		prompt,
		cwd,
		onToolActivity: (line) => {
			toolCalls++;
			trace(`    ${line}`);
			writeText(`\n${line}`);
		},
		onText: (delta) => writeText(delta),
	});
	// Backstop: if streaming yielded nothing but wait() returned text, flush it.
	if (outChars === 0 && text) writeText(text);
	trace(`  ✓ Composer done (${toolCalls} tool calls, ${outChars} chars streamed)`);

	res.write(encodeSSE('content_block_stop', contentBlockStop({ index: 0 })));
	res.write(
		encodeSSE('message_delta', messageDelta({ stopReason: 'end_turn', outputTokens: Math.ceil(outChars / 4) })),
	);
	res.write(encodeSSE('message_stop', messageStop()));
	res.end();
}

// Minimal valid streaming response for the probe guard — a single "ok" delta.
function streamProbe(res: ServerResponse, model: string) {
	const id = messageId();
	writeSSEHead(res);
	res.write(encodeSSE('message_start', messageStart({ id, model })));
	res.write(encodeSSE('content_block_start', contentBlockStart({ index: 0 })));
	res.write(encodeSSE('content_block_delta', contentBlockDelta({ index: 0, text: 'ok' })));
	res.write(encodeSSE('content_block_stop', contentBlockStop({ index: 0 })));
	res.write(encodeSSE('message_delta', messageDelta({ stopReason: 'end_turn', outputTokens: 1 })));
	res.write(encodeSSE('message_stop', messageStop()));
	res.end();
}

// A single non-streaming Anthropic message object.
function nonStreamMessage(res: ServerResponse, model: string, text: string, inputTokens = 0) {
	return sendJson(res, 200, {
		id: messageId(),
		type: 'message',
		role: 'assistant',
		model,
		content: [{ type: 'text', text }],
		stop_reason: 'end_turn',
		stop_sequence: null,
		usage: { input_tokens: inputTokens, output_tokens: Math.ceil(text.length / 4) },
	});
}

//* MARK: Passthrough branch

// Forward verbatim to the upstream Anthropic API (capture.ts forwarding, no
// recording). The client's x-api-key / authorization / anthropic-* headers ride
// through untouched.
function passthrough(req: IncomingMessage, res: ServerResponse, bodyBuf: Buffer, config: CcProxyConfig) {
	const rawUrl = req.url ?? '/';
	const upstream = new URL(rawUrl, config.upstream);
	const isHttps = upstream.protocol === 'https:';
	const doRequest = isHttps ? httpsRequest : httpRequest;

	const fwdHeaders: Record<string, string | string[]> = {};
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === undefined) continue;
		if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
		fwdHeaders[key] = value;
	}
	fwdHeaders['host'] = upstream.host;

	return new Promise<void>((resolve) => {
		const upstreamReq = doRequest(
			{
				protocol: upstream.protocol,
				hostname: upstream.hostname,
				port: upstream.port || (isHttps ? 443 : 80),
				method: req.method ?? 'POST',
				path: upstream.pathname + upstream.search,
				headers: fwdHeaders,
			},
			(upstreamRes) => {
				const status = upstreamRes.statusCode ?? 502;
				const clientHeaders: Record<string, string | string[]> = {};
				for (const [key, value] of Object.entries(upstreamRes.headers)) {
					if (value === undefined) continue;
					if (STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
					clientHeaders[key] = value;
				}
				res.writeHead(status, clientHeaders);
				upstreamRes.on('data', (chunk: Buffer) => res.write(chunk));
				upstreamRes.on('end', () => {
					res.end();
					resolve();
				});
				upstreamRes.on('error', () => {
					res.end();
					resolve();
				});
			},
		);

		upstreamReq.on('error', (err) => {
			if (!res.headersSent) {
				sendJson(res, 502, { error: { type: 'cc_proxy_upstream_error', message: errMsg(err) } });
			} else {
				res.end();
			}
			resolve();
		});

		if (bodyBuf.length) upstreamReq.write(bodyBuf);
		upstreamReq.end();
	});
}

//* MARK: Http helpers

function writeSSEHead(res: ServerResponse) {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
	});
}

// 'msg_' + random — clients only echo the id back. Math.random is fine in
// normal runtime code (only workflow scripts forbid it).
function messageId(): string {
	return 'msg_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c as Buffer));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

function parseJson(buf: Buffer): unknown {
	const raw = buf.toString('utf8');
	if (!raw) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

function sendJson(res: ServerResponse, status: number, obj: unknown) {
	const payload = JSON.stringify(obj);
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(payload);
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// Server-side trace so the proxy terminal shows which branch fired and what
// Composer actually did — the ground-truth check that Composer ran under the hood.
function trace(msg: string): void {
	const t = new Date().toISOString().slice(11, 19);
	console.log(`[cc ${t}] ${msg}`);
}
