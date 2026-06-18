// Spike #2 — realistic reliability test for Approach B (prompted tool-use).
// Load a REAL captured Claude Code request (52 tools, real multi-turn history),
// flatten it into an Approach-B prompt, send to Composer, and see whether it
// emits a valid TOOL_CALL directive comparable to what real Claude did.
//
// This both de-risks reliability at real scale AND prototypes the translator's
// request-flattening (system + tools + messages -> single prompt).
//
//   CURSOR_API_KEY=... node fixture-replay-spike.mjs <path-to-fixture.json>

import { Agent } from '@cursor/sdk';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const apiKey = process.env.CURSOR_API_KEY;
const fixturePath = process.argv[2];
if (!apiKey || !fixturePath) {
	console.error('usage: CURSOR_API_KEY=... node fixture-replay-spike.mjs <fixture.json>');
	process.exit(2);
}

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const body = fixture.request.body;

//* MARK: Flatten (prototype of the translator request side)

function systemText(system) {
	if (!system) return '';
	if (typeof system === 'string') return system;
	if (Array.isArray(system)) return system.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
	return '';
}

function renderTools(tools) {
	if (!Array.isArray(tools) || !tools.length) return '';
	const lines = tools.map((t) => {
		const schema = t.input_schema ? JSON.stringify(t.input_schema) : '{}';
		return `- ${t.name}: ${t.description ? t.description.split('\n')[0] : ''}\n    input_schema: ${schema}`;
	});
	return lines.join('\n');
}

function renderMessages(messages) {
	const out = [];
	for (const m of messages) {
		const role = m.role === 'assistant' ? 'Assistant' : 'User';
		if (typeof m.content === 'string') {
			out.push(`${role}: ${m.content}`);
			continue;
		}
		if (!Array.isArray(m.content)) continue;
		for (const c of m.content) {
			if (c.type === 'text') out.push(`${role}: ${c.text}`);
			else if (c.type === 'tool_use') out.push(`Assistant called tool ${c.name} (id=${c.id}) with input ${JSON.stringify(c.input)}`);
			else if (c.type === 'tool_result') {
				const content = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
				out.push(`Tool result (for id=${c.tool_use_id}): ${truncate(content, 1500)}`);
			} else if (c.type === 'image') out.push(`${role}: [image omitted]`);
		}
	}
	return out.join('\n\n');
}

function truncate(s, n) {
	return s && s.length > n ? s.slice(0, n) + '…[truncated]' : s || '';
}

function buildPrompt(body) {
	const harness = [
		'You are an inference engine driving an external coding agent. You do NOT execute tools yourself — an EXTERNAL system executes them and returns results to you.',
		'',
		'When you need to act, reply with EXACTLY one line, nothing before or after:',
		'TOOL_CALL {"name":"<tool name>","input":{<args matching that tool\'s input_schema>}}',
		'If and only if you are completely done and have a final answer for the user, reply with plain text (no TOOL_CALL line).',
		'Never invent tools; only use the AVAILABLE TOOLS. Never attempt to read/run anything yourself.',
		'',
		'=== AVAILABLE TOOLS ===',
		renderTools(body.tools),
		'',
		...(process.env.SPIKE_NO_CC_SYS === '1'
			? ['(host system instructions omitted for this test)']
			: ['=== SYSTEM INSTRUCTIONS ===', truncate(systemText(body.system), 6000)]),
		'',
		'=== CONVERSATION ===',
		renderMessages(body.messages || []),
		'',
		'CRITICAL: You have NO filesystem or shell access. You CANNOT read, search, or run anything yourself. Your ONLY way to act is to emit exactly one TOOL_CALL line for the external system to execute. Emit ONE TOOL_CALL line now (or a final plain-text answer if truly done).',
	].join('\n');
	return harness;
}

//* MARK: Run

async function main() {
	const prompt = buildPrompt(body);
	console.log(`fixture: ${fixturePath}`);
	console.log(`model in fixture: ${body.model} | tools: ${(body.tools || []).length} | messages: ${(body.messages || []).length}`);
	console.log(`prompt chars: ${prompt.length}`);

	// What did REAL Claude do in response? (ground truth from the capture)
	const realToolUse = [];
	for (const e of fixture.response.events || []) {
		if (e.event === 'content_block_start' && e.data?.content_block?.type === 'tool_use') {
			realToolUse.push(e.data.content_block.name);
		}
	}
	console.log(`REAL Claude next action: ${realToolUse.length ? 'tool_use ' + JSON.stringify(realToolUse) : 'text'}`);
	console.log('\n--- sending flattened prompt to Composer ---\n');

	const scratch = mkdtempSync(join(tmpdir(), 'replay-'));
	const local = { cwd: scratch };
	if (process.env.SPIKE_SANDBOX === '1') {
		local.sandboxOptions = { enabled: true };
		console.log('(sandboxOptions.enabled = true)');
	}
	const agent = await Agent.create({ apiKey, model: { id: 'composer-2.5' }, local });
	const run = await agent.send(prompt);
	let text = '';
	let builtinUsed = [];
	for await (const ev of run.stream()) {
		if (ev.type === 'tool_call') builtinUsed.push(ev.name);
		else if (ev.type === 'assistant') {
			for (const c of ev.message?.content ?? []) if (c.type === 'text') text += c.text;
		}
	}
	await run.wait();

	console.log('Composer raw output:\n' + text.trim());
	console.log('\n--- verdict ---');
	const m = text.match(/TOOL_CALL\s*(\{[\s\S]*?\})/);
	let parsed = null;
	if (m) {
		try {
			parsed = JSON.parse(m[1]);
		} catch (e) {
			console.log(`emitted a TOOL_CALL but JSON.parse failed: ${e.message}`);
		}
	}
	console.log(`Composer emitted directive: ${!!m}`);
	if (parsed) {
		const validName = (body.tools || []).some((t) => t.name === parsed.name);
		console.log(`  name=${parsed.name} validToolName=${validName} input=${truncate(JSON.stringify(parsed.input), 200)}`);
		console.log(`  matches a tool real-Claude used: ${realToolUse.includes(parsed.name)}`);
	}
	console.log(`Composer used its OWN builtin tools instead: ${builtinUsed.length > 0} ${JSON.stringify(builtinUsed)}`);
}

main().then(() => process.exit(0)).catch((e) => {
	console.error('crashed:', e);
	process.exit(1);
});
