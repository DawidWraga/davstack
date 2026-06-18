#!/usr/bin/env node
// composer-proxy launcher. Runs the compiled dist/index.js under plain node by
// default; bun stays as an opt-in via COMPOSER_PROXY_RUNTIME=bun. Mirrors the
// open-agents / logs-server launchers so the Windows `bun` .cmd-shim + spaces-
// in-execPath handling is identical and battle-tested.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'dist', 'index.js');
const runtime = process.env.COMPOSER_PROXY_RUNTIME ?? 'node';

let cmd, args;
if (runtime === 'node') {
	cmd = process.execPath;
	args = [entry, ...process.argv.slice(2)];
} else if (runtime === 'bun') {
	cmd = 'bun';
	args = [entry, ...process.argv.slice(2)];
} else {
	console.error(`composer-proxy: unknown COMPOSER_PROXY_RUNTIME='${runtime}' (expected 'node' or 'bun')`);
	process.exit(2);
}

// shell:true on win32 is needed for the `bun` .cmd shim but breaks
// process.execPath (spaces in "Program Files"). Gate it to bun.
const needsShell = process.platform === 'win32' && runtime === 'bun';
const child = spawn(cmd, args, { stdio: 'inherit', shell: needsShell });
child.on('error', (err) => {
	if (err.code === 'ENOENT' && runtime === 'bun') {
		console.error('composer-proxy: bun not found on PATH. Install bun (https://bun.sh) or unset COMPOSER_PROXY_RUNTIME.');
	} else {
		console.error('composer-proxy: launcher error:', err);
	}
	process.exit(1);
});
child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	else process.exit(code ?? 0);
});
