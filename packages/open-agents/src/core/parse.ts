// Stream-json parser for cursor-agent output.
// Tolerates schema drift: returns the event object verbatim (passthrough).
// Cursor typically emits `tool_use` blocks nested inside `assistant.message.content[]`
// (Anthropic Messages API shape); we walk recursively to find them wherever they live.

/**
 * @typedef {Object<string, unknown>} CursorEvent
 */

/**
 * Parse a single NDJSON line into an event object. Returns null for blank
 * or malformed lines so callers can still preserve them in the raw log.
 *
 * @param {string} line
 * @returns {CursorEvent|null}
 */
export function parseLine(line) {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed;
}

const CHAT_ID_KEYS = ['chat_id', 'chatId', 'session_id', 'sessionId'];

function dig(obj, keys) {
  if (obj == null || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const v of Object.values(obj)) {
    const found = dig(v, keys);
    if (found) return found;
  }
  return undefined;
}

/**
 * @param {CursorEvent[]} events
 * @returns {string|undefined}
 */
export function extractChatId(events) {
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

function looksLikeFileWrite(name) {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  return WRITE_TOOL_HINTS.some((h) => lower.includes(h));
}

function pickString(obj, keys) {
  if (obj == null || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Yield every `{type: 'tool_use', name: …}` object anywhere in the tree.
 *
 * @param {unknown} node
 * @returns {Iterable<{name: string, input: unknown}>}
 */
export function* walkToolUses(node) {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walkToolUses(item);
    return;
  }
  const type = node.type;
  const name = typeof node.name === 'string' ? node.name : undefined;
  if ((type === 'tool_use' || type === 'tool_call') && name) {
    yield {
      name,
      input: node.input ?? node.arguments ?? node.params ?? node.tool_input,
    };
  }
  for (const v of Object.values(node)) yield* walkToolUses(v);
}

/**
 * @typedef {Object} Summary
 * @property {string} summary
 * @property {string[]} filesChanged
 * @property {string} exitReason
 * @property {boolean} success
 */

/**
 * @param {CursorEvent[]} events
 * @returns {Summary}
 */
export function summariseEvents(events) {
  const files = new Set();
  let finalText;
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
