import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export const DEFAULT_DIRECT_HISTORY_TOKENS = 100_000;

export interface ConversationHistory {
  path: string;
  text: string;
  tokens: number;
  messages: ConversationMessage[];
}

export interface CuratedHistory {
  taskId: string;
  relevantHistory: string;
}

export function tokenLikeCount(text: string): number {
  return (text.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || []).length;
}

function visibleTextFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      const type = typeof item.type === "string" ? item.type : "";
      if (type && !type.includes("text")) return "";
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function genericVisibleMessage(row: unknown): ConversationMessage | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  const candidate =
    item.message && typeof item.message === "object"
      ? (item.message as Record<string, unknown>)
      : item;
  const role = candidate.role;
  if (role !== "user" && role !== "assistant") return null;
  const content = visibleTextFromContent(candidate.content);
  return content ? { role, content } : null;
}

function codexVisibleMessage(row: unknown): ConversationMessage | null {
  if (!row || typeof row !== "object") return null;
  const item = row as Record<string, unknown>;
  if (
    item.type !== "event_msg" ||
    !item.payload ||
    typeof item.payload !== "object"
  ) {
    return null;
  }
  const payload = item.payload as Record<string, unknown>;
  const content = payload.message ?? payload.text;
  if (typeof content !== "string" || !content.trim()) return null;
  if (payload.type === "user_message") {
    return { role: "user", content: content.trim() };
  }
  if (payload.type === "agent_message") {
    return { role: "assistant", content: content.trim() };
  }
  return null;
}

export function parseConversationMessages(text: string): ConversationMessage[] {
  const codexMessages: ConversationMessage[] = [];
  const genericMessages: ConversationMessage[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const codexMessage = codexVisibleMessage(row);
    if (codexMessage) {
      codexMessages.push(codexMessage);
      continue;
    }
    const genericMessage = genericVisibleMessage(row);
    if (genericMessage) genericMessages.push(genericMessage);
  }
  return codexMessages.length ? codexMessages : genericMessages;
}

export function renderConversationMessages(
  messages: ConversationMessage[],
): string {
  return messages
    .map(
      (message) =>
        `${message.role === "assistant" ? "Assistant" : "User"}:\n${message.content}`,
    )
    .join("\n\n")
    .trim();
}

export function loadConversationHistory(path: string): ConversationHistory {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    throw new Error(`history file not found: ${resolved}`);
  }
  const messages = parseConversationMessages(readFileSync(resolved, "utf8"));
  const text = renderConversationMessages(messages);
  return { path: resolved, text, tokens: tokenLikeCount(text), messages };
}

export function historyNeedsCuration(
  historyTokens: number,
  directLimit = DEFAULT_DIRECT_HISTORY_TOKENS,
): boolean {
  return historyTokens > directLimit;
}

export function buildHistoryCuratorTask(input: {
  tasks: Array<{ taskId: string; task: string }>;
  historyPath: string;
  historyText: string;
}): string {
  return `# Select task-relevant conversation history

The executor tasks below are authoritative and must remain verbatim. For each
task, select only prior conversation details that could change how its executor
works: decisions, constraints, corrections, non-goals, useful paths, and
unresolved questions. Do not solve, expand, or rewrite any task. Do not create
one shared summary: relevance is task-specific.

Return strict JSON only, with exactly one entry for every supplied task ID:
{"contexts":[{"taskId":"task-1","relevantHistory":"concise relevant context"}]}
Emit the JSON object exactly once, with nothing after its final closing brace.

Keep each relevantHistory value concise. Omit unrelated turns, tool chatter,
status updates, stale decisions superseded later, and instructions unrelated to
the task. If nothing is relevant, use an empty string.

History source: ${input.historyPath}

Tasks:
${JSON.stringify(input.tasks, null, 2)}

Conversation history:
<conversation_history>
${input.historyText}
</conversation_history>
`;
}

// End index of the balanced JSON object opening at `start`, honouring string
// literals and escapes; -1 when the object never closes.
function balancedObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function parseCuratedHistory(
  text: string,
  taskIds: string[],
): Map<string, string> {
  // Curator models sometimes wrap the strict JSON in preamble or append junk
  // after it (observed live: prose with a glued sentinel, then the JSON, then
  // a stray `}` and an `<|eos|>` artifact on the next line). Slicing from the
  // first `{` to the LAST `}` glued that junk onto valid JSON and crashed
  // JSON.parse, so instead take the first balanced object that parses and
  // carries the contexts array, ignoring anything around it.
  let parsed: { contexts: CuratedHistory[] } | null = null;
  let sawJsonObject = false;
  for (
    let start = text.indexOf("{");
    start >= 0 && !parsed;
    start = text.indexOf("{", start + 1)
  ) {
    const end = balancedObjectEnd(text, start);
    if (end < 0) continue;
    let candidate: unknown;
    try {
      candidate = JSON.parse(text.slice(start, end + 1));
    } catch {
      continue;
    }
    if (candidate == null || typeof candidate !== "object") continue;
    sawJsonObject = true;
    if (Array.isArray((candidate as { contexts?: unknown }).contexts)) {
      parsed = candidate as { contexts: CuratedHistory[] };
    }
  }
  if (!parsed) {
    throw new Error(
      sawJsonObject
        ? "history curator JSON is missing contexts"
        : "history curator returned no JSON object",
    );
  }
  const expected = new Set(taskIds);
  const contexts = new Map<string, string>();
  for (const item of parsed.contexts) {
    if (
      !item ||
      typeof item.taskId !== "string" ||
      typeof item.relevantHistory !== "string"
    ) {
      throw new Error("history curator returned an invalid context entry");
    }
    if (!expected.has(item.taskId) || contexts.has(item.taskId)) {
      throw new Error(
        `history curator returned an unexpected or duplicate task ID: ${item.taskId}`,
      );
    }
    contexts.set(item.taskId, item.relevantHistory.trim());
  }
  const missing = taskIds.filter((taskId) => !contexts.has(taskId));
  if (missing.length) {
    throw new Error(`history curator omitted task IDs: ${missing.join(", ")}`);
  }
  return contexts;
}

export function findClaudeTranscriptBySession(
  sessionId: string,
  homeDir = homedir(),
): string | null {
  if (!sessionId.trim()) return null;
  const projectsDir = join(homeDir, ".claude", "projects");
  if (!existsSync(projectsDir)) return null;
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(projectsDir, entry.name, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function walkFiles(
  dir: string,
  predicate: (path: string) => boolean,
  limit = 5000,
): string[] {
  const out: string[] = [];
  const visit = (current: string) => {
    if (out.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      const full = join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && predicate(full)) out.push(full);
    }
  };
  if (existsSync(dir)) visit(dir);
  return out;
}

function newest(paths: string[]): string | null {
  return (
    paths
      .map((path) => {
        try {
          return { path, mtimeMs: statSync(path).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(
        (item): item is { path: string; mtimeMs: number } => item !== null,
      )
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null
  );
}

export function findCodexTranscriptBySession(
  sessionId: string,
  homeDir = homedir(),
): string | null {
  if (!sessionId.trim()) return null;
  return newest(
    walkFiles(
      join(homeDir, ".codex", "sessions"),
      (path) => path.endsWith(".jsonl") && path.includes(sessionId),
    ),
  );
}

export function resolveConversationHistoryFile(input?: {
  historyFile?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): string | null {
  const env = input?.env ?? process.env;
  const explicit = input?.historyFile || env.OPEN_AGENTS_HISTORY_FILE;
  if (explicit) return resolve(explicit);

  if (env.CLAUDE_CODE_TRANSCRIPT_PATH) {
    return resolve(env.CLAUDE_CODE_TRANSCRIPT_PATH);
  }
  if (env.CLAUDE_CODE_SESSION_ID) {
    return findClaudeTranscriptBySession(
      env.CLAUDE_CODE_SESSION_ID,
      input?.homeDir,
    );
  }

  const codexTranscriptPath =
    env.CODEX_TRANSCRIPT_PATH || env.CODEX_SESSION_FILE;
  if (codexTranscriptPath) return resolve(codexTranscriptPath);
  const codexThreadId = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID;
  if (codexThreadId) {
    const transcript = findCodexTranscriptBySession(
      codexThreadId,
      input?.homeDir,
    );
    if (transcript) return transcript;
  }

  const cursorTranscriptPath =
    env.CURSOR_AGENT_TRANSCRIPT_PATH ||
    env.CURSOR_AGENT_HISTORY_FILE ||
    env.AGENT_HISTORY_FILE;
  return cursorTranscriptPath ? resolve(cursorTranscriptPath) : null;
}
