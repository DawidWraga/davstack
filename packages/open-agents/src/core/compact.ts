import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface CompactHistory {
  path: string;
  text: string;
  tail: string;
  tailTokens: number;
}

export function tokenTail(text: string, maxTokens: number): string {
  if (!Number.isFinite(maxTokens) || maxTokens <= 0) return '';
  const parts = text.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || [];
  let tokens = 0;
  let start = parts.length;
  while (start > 0 && tokens < maxTokens) {
    start -= 1;
    if (!/^\s+$/.test(parts[start])) tokens += 1;
  }
  return parts.slice(start).join('').trim();
}

export function findClaudeTranscriptBySession(
  sessionId: string,
  homeDir = homedir(),
): string | null {
  if (!sessionId.trim()) return null;
  const projectsDir = join(homeDir, '.claude', 'projects');
  if (!existsSync(projectsDir)) return null;
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = join(projectsDir, entry.name, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function walkFiles(dir: string, predicate: (path: string) => boolean, limit = 5000): string[] {
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
      .filter((x): x is { path: string; mtimeMs: number } => x !== null)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path ?? null
  );
}

export function findCodexTranscriptBySession(
  sessionId: string,
  homeDir = homedir(),
): string | null {
  if (!sessionId.trim()) return null;
  const sessionsDir = join(homeDir, '.codex', 'sessions');
  return newest(
    walkFiles(
      sessionsDir,
      (path) => path.endsWith('.jsonl') && path.includes(sessionId),
    ),
  );
}

export function findLatestCodexHistory(homeDir = homedir()): string | null {
  const codexDir = join(homeDir, '.codex');
  const history = join(codexDir, 'history.jsonl');
  if (existsSync(history)) return history;
  return newest(walkFiles(join(codexDir, 'sessions'), (path) => path.endsWith('.jsonl')));
}

export function findLatestCursorAgentHistory(homeDir = homedir()): string | null {
  const explicitRoots = [
    join(homeDir, 'AppData', 'Roaming', 'Cursor'),
    join(homeDir, 'AppData', 'Local', 'cursor-agent'),
    join(homeDir, '.cursor-agent'),
  ];
  for (const root of explicitRoots) {
    const hit = newest(
      walkFiles(root, (path) => /(?:history|session|transcript|conversation).*\.jsonl$/i.test(path), 2000),
    );
    if (hit) return hit;
  }
  return null;
}

export function resolveCompactHistoryFile(input?: {
  historyFile?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}): string | null {
  const env = input?.env ?? process.env;
  const explicit = input?.historyFile || env.OPEN_AGENTS_HISTORY_FILE;
  if (explicit) return resolve(explicit);

  const transcriptPath = env.CLAUDE_CODE_TRANSCRIPT_PATH;
  if (transcriptPath) return resolve(transcriptPath);

  const sessionId = env.CLAUDE_CODE_SESSION_ID;
  if (sessionId) return findClaudeTranscriptBySession(sessionId, input?.homeDir);

  const codexTranscriptPath = env.CODEX_TRANSCRIPT_PATH || env.CODEX_SESSION_FILE;
  if (codexTranscriptPath) return resolve(codexTranscriptPath);

  const codexThreadId = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID;
  if (codexThreadId) {
    const codexTranscript = findCodexTranscriptBySession(codexThreadId, input?.homeDir);
    if (codexTranscript) return codexTranscript;
  }

  const cursorTranscriptPath =
    env.CURSOR_AGENT_TRANSCRIPT_PATH || env.CURSOR_AGENT_HISTORY_FILE || env.AGENT_HISTORY_FILE;
  if (cursorTranscriptPath) return resolve(cursorTranscriptPath);

  const cursorHistory = findLatestCursorAgentHistory(input?.homeDir);
  if (cursorHistory) return cursorHistory;

  return findLatestCodexHistory(input?.homeDir);
}

export function loadCompactHistory(path: string, tailTokens: number): CompactHistory {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    throw new Error(`compact history file not found: ${resolved}`);
  }
  const text = readFileSync(resolved, 'utf8');
  return {
    path: resolved,
    text,
    tail: tokenTail(text, tailTokens),
    tailTokens,
  };
}

export function buildCompactSpecWriterTask(input: {
  task: string;
  repoPath: string;
  targetProfile: string;
  historyPath: string;
  historyTail: string;
  tailTokens: number;
}): string {
  return `# Compact Mode Spec Handoff

You are the spec-writer agent in a two-agent handoff.

The orchestrating user intentionally provided only a short task title. Use the
recent history tail below to recover the detailed context needed by the executor.

Short task:
${input.task}

Repository path:
${input.repoPath}

Executor profile:
${input.targetProfile}

Full history pointer:
${input.historyPath}

Write a compact execution spec for the executor agent. Preserve the user's
latest intent, scope, constraints, preferences, and non-goals. Do not solve the
task yourself. Do not invent requirements that are not supported by the short
task or history tail.

Keep the generated spec super concise and brief. Prefer concise bullets over
prose. Do not enumerate every remembered detail; include only what changes the
executor's behavior. The full history pointer is available, so if context is
uncertain or too detailed to summarize cleanly, point the executor to inspect
the relevant part of the history instead of copying it into the spec.

Strongly prioritize the <context> block, but keep it distilled. The executor
should receive a clean brief, not the transcript or full history tail. Include
dense bullet points with only the history details that could help the executor
succeed, including:

- relevant files, folders, packages, commands, flags, and artifact paths;
- the user's original query and short direct quotes when they clarify intent;
- project-specific facts and conventions;
- decisions already made in the conversation;
- constraints, non-goals, risks, and caveats;
- details that may look incidental but could matter during implementation.

Do not paste the full history, full recent tail, or long conversation excerpts
into the generated spec. Use short direct quotes only when they clarify intent.
Omit irrelevant turns, dead ends, and stale decisions that the user's latest
messages supersede.

Do not add an <acceptance> block unless the history explicitly asks for one.
For compact handoffs, a rich <context> block is more important than a formal
acceptance checklist.

Return only the generated execution spec, preferably using this shape:

<goal>
...
</goal>

<context>
- ...
- ...
</context>

<scope>
...
</scope>

<constraints>
...
</constraints>

Recent history tail:
The following block contains the last ${input.tailTokens} token-like units from
the provided history file. This block is intentionally placed at the bottom of
the prompt so the newest relevant context is closest to generation.

<recent_history_tail>
${input.historyTail || '(empty)'}
</recent_history_tail>
`;
}
