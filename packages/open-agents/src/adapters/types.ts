// An *adapter* is "which CLI runs the subagent". It owns binary resolution,
// the default model, argv construction, stream parsing, and any CLI-specific
// litter handling (pre-spawn / post-exit hooks). The generic run loop in
// core/run.ts is adapter-agnostic and only talks to this interface.

import type { ProfileMode } from '../profiles/types.js';

export interface BuildArgsInput {
  model: string;
  mode: ProfileMode; // 'ask' (read-only) | 'force' (allowed to mutate)
  prompt: string;
}

export interface ParsedEvent {
  [k: string]: unknown;
}

export interface RunSummary {
  summary: string;
  filesChanged: string[];
  exitReason: string;
  success: boolean;
}

export interface AgentAdapter {
  /** Stable adapter name (e.g. "cursor"). */
  name: string;

  /** Default model when no explicit/configured model is given. */
  defaultModel(): string;

  /**
   * Resolve the executable to spawn, any args that must precede the built
   * argv (e.g. the vendored `index.js` when `bin` is a bare `node.exe`), plus
   * whether it must run through a shell.
   */
  resolveBin(): { bin: string; prelaunchArgs: string[]; shell: boolean };

  /** Build the argv passed to the resolved binary. */
  buildArgs(input: BuildArgsInput): string[];

  /** Parse one NDJSON stream line into an event object (or null). */
  parseLine(line: string): ParsedEvent | null;
  /** Fold the collected events into a deliverable + files-changed summary. */
  summarise(events: ParsedEvent[]): RunSummary;
  /** Recover a resumable chat/session id from the events, if any. */
  extractChatId(events: ParsedEvent[]): string | undefined;

  /**
   * CLI-specific hook run immediately before the process is spawned. Returns
   * an opaque token handed back to postExit (e.g. a pre-spawn snapshot).
   */
  preSpawn(repoPath: string): unknown;
  /** CLI-specific cleanup run after the process exits (litter sweep, etc.). */
  postExit(repoPath: string, preSpawnToken: unknown): void;

  /**
   * Optional extra guard line(s) to inject into the profile scaffold for a
   * given profile + resolved model. Lets an adapter add provider-specific instructions
   * without the (adapter-agnostic) profile knowing about it — e.g. gemini
   * adds an explicit "verify line numbers with a numbered read" directive for
   * flash explore (the pro model self-verifies, so it's skipped there).
   * Undefined/'' ⇒ no addendum (scaffold byte-identical).
   */
  guardAddendum?(profileName: string, model: string): string;
}
