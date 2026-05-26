// gemini adapter — runs the subagent via the Gemini CLI (`gemini -p`, with
// `-o stream-json`). Mirrors adapters/cursor.ts; owns every gemini-specific
// quirk so the generic run loop never branches:
//   - binary resolution: `@google/gemini-cli`'s only bin is `dist/index.js`
//     (plain Node). On Windows the npm-global PATH entry is a `.cmd`/`.ps1`
//     shim Node cannot spawn with shell:false — but that `.cmd` just runs
//     `node …\@google\gemini-cli\dist\index.js %*`, so we resolve that
//     index.js and spawn `node` directly (the same shim-free, shell-free
//     strategy cursor.ts uses for cursor-agent). GEMINI_CLI_BIN overrides
//     everything, mirroring CURSOR_AGENT_BIN.
//   - tier→model map: default `gemini-3.1-flash`; --smarter ⇒ the pro sibling
//     for harder jobs. Raw --model still overrides both (cli.ts precedence).
//   - buildArgs: the abstract profile mode maps onto Gemini's --approval-mode
//     (ask/explore ⇒ `plan`, read-only; force/edit ⇒ `yolo`, auto-approve all
//     tools so a one-pass edit runs unattended).
//   - stream-json schema differs from cursor: assistant text arrives as many
//     {type:'message',role:'assistant',content,delta:true} chunks and there is
//     NO {type:'result'} terminal event. So summarise() concatenates assistant
//     content in stream order — the scaffold's SENTINEL line + deliverable land
//     inside that reconstruction and extractDeliverable slices after the last
//     marker line exactly as for cursor. parseLine is generic JSON; success is
//     left to the process exit code (no result event to read it from).
//   - gemini keeps its scratch under ~/.gemini, never litters the repo, so the
//     pre/post hooks are no-ops.

import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import {
  parseLine as parseStreamLine,
  extractChatId as extractChatIdFromEvents,
} from '../core/parse.js';
import type { AgentAdapter, BuildArgsInput, ParsedEvent, RunSummary, Tier } from './types.js';

// Default: gemini-3.1-flash-lite-preview. Picked by the 2026-05-19 notes/exp
// sweep over the three viable cheap-tier models (2.5-flash-lite, 3.1-flash-
// lite, 2.5-flash): with the explore `cat -n` directive present — which the
// shipped adapter guarantees via guardAddendum — 3.1-flash-lite was 16/16
// line-exact across Exp1+Exp2 (perfect every run), fastest, cheapest, and
// uniquely tolerant of aggressive spec brevity (≥4/4 down to ~80-char specs).
// 2.5-flash-lite is the documented fail-safe for paths where the directive
// might be absent (2/4 bare vs 3.1's 0/4); 2.5-flash was dropped (0/16 EXACT,
// 2× slowest). --smarter ⇒ the pro sibling for harder jobs (it self-verifies
// without the directive). Raw --model still overrides both. These ids are the
// only gemini-version knowledge in the codebase — change here when the
// previews graduate or new defaults land.
const TIER_MODEL: Record<Tier, string> = {
  smarter: 'gemini-3-pro-preview',
  faster: 'gemini-3.1-flash-lite-preview',
};
const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';

// Profile mode → Gemini approval mode. Both use `yolo` (auto-approve every
// tool, runs unattended). explore (ask) deliberately does NOT use Gemini's
// `plan` mode: `plan` suppresses tool execution entirely, so the model never
// reads anything and confabulates a fabricated answer (observed: a fictional
// types.ts, zero tool calls). Gemini has no "reads allowed, writes denied"
// mode, so explore's read-only guarantee is enforced by the profile prompt
// scaffold (the READ-ONLY guard text), not the CLI approval flag.
const APPROVAL: Record<BuildArgsInput['mode'], string> = {
  ask: 'yolo',
  force: 'yolo',
};

// Lite-flash models, left alone, eyeball line numbers and drift on the
// path:Lstart-Lend explore output (3.1-flash-lite: 0/4 EXACT bare, 4/4 with
// this directive — the single largest effect in the whole sweep,
// notes/exp/exp1-directive-necessity.md). gemini-3-pro spontaneously self-
// verifies (runs `cat -n`) and is exact without it. So for the non-pro explore
// path we inject an explicit verify-don't-estimate directive; measured to
// give 16/16 EXACT at the fast tier's latency. Skipped for the pro tier
// (--smarter), which doesn't need it, and for non-explore profiles (edit
// output isn't line citations).
const EXPLORE_LINE_VERIFY =
  '- LINE NUMBERS: never estimate. Before emitting any `path:Lstart-Lend`, read ' +
  'the target file WITH line numbers (e.g. `cat -n <file>`) and take the exact ' +
  '1-based numbers from that output — do not infer them from a plain read.\n';

// --- binary resolution -----------------------------------------------------
// Locate `@google/gemini-cli`'s `dist/index.js` at the default Windows npm
// global root (%APPDATA%\npm\node_modules\…). null if not there — then
// GEMINI_CLI_BIN is the escape hatch (mirrors cursor's resolveCursorAgentNode).
export function resolveGeminiEntry(): string | null {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  const idx = join(appData, 'npm', 'node_modules', '@google', 'gemini-cli', 'dist', 'index.js');
  return existsSync(idx) ? idx : null;
}

export function resolveBin(): { bin: string; prelaunchArgs: string[]; shell: boolean } {
  const env = process.env.GEMINI_CLI_BIN;
  if (env && env.trim()) return { bin: env.trim(), prelaunchArgs: [], shell: false };
  if (platform() === 'win32') {
    const idx = resolveGeminiEntry();
    if (idx) return { bin: 'node', prelaunchArgs: [idx], shell: false };
    // Package not at the default npm root — fall back to the PATH name. (Bare
    // `gemini` with shell:false won't resolve the .cmd shim, but this only
    // hits if the install is missing/relocated; GEMINI_CLI_BIN is the fix.)
    return { bin: 'gemini', prelaunchArgs: [], shell: false };
  }
  // POSIX: the npm bin is an executable symlink (shebang) — spawn it directly.
  return { bin: 'gemini', prelaunchArgs: [], shell: false };
}

// --- summarise -------------------------------------------------------------
const WRITE_TOOL_HINTS = ['write', 'edit', 'replace', 'create', 'patch'];

function looksLikeFileWrite(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  return WRITE_TOOL_HINTS.some((h) => lower.includes(h));
}

function pickString(obj: unknown, keys: string[]): string | undefined {
  if (obj == null || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function errorMessage(err: unknown): string | undefined {
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object') {
    const m = (err as Record<string, unknown>).message;
    if (typeof m === 'string' && m) return m;
  }
  return undefined;
}

// Concatenate every assistant `content` chunk in stream order (gemini streams
// the answer as delta messages). The scaffold has the model emit
// `___FINAL_OUTPUT___` on its own line then the deliverable, so this
// reconstruction carries that marker line and core's extractDeliverable
// slices after the last one, exactly as for cursor. File writes come from
// {type:'tool_use', tool_name, parameters}. gemini DOES emit a terminal
// {type:'result', status, error?, stats} — on status:"error" (e.g. a 404
// ModelNotFoundError) we flip success:false so the run loop marks the job
// failed instead of a silent empty "done"; a success result with no streamed
// deltas falls back to any text it carries.
export function summariseGemini(events: ParsedEvent[]): RunSummary {
  const files = new Set<string>();
  const parts: string[] = [];
  let success = true;
  let exitReason = 'completed';
  let resultText: string | undefined;
  for (const ev of events) {
    const e = ev as Record<string, unknown>;
    if (e.type === 'message' && e.role === 'assistant') {
      if (typeof e.content === 'string' && e.content.length) parts.push(e.content);
    } else if (e.type === 'tool_use' && looksLikeFileWrite(e.tool_name)) {
      const p = pickString(e.parameters, [
        'file_path',
        'path',
        'filename',
        'file',
        'target',
        'target_file',
      ]);
      if (p) files.add(p);
    } else if (e.type === 'result') {
      const status = typeof e.status === 'string' ? e.status : undefined;
      const isError = status === 'error' || e.error != null;
      if (isError) {
        success = false;
        exitReason = errorMessage(e.error) ?? 'error';
      } else if (status && status !== 'success') {
        exitReason = status;
        if (status.includes('error') || status.includes('fail')) success = false;
      }
      resultText = pickString(e, ['response', 'result', 'text', 'message']) ?? resultText;
    }
  }
  const summary = parts.length
    ? parts.join('')
    : (resultText ?? '(no final message captured)');
  return { summary, filesChanged: [...files], exitReason, success };
}

export const geminiAdapter: AgentAdapter = {
  name: 'gemini',

  tierModel(tier: Tier) {
    return TIER_MODEL[tier] ?? DEFAULT_MODEL;
  },
  defaultModel() {
    return DEFAULT_MODEL;
  },

  resolveBin,

  buildArgs({ model, mode, prompt }: BuildArgsInput) {
    return ['-m', model, '-o', 'stream-json', '--approval-mode', APPROVAL[mode], '-p', prompt];
  },

  parseLine(line: string): ParsedEvent | null {
    return parseStreamLine(line) as ParsedEvent | null;
  },
  summarise(events: ParsedEvent[]): RunSummary {
    return summariseGemini(events);
  },
  extractChatId(events: ParsedEvent[]): string | undefined {
    // gemini's {type:'init'} carries `session_id` — core's dig() keys cover it.
    return extractChatIdFromEvents(events);
  },

  // Only flash explore gets the line-verify directive: pro (--smarter) already
  // self-verifies, and non-explore profiles don't emit line citations.
  guardAddendum(profileName: string, tier?: Tier): string {
    if (profileName !== 'explore' || tier === 'smarter') return '';
    return EXPLORE_LINE_VERIFY;
  },

  // gemini keeps its scratch under ~/.gemini; nothing leaks into the repo.
  preSpawn(): null {
    return null;
  },
  postExit(): void {
    /* no-op */
  },
};
