// agy adapter — runs the subagent via Google's Antigravity CLI (`agy -p`).
// Mirrors adapters/cursor.ts and adapters/gemini.ts; owns every agy-specific
// quirk so the generic run loop never branches:
//   - binary resolution: agy installs to %LOCALAPPDATA%\agy\bin\agy.exe on
//     Windows (no shim, no PATH dance — the .exe is the real binary).
//     AGY_CLI_BIN overrides everything, mirroring CURSOR_AGENT_BIN /
//     GEMINI_CLI_BIN. **Non-TTY stdout buffering — solved by brain-dir
//     extraction (see below):** agy print-mode does not flush stdout when
//     stdout is not a TTY (live-proven across bash-redirect, bash-pipe,
//     and bun subprocess contexts; winpty wrap fails its own cols/rows
//     assertion under bun's piped stdio). HOWEVER — agy ALWAYS persists
//     the full response (and tool calls) to
//     ~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/
//     transcript.jsonl BEFORE exit, regardless of stdout state. We
//     therefore snapshot the brain dir in preSpawn and have summarise
//     read the new transcript that this run produced. The stdout path
//     stays wired (TTY case continues to work via parseLine), and the
//     fallback bypasses the buffer problem entirely with zero new deps.
//     See notes/agy-print-mode-hang-watchdog-gap.md for the full
//     investigation, evidence, and the rejected alternatives.
//   - tier→model map: agy CLI has NO model-selection mechanism (no --model
//     flag, no env var, no settings.json key — the model is picked by the
//     GUI's "Model Selection" setting and the CLI inherits it). So tierModel
//     returns '' and buildArgs emits no model arg. --smarter / --faster are
//     no-ops for this adapter until agy exposes CLI model selection.
//   - buildArgs: agy's only print-mode permission flags are --sandbox
//     (terminal restrictions) and --dangerously-skip-permissions
//     (auto-approve everything). Profile mode 'ask' (explore) ⇒ --sandbox;
//     'force' (edit) ⇒ --dangerously-skip-permissions.
//   - output protocol: agy emits PLAIN TEXT to stdout, not stream-json.
//     parseLine wraps each non-empty line as {type:'text', content: line};
//     summarise concatenates content in stream order so the scaffold's
//     SENTINEL line + deliverable land inside that reconstruction and
//     core's extractDeliverable slices after the marker line, exactly as
//     for cursor/gemini. Success is left to the process exit code (no
//     terminal result event to read it from).
//   - extractChatId returns undefined for v1: agy supports --continue /
//     --conversation <id> but the id only lives in
//     ~/.gemini/antigravity-cli/brain/<uuid>/, not in the stdout stream.
//   - preSpawn/postExit sweep an empty .antigravitycli/ directory agy
//     creates in cwd on every print-mode run (the project-symlink attempt
//     fails on Windows without admin, leaving an empty dir behind).

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmdirSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, BuildArgsInput, ParsedEvent, RunSummary, Tier } from './types.ts';

// agy has a single CLI-visible model (whatever the GUI selected); no override
// path. Tier flags become no-ops here — documented in the adapter header.
const DEFAULT_MODEL = '';

// Profile mode → agy permission flag. ask = read-only intent ⇒ --sandbox
// (terminal restrictions); force = mutating ⇒ --dangerously-skip-permissions
// (unattended auto-approve, what the edit profile needs).
const MODE_FLAG: Record<BuildArgsInput['mode'], string> = {
  ask: '--sandbox',
  force: '--dangerously-skip-permissions',
};

// agy's default print-mode wait is 5m, which is too short for a real
// open-agents job (parity with the other adapters' generous timeouts; the
// outer run.ts watchdog is the real ceiling).
const PRINT_TIMEOUT = '30m';

// --- binary resolution -----------------------------------------------------
// agy installs a real .exe (no shim) at %LOCALAPPDATA%\agy\bin\agy.exe.
// Spawn it directly with shell:false — multi-line prompt argv forwards
// cleanly. AGY_CLI_BIN is the escape hatch for non-default installs.
export function resolveAgyExe(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const exe = join(localAppData, 'agy', 'bin', 'agy.exe');
  return existsSync(exe) ? exe : null;
}

export function resolveBin(): { bin: string; prelaunchArgs: string[]; shell: boolean } {
  const env = process.env.AGY_CLI_BIN;
  if (env && env.trim()) return { bin: env.trim(), prelaunchArgs: [], shell: false };
  if (platform() === 'win32') {
    const exe = resolveAgyExe();
    if (exe) return { bin: exe, prelaunchArgs: [], shell: false };
  }
  return { bin: 'agy', prelaunchArgs: [], shell: false };
}

// --- the .antigravitycli/ probe-litter sweep -------------------------------
// agy attempts to symlink a per-project json into the cwd's .antigravitycli/
// dir on every print-mode run. The symlink fails on Windows without admin
// (`A required privilege is not held by the client`) but agy proceeds — the
// empty directory is left behind. Snapshot before spawn; remove ONLY an
// empty .antigravitycli/ this run introduced (or a prior empty leak) — never
// a dir with contents, never a git-tracked one.
const LITTER_DIR = '.antigravitycli';

interface LitterState {
  exists: boolean;
  empty: boolean;
}

function litterState(repoPath: string): LitterState {
  const full = join(repoPath, LITTER_DIR);
  try {
    const entries = readdirSync(full);
    return { exists: true, empty: entries.length === 0 };
  } catch {
    return { exists: false, empty: false };
  }
}

function isGitTracked(repoPath: string, rel: string): boolean {
  try {
    const r = spawnSync('git', ['-C', repoPath, 'ls-files', '--error-unmatch', rel], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

export function sweepLitterDir(repoPath: string, before: LitterState | null): void {
  const now = litterState(repoPath);
  if (!now.exists || !now.empty) return;
  if (before && before.exists && !before.empty) return; // had real content
  if (isGitTracked(repoPath, LITTER_DIR)) return;
  try {
    rmdirSync(join(repoPath, LITTER_DIR));
    process.stderr.write(
      `cursor-jobs: swept stray empty ${LITTER_DIR}/ (agy Windows symlink probe litter)\n`,
    );
  } catch {
    /* best-effort */
  }
}

// --- brain-dir extraction (the non-TTY stdout workaround) -----------------
// agy persists every print-mode session to a uniquely-named UUID dir under
// ~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript.jsonl
// regardless of stdout state. We snapshot the set of UUIDs that exist
// BEFORE spawn (preSpawn) and the summarise call walks the dir AFTER spawn
// to find the new UUID(s) — those are this run's transcript(s). The
// AgentAdapter interface doesn't thread arbitrary context to summarise(),
// so the snapshot lives at module scope. _claimedThisBatch prevents two
// parallel summarise calls (--parallel-mode asap) from picking the same
// new UUID.

let _brainSnapshot: Set<string> | null = null;
const _claimedThisBatch = new Set<string>();

export function brainBaseDir(): string {
  return join(homedir(), '.gemini', 'antigravity-cli', 'brain');
}

interface BrainEntry {
  uuid: string;
  mtimeMs: number;
}

function listBrainEntries(): BrainEntry[] {
  try {
    const base = brainBaseDir();
    return readdirSync(base)
      .map((uuid): BrainEntry | null => {
        try {
          return { uuid, mtimeMs: statSync(join(base, uuid)).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((e): e is BrainEntry => e !== null);
  } catch {
    return [];
  }
}

export function snapshotBrainDirs(): Set<string> {
  return new Set(listBrainEntries().map((e) => e.uuid));
}

export function resetBrainSnapshot(): void {
  _brainSnapshot = null;
  _claimedThisBatch.clear();
}

// Pick the newest UUID created since the preSpawn snapshot that hasn't been
// claimed by an earlier summarise in this batch. Returns null if no fresh
// UUID is available (e.g. agy crashed before writing a transcript, or
// preSpawn was never called).
function claimNewestUnusedBrainUuid(): string | null {
  if (!_brainSnapshot) return null;
  const fresh = listBrainEntries()
    .filter((e) => !_brainSnapshot!.has(e.uuid) && !_claimedThisBatch.has(e.uuid))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!fresh.length) return null;
  const pick = fresh[0]!.uuid;
  _claimedThisBatch.add(pick);
  return pick;
}

interface BrainStep {
  source?: string;
  type?: string;
  content?: string;
  tool_calls?: Array<{ name?: string; args?: Record<string, unknown> }>;
}

const WRITE_TOOL_HINTS = ['write', 'edit', 'replace', 'create', 'patch'];

function looksLikeFileWrite(name: string): boolean {
  const lower = name.toLowerCase();
  return WRITE_TOOL_HINTS.some((h) => lower.includes(h));
}

export function extractFromBrainTranscript(uuid: string): {
  text: string;
  files: string[];
} {
  let raw: string;
  try {
    raw = readFileSync(
      join(brainBaseDir(), uuid, '.system_generated', 'logs', 'transcript.jsonl'),
      'utf8',
    );
  } catch {
    return { text: '', files: [] };
  }
  const parts: string[] = [];
  const files = new Set<string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let step: BrainStep;
    try {
      step = JSON.parse(trimmed) as BrainStep;
    } catch {
      continue;
    }
    if (step.source !== 'MODEL' || step.type !== 'PLANNER_RESPONSE') continue;
    if (typeof step.content === 'string' && step.content.length) parts.push(step.content);
    for (const tc of step.tool_calls ?? []) {
      if (typeof tc.name !== 'string' || !looksLikeFileWrite(tc.name)) continue;
      const args = (tc.args ?? {}) as Record<string, unknown>;
      for (const k of [
        'FilePath',
        'file_path',
        'path',
        'TargetFile',
        'target_file',
        'filename',
      ]) {
        const v = args[k];
        if (typeof v === 'string' && v.length) {
          files.add(v);
          break;
        }
      }
    }
  }
  return { text: parts.join('\n'), files: [...files] };
}

// --- auto-continue (Antigravity 1024-thinking-token cap workaround) --------
// Antigravity hardcaps every response at ~1024 thinking tokens. The model
// signals this by emitting a literal `<truncated N bytes>` marker mid-stream
// (the same marker agy's tool layer uses for truncated tool outputs — the
// model has learned the convention). The IDE/interactive session handles
// this by multi-turning under the hood; print mode (`agy -p`) does not.
// Workaround: when summarise spots the marker in the brain transcript, spawn
// `agy -c` ("continue most recent conversation") with a prompt asking the
// model to fill in the elided sections, claim the new brain UUID, append.
// Cap at MAX_CONTINUE_TURNS so a model stuck in a truncate-loop can't run
// forever. See notes/exp/ad-hoc-skill-vs-subagent-2026-05-19.md Run 8.
export const TRUNCATION_RE = /<truncated\s+\d+\s+bytes>/i;
const TRUNCATION_RE_GLOBAL = /<truncated\s+\d+\s+bytes>/gi;
const MAX_CONTINUE_TURNS = 4;
const CONTINUE_PROMPT =
  'Continue your previous response. Fill in EVERY section you elided with a ' +
  '`<truncated N bytes>` marker — write those sections out in full now. ' +
  'Do NOT emit any new `<truncated N bytes>` (or `[...]`, or `(content omitted)`) ' +
  'markers in your output; those are tool-output truncation conventions, not ' +
  'output conventions. No preamble; resume exactly where you elided.';

// agy -c APPENDS to the active conversation's existing brain transcript
// (same UUID, new step_index entries) — it does NOT create a new brain dir.
// So we can't claim a "newest" uuid after continuing; we must re-read the
// same uuid and diff against what we already saw. The returned function
// closes over the active uuid + the last-seen extracted text, so each call
// runs one continue turn and returns only the NEW content.
export function makeContinueRunner(uuid: string, priorText: string): () => string | null {
  let lastSeen = priorText;
  return (): string | null => {
    const { bin, shell } = resolveBin();
    const args = [
      '--print-timeout',
      PRINT_TIMEOUT,
      '--sandbox',
      '-c',
      '-p',
      CONTINUE_PROMPT,
    ];
    const res = spawnSync(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell,
      encoding: 'utf8',
    });
    if (res.status !== 0 && res.status !== null) return null;
    const after = extractFromBrainTranscript(uuid).text;
    if (after.length <= lastSeen.length || !after.startsWith(lastSeen)) return null;
    const diff = after.slice(lastSeen.length).replace(/^\n+/, '');
    lastSeen = after;
    return diff || null;
  };
}

// Pure, testable: drive the continue loop with a caller-supplied runner so
// tests don't need to spawn anything.
export function continueUntilComplete(
  initial: { text: string; files: string[] },
  runContinue: () => string | null,
  maxTurns: number = MAX_CONTINUE_TURNS,
): { text: string; files: string[]; turns: number } {
  let { text } = initial;
  const { files } = initial;
  let turns = 0;
  while (TRUNCATION_RE.test(text) && turns < maxTurns) {
    process.stderr.write(`agy-continue: turn ${turns + 1}/${maxTurns}…\n`);
    const more = runContinue();
    if (!more) {
      process.stderr.write(`agy-continue: turn ${turns + 1} returned nothing (auth, spawn, or no new content) — stopping\n`);
      break;
    }
    process.stderr.write(`agy-continue: turn ${turns + 1} added ${more.length} bytes\n`);
    // Strip markers from the accumulated text (they're now "filled" by the
    // continuation), then append the new chunk. If the new chunk introduces
    // its own markers, the next iteration handles them. Final-cleanup pass
    // outside the loop drops any markers still in place (model defied us).
    text = `${text.replace(TRUNCATION_RE_GLOBAL, '')}\n${more}`;
    turns += 1;
  }
  if (turns > 0) text = text.replace(TRUNCATION_RE_GLOBAL, '');
  return { text, files, turns };
}

// --- summarise -------------------------------------------------------------
// TTY case (stdout flushed): parseLine wraps each line as a text event;
// we join them. Non-TTY case (the common one — bun subprocess, bash redirect):
// stdout was 0 bytes, so events is empty; fall back to reading the brain
// transcript agy persisted to disk for this run, then auto-continue if the
// model self-truncated against Antigravity's 1024-thinking-token cap.
export function summariseAgy(
  events: ParsedEvent[],
  makeRunner: (uuid: string, priorText: string) => () => string | null = makeContinueRunner,
): RunSummary {
  const streamed: string[] = [];
  for (const ev of events) {
    const e = ev as Record<string, unknown>;
    if (e.type === 'text' && typeof e.content === 'string') streamed.push(e.content);
  }
  if (streamed.length) {
    return {
      summary: streamed.join('\n'),
      filesChanged: [],
      exitReason: 'completed',
      success: true,
    };
  }
  const uuid = claimNewestUnusedBrainUuid();
  if (uuid) {
    const initial = extractFromBrainTranscript(uuid);
    if (initial.text) {
      const runContinue = makeRunner(uuid, initial.text);
      const { text, files, turns } = continueUntilComplete(initial, runContinue);
      return {
        summary: text,
        filesChanged: files,
        exitReason: turns
          ? `completed (brain, +${turns} continue${turns > 1 ? 's' : ''})`
          : 'completed (brain)',
        success: true,
      };
    }
  }
  return {
    summary: '(no final message captured)',
    filesChanged: [],
    exitReason: 'no-output',
    success: false,
  };
}

export const agyAdapter: AgentAdapter = {
  name: 'agy',

  tierModel(_tier: Tier) {
    return DEFAULT_MODEL;
  },
  defaultModel() {
    return DEFAULT_MODEL;
  },

  resolveBin,

  buildArgs({ mode, prompt }: BuildArgsInput) {
    // `-p` consumes the NEXT argv as the prompt value (not a positional after
    // flags), so it MUST be the last flag — anything between `-p` and the
    // prompt becomes the prompt and the real prompt is silently dropped.
    return ['--print-timeout', PRINT_TIMEOUT, MODE_FLAG[mode], '-p', prompt];
  },

  parseLine(line: string): ParsedEvent | null {
    if (!line) return null;
    return { type: 'text', content: line };
  },

  summarise(events: ParsedEvent[]): RunSummary {
    return summariseAgy(events);
  },

  extractChatId(_events: ParsedEvent[]): string | undefined {
    return undefined;
  },

  // No guardAddendum: agy hits Antigravity's documented hardcap of 16k output
  // / 1024 *thinking* tokens per response (plan-agnostic, no override). Any
  // "thorough-mode" wrapper we add here is read by the model but cannot be
  // honoured — the planner exhausts the 1024-token budget mid-response and
  // emits `<truncated N bytes>` as its elision marker. The extensive-depth
  // lane should route to a backend without that cap. See
  // notes/exp/ad-hoc-skill-vs-subagent-2026-05-19.md (Run 8 / Run 8c).

  preSpawn(repoPath: string): LitterState {
    sweepLitterDir(repoPath, null);
    _brainSnapshot = snapshotBrainDirs();
    _claimedThisBatch.clear();
    return litterState(repoPath);
  },
  postExit(repoPath: string, before: unknown): void {
    sweepLitterDir(repoPath, (before as LitterState | null) ?? null);
  },
};
