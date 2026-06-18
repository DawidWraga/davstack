// Live spike: can Composer (via @cursor/sdk) be coerced into the
// emit-tool-intent / external-executor pattern Claude Code needs?
//
// Two candidate mechanisms tested:
//   A) customTools bridge  — register CC's tools as @cursor/sdk customTools,
//      block in execute() until an external executor returns. (E1, E2)
//   B) prompted tool-use   — treat Composer as a pure TEXT model; ask it to
//      emit tool calls as parseable text; we parse + execute externally.
//      Bypasses the SDK tool machinery entirely. (E4, E5)
//   + suppression probe for Composer's own built-in tools (E2, E3).
//
// Run with CURSOR_API_KEY in env. Compact output by design. Per-experiment
// timeout so a runaway agent can't wedge the whole run.

import { Agent } from '@cursor/sdk';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
	console.error('CURSOR_API_KEY missing');
	process.exit(2);
}
const MODEL = { id: process.env.SPIKE_MODEL || 'composer-2.5' };
const PER_EXPERIMENT_MS = 90_000;

function withTimeout(promise, ms, label) {
	return Promise.race([
		promise,
		new Promise((_, rej) => setTimeout(() => rej(new Error(`TIMEOUT after ${ms}ms`)), ms)),
	]).catch((e) => {
		console.log(`  [${label}] ERROR: ${e.message}`);
		return null;
	});
}

// Run one agent turn, log a compact view of the stream, return observations.
async function runTurn({ label, prompt, customTools, mode }) {
	console.log(`\n========== ${label} ==========`);
	const scratch = mkdtempSync(join(tmpdir(), 'spike-'));
	const obs = { builtinToolCalls: [], customToolCalls: [], assistantText: '', assistantToolUse: [], error: null };

	const work = (async () => {
		const opts = { apiKey, model: MODEL, local: { cwd: scratch } };
		if (customTools) opts.local.customTools = customTools;
		const agent = await Agent.create(opts);
		const sendOpts = {};
		if (mode) sendOpts.mode = mode;
		const run = await agent.send(prompt, sendOpts);

		for await (const ev of run.stream()) {
			if (ev.type === 'tool_call') {
				// Built-in (or MCP) tool the agent ran itself.
				const rec = { name: ev.name, status: ev.status, call_id: ev.call_id };
				console.log(`  [stream] tool_call name=${ev.name} status=${ev.status} args=${trunc(JSON.stringify(ev.args), 100)}`);
				if (ev.status === 'running' || ev.status === 'completed') obs.builtinToolCalls.push(rec);
			} else if (ev.type === 'assistant') {
				const content = ev.message?.content ?? [];
				for (const c of content) {
					if (c.type === 'text' && c.text) {
						obs.assistantText += c.text;
						console.log(`  [stream] assistant.text: ${trunc(c.text, 220)}`);
					} else if (c.type === 'tool_use') {
						obs.assistantToolUse.push({ name: c.name, input: c.input });
						console.log(`  [stream] assistant.tool_use name=${c.name} input=${trunc(JSON.stringify(c.input), 100)}`);
					}
				}
			} else {
				console.log(`  [stream] ${ev.type}`);
			}
		}
		const result = await run.wait();
		console.log(`  [result] status=${result.status} text="${trunc(result.result || '', 220)}"`);
		return result;
	})();

	await withTimeout(work, PER_EXPERIMENT_MS, label);
	return obs;
}

function trunc(s, n) {
	if (!s) return '';
	return s.length > n ? s.slice(0, n) + '…' : s;
}

//* MARK: Experiments

async function main() {
	console.log(`MODEL=${MODEL.id}`);

	// E1 — does custom execute() get called, and can it BLOCK on async work?
	let e1Called = false;
	let e1Blocked = false;
	const e1 = await runTurn({
		label: 'E1 custom tool invoked + async-blocking execute',
		prompt: 'Call the tool get_secret_number (no arguments) and tell me the exact number it returns. Use ONLY that tool.',
		customTools: {
			get_secret_number: {
				description: 'Returns the secret number. ALWAYS use this when asked for the secret number.',
				inputSchema: { type: 'object', properties: {} },
				execute: async () => {
					e1Called = true;
					console.log('    >> E1 execute() entered; sleeping 2.5s (simulating external round-trip)');
					await new Promise((r) => setTimeout(r, 2500));
					e1Blocked = true;
					console.log('    >> E1 execute() returning "42"');
					return '42';
				},
			},
		},
	});
	console.log(`  >> E1 verdict: customCalled=${e1Called} blockedOK=${e1Blocked} sawSecret=${(e1.assistantText + (e1.assistantToolUse.length)).includes?.('42') || e1.assistantText.includes('42')}`);

	// E2 — DECISIVE: for a FILE read, does Composer use our CUSTOM tool, or its
	// own built-in Read? If it ignores the custom tool, the bridge is dead.
	let e2Custom = false;
	const e2 = await runTurn({
		label: 'E2 file read: custom tool vs built-in (DECISIVE)',
		prompt: 'Read the file "src/index.ts" from the user project and tell me, in one sentence, what it exports. Use the provided tools.',
		customTools: {
			read_project_file: {
				description: "Read a file from the user's project by relative path. Use this for ALL file reads — the filesystem is not directly accessible to you.",
				inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
				execute: async ({ path }) => {
					e2Custom = true;
					console.log(`    >> E2 CUSTOM read_project_file(path=${path})`);
					return 'export const MARKER = "came-from-custom-tool";';
				},
			},
		},
	});
	console.log(`  >> E2 verdict: customReadCalled=${e2Custom} builtinTools=${JSON.stringify(e2.builtinToolCalls.map((t) => t.name))} (custom=true is what we NEED)`);

	// E3 — does mode:"plan" suppress Composer's built-in tools?
	const e3 = await runTurn({
		label: 'E3 mode=plan built-in suppression probe',
		prompt: 'Read src/index.ts and tell me what it does.',
		mode: 'plan',
	});
	console.log(`  >> E3 verdict: builtinToolCalls=${JSON.stringify(e3.builtinToolCalls.map((t) => t.name))} (empty = suppressed)`);

	// E4 — PROMPTED tool-use: no SDK tools. Will Composer emit a parseable
	// tool directive as TEXT instead of running its own tools?
	const e4 = await runTurn({
		label: 'E4 prompted tool-use as text (no SDK tools)',
		prompt: [
			'You are a reasoning model that does NOT execute tools yourself. An EXTERNAL system executes tools for you.',
			'Available tools: read_file(path), run_bash(command).',
			'When you need a tool, reply with EXACTLY one line and nothing else:',
			'TOOL_CALL {"name":"read_file","input":{"path":"..."}}',
			'Do NOT read or run anything yourself. Do NOT use any built-in tools.',
			'',
			'Task: find the "name" field in package.json.',
		].join('\n'),
	});
	const e4Emitted = /TOOL_CALL\s*\{/.test(e4.assistantText);
	console.log(`  >> E4 verdict: emittedTextDirective=${e4Emitted} usedBuiltinInstead=${e4.builtinToolCalls.length > 0} builtins=${JSON.stringify(e4.builtinToolCalls.map((t) => t.name))}`);

	// E5 — continuation: given a flattened transcript that already contains a
	// tool result, does Composer use it to produce the final answer?
	const e5 = await runTurn({
		label: 'E5 continue from flattened transcript w/ prior tool result',
		prompt: [
			'Conversation so far (you are the Assistant; continue it):',
			'User: what is the "name" field in package.json?',
			'Assistant: TOOL_CALL {"name":"read_file","input":{"path":"package.json"}}',
			'Tool read_file returned: {"name":"@davstack/composer-proxy","version":"0.1.0"}',
			'',
			'Using the tool result above, give the user the final answer in plain text. Do not call any tool.',
		].join('\n'),
	});
	const e5Used = e5.assistantText.includes('@davstack/composer-proxy') || (e5.assistantToolUse.length === 0 && /composer-proxy/.test(e5.assistantText));
	console.log(`  >> E5 verdict: usedInjectedResult=${e5Used}`);

	console.log('\n\n=================== SUMMARY ===================');
	console.log(`E1 customTool blocking : called=${e1Called} blockedOK=${e1Blocked}`);
	console.log(`E2 custom-over-builtin : custom=${e2Custom} builtins=${JSON.stringify(e2.builtinToolCalls.map((t) => t.name))}  <-- DECISIVE for bridge`);
	console.log(`E3 plan suppresses bi  : builtins=${JSON.stringify(e3.builtinToolCalls.map((t) => t.name))}`);
	console.log(`E4 prompted-tooluse    : emittedDirective=${e4Emitted} usedBuiltin=${e4.builtinToolCalls.length > 0}  <-- viability of approach B`);
	console.log(`E5 transcript continue : usedResult=${e5Used}`);
	console.log('==============================================');
}

main().then(() => process.exit(0)).catch((e) => {
	console.error('spike crashed:', e);
	process.exit(1);
});
