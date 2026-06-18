#!/usr/bin/env node
// composer-proxy CLI entry. Parses flags/env, then starts the OpenAI-compatible
// server. Flags override env; env overrides defaults.
//
//   composer-proxy [--port 8787] [--host 127.0.0.1] [--model composer-2.5]
//
// Env:
//   CURSOR_API_KEY            (required) Cursor Dashboard API key for @cursor/sdk
//   COMPOSER_PROXY_PORT       default 8787
//   COMPOSER_PROXY_HOST       default 127.0.0.1
//   COMPOSER_PROXY_MODEL      default composer-2.5

import { createProxyServer } from './server.js';

interface Cli {
	port: number;
	host: string;
	model: string;
}

function parseArgs(argv: string[]): Cli {
	const get = (flag: string) => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const port = Number(get('--port') ?? process.env.COMPOSER_PROXY_PORT ?? 8787);
	const host = get('--host') ?? process.env.COMPOSER_PROXY_HOST ?? '127.0.0.1';
	const model = get('--model') ?? process.env.COMPOSER_PROXY_MODEL ?? 'composer-2.5';
	return { port, host, model };
}

function main() {
	const apiKey = process.env.CURSOR_API_KEY?.trim();
	if (!apiKey) {
		console.error('composer-proxy: CURSOR_API_KEY is not set. Get one from https://cursor.com/dashboard/api');
		process.exit(2);
	}

	const { port, host, model } = parseArgs(process.argv.slice(2));
	const server = createProxyServer({ apiKey, host, port, defaultModel: model });

	server.listen(port, host, () => {
		console.log(`composer-proxy → http://${host}:${port}/v1  (model: ${model})`);
		console.log('Point an OpenAI client (or claude-code-router) at this base URL.');
	});

	const shutdown = () => server.close(() => process.exit(0));
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

main();
