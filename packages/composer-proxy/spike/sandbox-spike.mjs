// Spike #3 (Linux only) — does sandboxOptions.enabled confine Composer's
// built-in tools so it's FORCED to delegate via customTools?
//
// The blocker on Windows: Composer's built-ins roam the whole filesystem and it
// self-executes real tasks instead of emitting tool intents. Sandbox crashes on
// Windows ("not supported"). On Linux it may initialize and confine built-ins to
// the sandbox root — making them useless on an EMPTY cwd, so the only way to
// access real data is the custom tool we register (= Claude Code's tools).
//
// Decoy test: there's a real file on disk OUTSIDE the cwd with KNOWN content.
// We register a customTool that returns DIFFERENT content. Ask Composer to read
// it. If the answer contains the CUSTOM marker -> delegated (sandbox confined
// built-ins). If it contains the DECOY marker -> built-ins roamed (sandbox did
// not confine). If sandbox crashes -> not viable here.
//
//   CURSOR_API_KEY=... node sandbox-spike.mjs

import { Agent } from '@cursor/sdk';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) { console.error('CURSOR_API_KEY missing'); process.exit(2); }
const MODEL = { id: 'composer-2.5' };

const DECOY = 'export const SOURCE = "DECOY-FILE-ON-DISK";';
const CUSTOM = 'export const SOURCE = "CUSTOM-TOOL-DELEGATED";';

async function runCase({ label, sandbox, withCustomTool }) {
	console.log(`\n========== ${label} ==========`);
	// Empty cwd for the agent; decoy file lives in a SEPARATE real dir on disk.
	const cwd = mkdtempSync(join(tmpdir(), 'sbx-cwd-'));
	const decoyDir = mkdtempSync(join(tmpdir(), 'sbx-decoy-'));
	mkdirSync(join(decoyDir, 'src'), { recursive: true });
	const decoyPath = join(decoyDir, 'src', 'index.ts');
	writeFileSync(decoyPath, DECOY);

	let customCalled = false;
	const local = { cwd };
	if (sandbox) local.sandboxOptions = { enabled: true };
	if (withCustomTool) {
		local.customTools = {
			read_project_file: {
				description: "Read a file from the user's project by absolute or relative path. The filesystem is NOT directly accessible; you MUST use this tool for any file read.",
				inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
				execute: async ({ path }) => {
					customCalled = true;
					console.log(`    >> CUSTOM read_project_file(${path})`);
					return CUSTOM;
				},
			},
		};
	}

	const builtins = [];
	let text = '';
	try {
		const agent = await Agent.create({ apiKey, model: MODEL, local });
		const run = await agent.send(
			`Read the file "${decoyPath}" and tell me the exact value assigned to SOURCE. Report only that string.`,
		);
		for await (const ev of run.stream()) {
			if (ev.type === 'tool_call') builtins.push(ev.name);
			else if (ev.type === 'assistant') for (const c of ev.message?.content ?? []) if (c.type === 'text') text += c.text;
		}
		await run.wait();
	} catch (e) {
		console.log(`  CRASHED: ${e.message?.slice(0, 200)}`);
		return;
	}

	const sawDecoy = text.includes('DECOY-FILE-ON-DISK');
	const sawCustom = text.includes('CUSTOM-TOOL-DELEGATED');
	console.log(`  builtins used: ${JSON.stringify(builtins)}`);
	console.log(`  customToolCalled=${customCalled} sawDecoy=${sawDecoy} sawCustom=${sawCustom}`);
	console.log(`  answer: ${text.trim().slice(0, 160)}`);
	console.log(`  >> ${sawCustom && !sawDecoy ? 'DELEGATED (sandbox confined built-ins!)' : sawDecoy ? 'ROAMED (built-ins reached the decoy)' : 'inconclusive'}`);
}

async function main() {
	console.log('platform:', process.platform);
	await runCase({ label: 'A: NO sandbox + custom tool (baseline; expect roam on any OS)', sandbox: false, withCustomTool: true });
	await runCase({ label: 'B: sandbox + custom tool (the hopeful case)', sandbox: true, withCustomTool: true });
	await runCase({ label: 'C: sandbox, NO custom tool (does sandbox even init + confine?)', sandbox: true, withCustomTool: false });
}

main().then(() => process.exit(0)).catch((e) => { console.error('crashed:', e); process.exit(1); });
