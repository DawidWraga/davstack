// OpenAI Chat Completions <-> Composer translation. No SDK imports here — pure
// shaping so it's trivially unit-testable.

export interface OpenAIContentPart {
	type: string;
	text?: string;
}

export interface OpenAIMessage {
	role: 'system' | 'user' | 'assistant' | 'tool' | string;
	content: string | OpenAIContentPart[] | null;
}

export interface ChatCompletionRequest {
	model?: string;
	messages: OpenAIMessage[];
	stream?: boolean;
	// Everything else (temperature, max_tokens, tools, …) is accepted and
	// ignored — Composer doesn't take OpenAI sampling params on this path.
	[k: string]: unknown;
}

// Collapse OpenAI content (string | parts[]) into plain text.
export function contentToText(content: OpenAIMessage['content']): string {
	if (content == null) return '';
	if (typeof content === 'string') return content;
	return content
		.filter((p) => p?.type === 'text' && typeof p.text === 'string')
		.map((p) => p.text)
		.join('');
}

// Flatten a chat transcript into a single prompt for agent.send(). System
// messages become a leading instruction block; the rest are role-labelled so
// Composer can follow multi-turn context.
export function messagesToPrompt(messages: OpenAIMessage[]): string {
	const system: string[] = [];
	const turns: string[] = [];

	for (const m of messages) {
		const text = contentToText(m.content).trim();
		if (!text) continue;
		if (m.role === 'system') {
			system.push(text);
		} else {
			const label = m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : m.role;
			turns.push(`${label}: ${text}`);
		}
	}

	const parts: string[] = [];
	if (system.length) parts.push(system.join('\n\n'));
	if (turns.length) parts.push(turns.join('\n\n'));
	// Cue the model that it's the assistant's turn to respond.
	if (turns.length) parts.push('Assistant:');
	return parts.join('\n\n');
}

// --- response envelopes ----------------------------------------------------

export function completionId(): string {
	// Random-ish without Date.now/Math.random determinism concerns — good
	// enough for a local proxy id; clients only echo it back.
	return 'chatcmpl-composer-' + Math.abs(hashString(String(globalThis.performance?.now?.() ?? '') + ':' )).toString(36);
}

function hashString(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
	return h;
}

export interface BuildCompletionOpts {
	id: string;
	model: string;
	created: number;
	text: string;
}

export function buildCompletion(opts: BuildCompletionOpts) {
	return {
		id: opts.id,
		object: 'chat.completion',
		created: opts.created,
		model: opts.model,
		choices: [
			{
				index: 0,
				message: { role: 'assistant', content: opts.text },
				finish_reason: 'stop',
			},
		],
		// Cursor's path doesn't return token accounting; estimate from chars so
		// clients have *something*. Mirrors composer-api's behaviour.
		usage: estimateUsage(opts.text),
	};
}

export function buildChunk(opts: { id: string; model: string; created: number; delta: string; done?: boolean }) {
	return {
		id: opts.id,
		object: 'chat.completion.chunk',
		created: opts.created,
		model: opts.model,
		choices: [
			{
				index: 0,
				delta: opts.done ? {} : { content: opts.delta },
				finish_reason: opts.done ? 'stop' : null,
			},
		],
	};
}

function estimateUsage(text: string) {
	const completion = Math.ceil(text.length / 4);
	return { prompt_tokens: 0, completion_tokens: completion, total_tokens: completion };
}
