// The ONLY file that touches @cursor/sdk. Everything Composer-specific lives
// here so the OpenAI-facing server stays a dumb translator, and so a future
// @cursor/sdk version bump is a one-file change.
//
// @cursor/sdk is agentic (Agent.create / agent.send), not a plain chat API —
// but for a single prompt with no tool use it just returns assistant text,
// which is exactly what a haiku-class slot (summarise / title / compact) needs.
//
// We point `local.cwd` at an isolated throwaway scratch dir, NOT a real repo:
// the haiku slot only generates text, and we never want the agent touching a
// working tree. If the installed SDK exposes a tool-free / chat-only mode,
// prefer it here.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '@cursor/sdk';

// One scratch cwd for the process lifetime. Empty dir → nothing for the agent
// to read or clobber.
let SCRATCH: string | undefined;
function scratchDir(): string {
	if (!SCRATCH) SCRATCH = mkdtempSync(join(tmpdir(), 'composer-proxy-'));
	return SCRATCH;
}

export interface RunComposerOpts {
	apiKey: string;
	/** Cursor model id, e.g. "composer-2.5" or "composer-2-fast". */
	model: string;
	/** Flattened prompt (system + conversation) — see openai.ts. */
	prompt: string;
	/** Called with each incremental text delta when streaming. */
	onText?: (delta: string) => void;
	signal?: AbortSignal;
}

export interface RunComposerResult {
	text: string;
}

export async function runComposer(opts: RunComposerOpts): Promise<RunComposerResult> {
	const { apiKey, model, prompt, onText, signal } = opts;

	const agent = await Agent.create({
		apiKey,
		model: { id: model },
		local: { cwd: scratchDir() },
	});

	const run = await agent.send(prompt);

	// Non-streaming: just wait for the final assistant text.
	if (!onText) {
		const final = await run.wait();
		return { text: extractFinalText(final) };
	}

	// Streaming: emit deltas as assistant text blocks arrive. Block text may be
	// either incremental OR a cumulative snapshot depending on SDK version —
	// emitDelta() handles both by diffing against what we've already sent.
	let full = '';
	const emit = (blockText: string) => {
		const delta = computeDelta(full, blockText);
		if (!delta) return;
		full += delta;
		onText(delta);
	};

	for await (const event of run.stream()) {
		if (signal?.aborted) break;
		if (event?.type !== 'assistant') continue;
		const content = event.message?.content ?? [];
		for (const block of content) {
			if (block?.type === 'text' && typeof block.text === 'string') emit(block.text);
		}
	}

	// Backstop: if the stream yielded no text blocks, fall back to the final.
	if (!full) {
		const final = await run.wait();
		const text = extractFinalText(final);
		if (text) {
			full = text;
			onText(text);
		}
	}

	return { text: full };
}

//* MARK: Agent

export interface RunAgentOpts {
	apiKey: string;
	/** Cursor model id, e.g. "composer-2.5". */
	model: string;
	/** Flattened prompt (system + conversation) — see anthropic-request.ts. */
	prompt: string;
	/** REAL working tree Composer acts on. Defaults to process.cwd(). */
	cwd?: string;
	/** Incremental assistant text deltas. */
	onText?: (delta: string) => void;
	/** One-line narrations of Composer's OWN tool executions (grep/edit/shell). */
	onToolActivity?: (line: string) => void;
}

export interface RunAgentResult {
	text: string;
}

// Run Composer as a self-executing agent in the user's REAL repo. Unlike
// runComposer (text-only, scratch cwd), this points local.cwd at the actual
// working tree so Composer's own tools edit real files. Assistant text streams
// out as deltas; Composer's tool_call events are surfaced as concise narration
// so the work stays visible in Claude Code's subagent view.
export async function runComposerAgent(opts: RunAgentOpts): Promise<RunAgentResult> {
	const { apiKey, model, prompt, cwd, onText, onToolActivity } = opts;

	const agent = await Agent.create({
		apiKey,
		model: { id: model },
		local: { cwd: cwd ?? process.cwd() },
	});

	const run = await agent.send(prompt);

	// Accumulate assistant text, diffing each block against what we've emitted
	// (blocks may be cumulative OR incremental across SDK versions).
	let full = '';
	const emitText = (blockText: string) => {
		const delta = computeDelta(full, blockText);
		if (!delta) return;
		full += delta;
		onText?.(delta);
	};

	for await (const event of run.stream() as AsyncIterable<Record<string, unknown>>) {
		const type = event?.type;
		if (type === 'assistant') {
			const content = (event as { message?: { content?: unknown[] } }).message?.content ?? [];
			for (const block of content) {
				const b = block as { type?: string; text?: unknown };
				if (b?.type === 'text' && typeof b.text === 'string') emitText(b.text);
			}
		} else if (type === 'tool_call') {
			// Composer's OWN tool execution. Narrate it once, when it starts.
			const tc = event as { name?: string; status?: string; args?: unknown };
			if (tc.status === 'running') {
				onToolActivity?.(`› ${tc.name ?? 'tool'} ${shortArgs(tc.args)}`.trimEnd());
			}
		}
	}

	// Backstop: prefer accumulated text; fall back to the final result.
	const final = await run.wait();
	if (!full) {
		const text = extractFinalText(final);
		if (text) full = text;
	}

	return { text: full };
}

// Render tool args as a compact one-liner, truncated to ~80 chars.
function shortArgs(args: unknown): string {
	if (args == null) return '';
	let s: string;
	if (typeof args === 'string') s = args;
	else {
		try {
			s = JSON.stringify(args);
		} catch {
			s = String(args);
		}
	}
	s = s.replace(/\s+/g, ' ').trim();
	return s.length > 80 ? s.slice(0, 79) + '…' : s;
}

// Given what's already been emitted (`prev`) and the next block (`next`),
// return only the new tail. Covers both wire styles:
//   - cumulative: next = prev + tail  → returns tail
//   - incremental: next is itself the tail → returns next (when not a prefix)
function computeDelta(prev: string, next: string): string {
	if (!prev) return next;
	if (next === prev) return '';
	if (next.startsWith(prev)) return next.slice(prev.length);
	return next;
}

// The final Run result shape isn't strongly typed across SDK versions; the
// documented field is `.result` (string). Be liberal in what we accept.
function extractFinalText(final: unknown): string {
	if (typeof final === 'string') return final;
	const r = final as { result?: unknown; text?: unknown } | null | undefined;
	if (r && typeof r.result === 'string') return r.result;
	if (r && typeof r.text === 'string') return r.text;
	return '';
}
