// Anthropic Messages request parsing → Composer prompt. No SDK imports — pure
// shaping so it's trivially unit-testable. Mirrors openai.ts's flatten style.

//* MARK: Types

export interface AnthropicTextBlock {
	type: 'text';
	text?: string;
}

export interface AnthropicToolUseBlock {
	type: 'tool_use';
	name?: string;
	input?: unknown;
}

export interface AnthropicToolResultBlock {
	type: 'tool_result';
	content?: unknown;
}

export type AnthropicContentBlock =
	| AnthropicTextBlock
	| AnthropicToolUseBlock
	| AnthropicToolResultBlock
	| { type: string; [k: string]: unknown };

export interface AnthropicMessage {
	role: 'user' | 'assistant' | 'system' | string;
	content: string | AnthropicContentBlock[] | null;
}

export interface AnthropicSystemBlock {
	type?: string;
	text?: string;
}

export interface AnthropicMessagesRequest {
	model?: string;
	system?: string | AnthropicSystemBlock[];
	messages?: AnthropicMessage[];
	stream?: boolean;
	max_tokens?: number;
	// Everything else (temperature, tools, …) is accepted and ignored — Composer
	// runs its own tools and doesn't take Anthropic sampling params here.
	[k: string]: unknown;
}

//* MARK: System text

// Collapse `system` (string | array-of-{text}) into plain text.
export function systemToText(system: AnthropicMessagesRequest['system']): string {
	if (system == null) return '';
	if (typeof system === 'string') return system;
	return system
		.map((b) => (typeof b?.text === 'string' ? b.text : ''))
		.filter(Boolean)
		.join('\n\n');
}

// Collapse a message's content (string | blocks[]) to its text parts only.
function blocksToText(content: AnthropicMessage['content']): string {
	if (content == null) return '';
	if (typeof content === 'string') return content;
	return content
		.filter((b): b is AnthropicTextBlock => b?.type === 'text' && typeof (b as AnthropicTextBlock).text === 'string')
		.map((b) => b.text)
		.join('');
}

//* MARK: Cwd

// Scan the system text for `working directory: <path>` and return the trimmed
// path. Claude Code embeds it in its system prompt (see fixture 003/006).
export function extractCwd(body: AnthropicMessagesRequest): string | undefined {
	const sys = systemToText(body.system);
	const m = sys.match(/working directory:\s*(.+?)(\n|$)/i);
	if (!m) return undefined;
	const cwd = m[1].trim();
	return cwd || undefined;
}

//* MARK: Flatten

// Render an Anthropic transcript into a single prompt for Composer's
// agent.send(). System text leads; each turn is role-labelled. tool_use /
// tool_result blocks are rendered as readable lines so Composer has the prior
// context. We never tell Composer about the request's own `tools` — it runs its
// own toolset on the real cwd.
export function flattenRequest(body: AnthropicMessagesRequest): string {
	const parts: string[] = [];

	const sys = systemToText(body.system).trim();
	if (sys) parts.push(sys);

	for (const m of body.messages ?? []) {
		const label = m.role === 'assistant' ? 'Assistant' : m.role === 'user' ? 'User' : m.role;
		const rendered = renderMessage(m);
		if (rendered) parts.push(`${label}: ${rendered}`);
	}

	// Cue Composer that it's its turn to act on the real working tree.
	parts.push('Carry out the requested work in this repository now, using your own tools.');
	return parts.join('\n\n');
}

function renderMessage(m: AnthropicMessage): string {
	if (m.content == null) return '';
	if (typeof m.content === 'string') return m.content.trim();

	const lines: string[] = [];
	for (const block of m.content) {
		if (block?.type === 'text' && typeof (block as AnthropicTextBlock).text === 'string') {
			const t = (block as AnthropicTextBlock).text!.trim();
			if (t) lines.push(t);
		} else if (block?.type === 'tool_use') {
			const tu = block as AnthropicToolUseBlock;
			lines.push(`Assistant ran tool ${tu.name ?? 'tool'}(${stringifyInput(tu.input)})`);
		} else if (block?.type === 'tool_result') {
			const tr = block as AnthropicToolResultBlock;
			lines.push(`Tool result: ${stringifyContent(tr.content)}`);
		}
		// images and other block types are ignored
	}
	return lines.join('\n');
}

function stringifyInput(input: unknown): string {
	if (input == null) return '';
	if (typeof input === 'string') return input;
	try {
		return JSON.stringify(input);
	} catch {
		return String(input);
	}
}

function stringifyContent(content: unknown): string {
	if (content == null) return '';
	if (typeof content === 'string') return content;
	// tool_result content is often an array of {type:text,text}
	if (Array.isArray(content)) {
		return content
			.map((c) => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
			.filter(Boolean)
			.join('');
	}
	try {
		return JSON.stringify(content);
	} catch {
		return String(content);
	}
}

//* MARK: Token estimate

// ~chars/4 over system + all message text, for count_tokens. Cheap heuristic —
// clients only use it for budgeting, not billing.
export function estimateInputTokens(body: AnthropicMessagesRequest): number {
	let chars = systemToText(body.system).length;
	for (const m of body.messages ?? []) {
		chars += blocksToText(m.content).length;
	}
	return Math.ceil(chars / 4);
}
