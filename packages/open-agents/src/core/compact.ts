import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

Write a detailed execution spec for the executor agent. Preserve the user's
latest intent, scope, constraints, preferences, and non-goals. Do not solve the
task yourself. Do not invent requirements that are not supported by the short
task or history tail.

Strongly prioritize the <context> block. It should contain dense bullet points
with anything from the history that could help the executor succeed, including:

- relevant files, folders, packages, commands, flags, and artifact paths;
- the user's original query and short direct quotes when they clarify intent;
- project-specific facts and conventions;
- decisions already made in the conversation;
- constraints, non-goals, risks, and caveats;
- details that may look incidental but could matter during implementation.

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
