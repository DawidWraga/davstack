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
