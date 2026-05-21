// Stream-json parser shared by adapters (cursor, gemini). Tolerates schema
// drift: returns the event object verbatim (passthrough). `tool_use` blocks
// typically arrive nested inside `assistant.message.content[]` (Anthropic
// Messages API shape); we walk recursively to find them wherever they live.

export type StreamEvent = Record<string, unknown>;

// Parse a single NDJSON line into an event. Null on blank/malformed so
// callers can still preserve those lines in the raw log.
export function parseLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as StreamEvent;
}

const CHAT_ID_KEYS = ['chat_id', 'chatId', 'session_id', 'sessionId'];

function dig(obj: unknown, keys: string[]): string | undefined {
  if (obj == null || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const v of Object.values(rec)) {
    const found = dig(v, keys);
    if (found) return found;
  }
  return undefined;
}

export function extractChatId(events: StreamEvent[]): string | undefined {
  for (const ev of events) {
    const id = dig(ev, CHAT_ID_KEYS);
    if (id) return id;
  }
  return undefined;
}

const WRITE_TOOL_HINTS = [
  'write',
  'edit',
  'str_replace',
  'create_file',
  'patch',
  'apply_patch',
  'file_write',
];

function looksLikeFileWrite(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  return WRITE_TOOL_HINTS.some((h) => lower.includes(h));
}

function pickString(obj: unknown, keys: string[]): string | undefined {
  if (obj == null || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

export interface ToolUse {
  name: string;
  input: unknown;
}

// Yield every `{type:'tool_use'|'tool_call', name: …}` object in the tree.
export function* walkToolUses(node: unknown): Iterable<ToolUse> {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walkToolUses(item);
    return;
  }
  const rec = node as Record<string, unknown>;
  const type = rec.type;
  const name = typeof rec.name === 'string' ? rec.name : undefined;
  if ((type === 'tool_use' || type === 'tool_call') && name) {
    yield {
      name,
      input: rec.input ?? rec.arguments ?? rec.params ?? rec.tool_input,
    };
  }
  for (const v of Object.values(rec)) yield* walkToolUses(v);
}

export interface Summary {
  summary: string;
  filesChanged: string[];
  exitReason: string;
  success: boolean;
}

export function summariseEvents(events: StreamEvent[]): Summary {
  const files = new Set<string>();
  let finalText: string | undefined;
  let success = true;
  let exitReason = 'completed';

  for (const ev of events) {
    for (const tu of walkToolUses(ev)) {
      if (!looksLikeFileWrite(tu.name)) continue;
      const path = pickString(tu.input, [
        'path',
        'file_path',
        'filename',
        'file',
        'target',
        'target_file',
      ]);
      if (path) files.add(path);
    }
    const type = ev.type;
    if (type === 'result') {
      const text =
        pickString(ev, ['result', 'text', 'message', 'content']) ??
        pickString(ev.message, ['text', 'content']);
      if (text) finalText = text;
      const subtype = typeof ev.subtype === 'string' ? ev.subtype : undefined;
      const isError = ev.is_error === true || ev.error != null;
      if (subtype && subtype !== 'success') {
        exitReason = subtype;
        if (subtype.includes('error') || subtype.includes('fail')) success = false;
      }
      if (isError) {
        success = false;
        exitReason = 'error';
      }
    }
  }

  if (!finalText) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev) continue;
      const type = ev.type;
      if (type === 'assistant' || type === 'message') {
        const text =
          pickString(ev, ['text', 'content', 'message']) ??
          pickString(ev.message, ['text', 'content']);
        if (text) {
          finalText = text;
          break;
        }
      }
    }
  }

  const summary = finalText ?? '(no final message captured)';
  return {
    summary,
    filesChanged: [...files],
    exitReason,
    success,
  };
}
