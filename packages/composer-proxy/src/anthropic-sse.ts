// Anthropic Messages SSE event builders. No SDK imports — pure shaping so it's
// trivially unit-testable. Shapes match a real captured Claude Code stream
// (see .captures/003-*-messages.json): message_start → content_block_start →
// content_block_delta* → content_block_stop → message_delta → message_stop,
// with an optional ping after content_block_start.
//
// We only ever emit a single text content block (index 0); Composer's work is
// narrated as plain text, never as tool_use blocks — Claude Code renders it as
// the subagent's assistant message.

//* MARK: Events

export interface MessageStartOpts {
	id: string;
	model: string;
	inputTokens?: number;
}

export function messageStart(opts: MessageStartOpts) {
	return {
		type: 'message_start',
		message: {
			id: opts.id,
			type: 'message',
			role: 'assistant',
			model: opts.model,
			content: [] as unknown[],
			stop_reason: null,
			stop_sequence: null,
			usage: {
				input_tokens: opts.inputTokens ?? 0,
				output_tokens: 0,
			},
		},
	};
}

export interface ContentBlockStartOpts {
	index: number;
}

export function contentBlockStart(opts: ContentBlockStartOpts) {
	return {
		type: 'content_block_start',
		index: opts.index,
		content_block: { type: 'text', text: '' },
	};
}

export interface ContentBlockDeltaOpts {
	index: number;
	text: string;
}

export function contentBlockDelta(opts: ContentBlockDeltaOpts) {
	return {
		type: 'content_block_delta',
		index: opts.index,
		delta: { type: 'text_delta', text: opts.text },
	};
}

export function ping() {
	return { type: 'ping' };
}

export interface ContentBlockStopOpts {
	index: number;
}

export function contentBlockStop(opts: ContentBlockStopOpts) {
	return { type: 'content_block_stop', index: opts.index };
}

export interface MessageDeltaOpts {
	stopReason: string;
	outputTokens: number;
}

export function messageDelta(opts: MessageDeltaOpts) {
	return {
		type: 'message_delta',
		delta: { stop_reason: opts.stopReason, stop_sequence: null },
		usage: { output_tokens: opts.outputTokens },
	};
}

export function messageStop() {
	return { type: 'message_stop' };
}

//* MARK: Encode

// Encode one SSE record: `event: <name>\ndata: <json>\n\n`. The `event:` line
// mirrors the data object's `type`, matching the real Anthropic wire format.
export function encodeSSE(eventName: string, dataObj: unknown): string {
	return `event: ${eventName}\ndata: ${JSON.stringify(dataObj)}\n\n`;
}
