#!/usr/bin/env node
// composer-cc CLI entry. Starts the Claude Code proxy: point Claude Code's
// ANTHROPIC_BASE_URL at it. claude-* models pass through to the real Anthropic
// API; the configured composer model id routes to Cursor Composer running in
// the user's real repo. Flags override env; env overrides defaults.
//
//   composer-cc [--port 8790] [--host 127.0.0.1] [--model composer-2.5]
//               [--upstream https://api.anthropic.com] [--cwd <dir>]
//
// Env:
//   CURSOR_API_KEY        (required) Cursor Dashboard API key for @cursor/sdk
//   COMPOSER_CC_PORT      default 8790
//   COMPOSER_CC_HOST      default 127.0.0.1
//   COMPOSER_MODEL_ID     default composer-2.5
//   ANTHROPIC_UPSTREAM    default https://api.anthropic.com
//   COMPOSER_CWD          optional cwd override (else extracted per-request)

import { createCcProxyServer } from './cc-proxy.js';

interface Cli {
	port: number;
	host: string;
	model: string;
	upstream: string;
	cwd?: string;
}

function parseArgs(argv: string[]): Cli {
	const get = (flag: string) => {
		const i = argv.indexOf(flag);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const port = Number(get('--port') ?? process.env.COMPOSER_CC_PORT ?? 8790);
	const host = get('--host') ?? process.env.COMPOSER_CC_HOST ?? '127.0.0.1';
	const model = get('--model') ?? process.env.COMPOSER_MODEL_ID ?? 'composer-2.5';
	const upstream = get('--upstream') ?? process.env.ANTHROPIC_UPSTREAM ?? 'https://api.anthropic.com';
	const cwd = get('--cwd') ?? process.env.COMPOSER_CWD ?? undefined;
	return { port, host, model, upstream, cwd };
}

function main() {
	const apiKey = process.env.CURSOR_API_KEY?.trim();
	if (!apiKey) {
		console.error('composer-cc: CURSOR_API_KEY is not set. Get one from https://cursor.com/dashboard/api');
		process.exit(2);
	}

	const { port, host, model, upstream, cwd } = parseArgs(process.argv.slice(2));
	const server = createCcProxyServer({ apiKey, host, port, composerModelId: model, upstream, cwdOverride: cwd });

	server.listen(port, host, () => {
		console.log(`composer-cc → http://${host}:${port}`);
		console.log(`  composer model : ${model}  (routes to Cursor Composer in your repo)`);
		console.log(`  passthrough    : claude-* → ${upstream}`);
		console.log(`  cwd mode       : ${cwd ? `override → ${cwd}` : 'per-request (working directory from system prompt)'}`);
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
