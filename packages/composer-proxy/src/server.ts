// OpenAI-compatible HTTP surface. Plain node:http so it runs under stock node
// on Windows with zero native deps. Endpoints:
//   GET  /                     → health
//   GET  /v1/models            → advertises composer models
//   POST /v1/chat/completions  → stream + non-stream
//
// Auth: clients send any Bearer token (claude-code-router sends one); we don't
// check it. The REAL secret is CURSOR_API_KEY, held server-side and never
// exposed to clients — same posture as composer-api.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { runComposer } from './cursor.js';
import {
	buildChunk,
	buildCompletion,
	completionId,
	messagesToPrompt,
	type ChatCompletionRequest,
} from './openai.js';

export interface ProxyConfig {
	apiKey: string;
	host: string;
	port: number;
	/** Default Cursor model if the client doesn't pin one we recognise. */
	defaultModel: string;
}

const KNOWN_MODELS = ['composer-2.5', 'composer-2-fast', 'composer-2'];

export function createProxyServer(config: ProxyConfig) {
	return createServer((req, res) => {
		handle(req, res, config).catch((err) => {
			sendJson(res, 500, { error: { message: errMsg(err), type: 'proxy_error' } });
		});
	});
}

async function handle(req: IncomingMessage, res: ServerResponse, config: ProxyConfig) {
	const url = req.url ?? '/';

	if (req.method === 'GET' && (url === '/' || url === '/health')) {
		return sendJson(res, 200, { ok: true, service: 'composer-proxy' });
	}

	if (req.method === 'GET' && url.startsWith('/v1/models')) {
		return sendJson(res, 200, {
			object: 'list',
			data: KNOWN_MODELS.map((id) => ({ id, object: 'model', owned_by: 'cursor' })),
		});
	}

	if (req.method === 'POST' && url.startsWith('/v1/chat/completions')) {
		const body = (await readJson(req)) as ChatCompletionRequest;
		return handleChatCompletion(res, body, config);
	}

	return sendJson(res, 404, { error: { message: `no route for ${req.method} ${url}`, type: 'not_found' } });
}

async function handleChatCompletion(res: ServerResponse, body: ChatCompletionRequest, config: ProxyConfig) {
	if (!body?.messages?.length) {
		return sendJson(res, 400, { error: { message: 'messages is required', type: 'invalid_request_error' } });
	}

	const model = resolveModel(body.model, config.defaultModel);
	const prompt = messagesToPrompt(body.messages);
	const id = completionId();
	const created = Math.floor(Date.now() / 1000);

	if (body.stream) {
		return streamCompletion(res, { config, model, prompt, id, created });
	}

	const { text } = await runComposer({ apiKey: config.apiKey, model, prompt });
	return sendJson(res, 200, buildCompletion({ id, model, created, text }));
}

async function streamCompletion(
	res: ServerResponse,
	args: { config: ProxyConfig; model: string; prompt: string; id: string; created: number },
) {
	const { config, model, prompt, id, created } = args;
	res.writeHead(200, {
		'Content-Type': 'text/event-stream',
		'Cache-Control': 'no-cache',
		Connection: 'keep-alive',
	});

	const write = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

	await runComposer({
		apiKey: config.apiKey,
		model,
		prompt,
		onText: (delta) => write(buildChunk({ id, model, created, delta })),
	});

	write(buildChunk({ id, model, created, delta: '', done: true }));
	res.write('data: [DONE]\n\n');
	res.end();
}

// Pass through a Composer model the client explicitly asked for; otherwise use
// the configured default. claude-code-router will typically send the provider
// model id verbatim (e.g. "composer-2.5").
function resolveModel(requested: string | undefined, fallback: string): string {
	if (requested && KNOWN_MODELS.includes(requested)) return requested;
	return fallback;
}

// --- tiny http helpers -----------------------------------------------------

function readJson(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c as Buffer));
		req.on('end', () => {
			const raw = Buffer.concat(chunks).toString('utf8');
			if (!raw) return resolve({});
			try {
				resolve(JSON.parse(raw));
			} catch (e) {
				reject(new Error('invalid JSON body'));
			}
		});
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
