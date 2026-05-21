// cursor adapter — runs the subagent via `cursor-agent -p`. Owns every
// cursor/Windows-specific quirk that used to be hard-coded in the monolith:
//   - binary resolution incl. the Windows shim / shell-spawn decision
//   - the tier→model map (composer-2.5 / composer-2-fast)
//   - buildArgs (--mode ask vs --force from the abstract profile mode)
//   - stream parsing (delegated to the vendored core/parse.ts)
//   - the 0-byte `.test.ts` write-probe litter sweep, as preSpawn/postExit
//     (cursor-agent on Windows drops it; not the model, not us).
// Adding Gemini later = one new adapters/gemini.ts, zero `if`s here touched.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import {
  parseLine as parseStreamLine,
  summariseEvents,
  extractChatId as extractChatIdFromEvents,
} from '../core/parse.ts';
import type { AgentAdapter, BuildArgsInput, ParsedEvent, RunSummary, Tier } from './types.ts';

// Two named tiers are the documented interface; raw --model still overrides.
// composer-2.5 is the default: cheaper input than composer-2, same output,
// smarter. faster is composer-2-fast for latency-sensitive jobs. composer-2.5-
// fast is intentionally NOT a tier (≈2× cost, no quota headroom).
const TIER_MODEL: Record<Tier, string> = {
  smarter: 'composer-2.5',
  faster: 'composer-2-fast',
};
const DEFAULT_MODEL = TIER_MODEL.smarter;

// --- binary resolution -----------------------------------------------------
// Empirical decision (Phase 2, recorded in MIGRATION-PLAN Appendix D — FLIPPED
// after a follow-up live probe): `cursor-agent` ships on Windows only as a
// `.cmd`+`.ps1` wrapper, which Node cannot spawn directly. But that `.ps1` is
// just a stub that locates a vendored `node.exe` + `index.js` under
// `%LOCALAPPDATA%\cursor-agent` and execs `node.exe index.js <args>`. Spawning
// that node entrypoint DIRECTLY (`shell:false`) forwards the multi-line prompt
// argv cleanly with zero bundled binary — live-proven (hostile 11-newline
// prompt echoed verbatim; GOLDEN-EDIT byte-exact; exit 0). The old
// shell-spawn KEEP only held for the untested `{shell:true}` `.cmd` avenue,
// which mangles the prompt through `cmd.exe`. CURSOR_AGENT_BIN still overrides
// everything (lets users point at any wrapper).

// Mirrors cursor-agent.ps1's resolution. Base = %LOCALAPPDATA%\cursor-agent.
// If node.exe + index.js sit directly there, use them. Otherwise pick the
// newest `versions\<YYYY.MM.DD-hash>\` dir (numeric YYYYMMDD desc) that
// contains BOTH node.exe and index.js. null if none resolvable.
export function resolveCursorAgentNode(): { node: string; index: string } | null {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const base = join(localAppData, 'cursor-agent');

  const directNode = join(base, 'node.exe');
  const directIndex = join(base, 'index.js');
  if (existsSync(directNode) && existsSync(directIndex)) {
    return { node: directNode, index: directIndex };
  }

  const versionsDir = join(base, 'versions');
  let entries: string[];
  try {
    entries = readdirSync(versionsDir);
  } catch {
    return null;
  }
  // YYYY.MM.DD-commithash → integer YYYYMMDD (zero-padded month/day) for a
  // correct numeric sort, exactly as the .ps1's Parse-VersionString does.
  const VERSION_RE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})-[a-f0-9]+$/;
  const candidates = entries
    .map((name) => {
      const m = VERSION_RE.exec(name);
      if (!m) return null;
      const key = Number(`${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}`);
      return { name, key };
    })
    .filter((c): c is { name: string; key: number } => c !== null)
    .sort((a, b) => b.key - a.key);

  for (const c of candidates) {
    const node = join(versionsDir, c.name, 'node.exe');
    const index = join(versionsDir, c.name, 'index.js');
    if (existsSync(node) && existsSync(index)) return { node, index };
  }
  return null;
}

export function resolveBin(): { bin: string; prelaunchArgs: string[]; shell: boolean } {
  const env = process.env.CURSOR_AGENT_BIN;
  if (env && env.trim()) return { bin: env.trim(), prelaunchArgs: [], shell: false };
  if (platform() === 'win32') {
    const resolved = resolveCursorAgentNode();
    if (resolved) {
      return { bin: resolved.node, prelaunchArgs: [resolved.index], shell: false };
    }
    // Vendored node entrypoint not found — fall back to the PATH name. (Bare
    // `cursor-agent` with shell:false won't resolve the .cmd, but this only
    // hits if the install is missing/relocated; CURSOR_AGENT_BIN is the fix.)
    return { bin: 'cursor-agent', prelaunchArgs: [], shell: false };
  }
  return { bin: 'cursor-agent', prelaunchArgs: [], shell: false };
}

// --- the cursor `.test.ts` probe-litter sweep ------------------------------
// cursor-agent writes a 0-byte `.test.ts` write-capability probe at the
// workspace root on startup and fails to unlink it on Windows. Snapshot before
// spawning; remove ONLY a 0-byte `.test.ts` this run introduced (or a prior
// 0-byte leak) — never a file that had content, never a git-tracked one.
const DOTTEST = '.test.ts';

interface DotTestState {
  exists: boolean;
  size: number;
}

function dotTestState(repoPath: string): DotTestState {
  try {
    return { exists: true, size: statSync(join(repoPath, DOTTEST)).size };
  } catch {
    return { exists: false, size: -1 };
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
    return false; // git absent → size + snapshot guard is enough
  }
}

// Safe iff: size 0 AND (absent at snapshot OR already 0-byte then) AND not
// git-tracked. `before` = dotTestState() from pre-spawn; pass null for the
// pre-run stale-litter sweep (no cursor-agent for this submit running yet).
export function sweepDotTest(repoPath: string, before: DotTestState | null): void {
  const now = dotTestState(repoPath);
  if (!now.exists || now.size !== 0) return;
  if (before && before.exists && before.size > 0) return; // had real content
  if (isGitTracked(repoPath, DOTTEST)) return; // committed (degenerate) — leave it
  try {
    unlinkSync(join(repoPath, DOTTEST));
    process.stderr.write(
      `open-agents: swept stray 0-byte ${DOTTEST} (cursor-agent Windows probe litter)\n`,
    );
  } catch {
    /* best-effort */
  }
}

export const cursorAdapter: AgentAdapter = {
  name: 'cursor',

  tierModel(tier: Tier) {
    return TIER_MODEL[tier] ?? DEFAULT_MODEL;
  },
  defaultModel() {
    return DEFAULT_MODEL;
  },

  resolveBin,

  buildArgs({ model, mode, prompt }: BuildArgsInput) {
    const a = ['-p', '--output-format', 'stream-json', '--trust', '--model', model];
    if (mode === 'force') a.push('--force');
    else a.push('--mode', 'ask');
    a.push(prompt);
    return a;
  },

  parseLine(line: string): ParsedEvent | null {
    return parseStreamLine(line) as ParsedEvent | null;
  },
  summarise(events: ParsedEvent[]): RunSummary {
    return summariseEvents(events) as RunSummary;
  },
  extractChatId(events: ParsedEvent[]): string | undefined {
    return extractChatIdFromEvents(events);
  },

  // pre-run stale-litter sweep + snapshot; the returned snapshot is handed
  // back to postExit so it removes only what THIS run leaked.
  preSpawn(repoPath: string): DotTestState {
    sweepDotTest(repoPath, null);
    return dotTestState(repoPath);
  },
  postExit(repoPath: string, before: unknown): void {
    sweepDotTest(repoPath, (before as DotTestState | null) ?? null);
  },
};
