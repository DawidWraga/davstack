// `check` verb — validates the local install: node version, cursor-agent
// binary resolution, config file presence, jobs dir health. Mirrors the
// shape of doc 06's check verb (human default + --json for agent parsing).
//
// No daemon to probe — unlike logs-server/vitest-server/playwright-server,
// open-agents is stateless one-shot CLI.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { delimiter, join } from 'node:path';
import { resolveCursorAgentNode } from './adapters/cursor.ts';
import { loadConfig } from './config.ts';
import { jobsDir } from './core/paths.ts';

const REQUIRED_NODE_MAJOR = 20;

type CheckResult = {
  ok: boolean;
  node: { ok: boolean; version: string; required: string };
  cursorAgent: { ok: boolean; source: string; fix?: string };
  config: { ok: boolean; source?: string; repoRoot?: string };
  jobsDir: { ok: boolean; path: string; jobs: number; recent24h: number };
};

function checkNode(): CheckResult['node'] {
  const v = process.versions.node;
  const major = Number(v.split('.')[0]);
  return {
    ok: Number.isFinite(major) && major >= REQUIRED_NODE_MAJOR,
    version: `v${v}`,
    required: `>=${REQUIRED_NODE_MAJOR}`,
  };
}

function resolveCursorAgentOnPath(): string | null {
  // PATH lookup for unix `cursor-agent`; matches the spawn fallback in
  // adapters/cursor.ts which spawns the bare command name if the vendored
  // node-entrypoint isn't found.
  const isWin = platform() === 'win32';
  const exe = isWin ? 'cursor-agent.cmd' : 'cursor-agent';
  const pathDirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const p = join(dir, exe);
    if (existsSync(p)) return p;
  }
  return null;
}

// Probe whether a binary can actually be spawned. existsSync alone is
// insufficient — on Windows, SmartScreen / Defender can block an existing
// .exe at spawn time (EUNKNOWN uv_spawn). check runs this once at user
// request, so the ~100ms cost is fine; the hot path (resolveBin in the
// adapter) deliberately stays probe-free.
function canSpawn(bin: string, extraArgs: string[] = []): boolean {
  try {
    const result = spawnSync(bin, [...extraArgs, '--version'], {
      timeout: 1500,
      stdio: 'ignore',
      windowsHide: true,
    });
    return !result.error;
  } catch {
    return false;
  }
}

function checkCursorAgent(): CheckResult['cursorAgent'] {
  // Mirrors the precedence in adapters/cursor.ts: CURSOR_AGENT_BIN → vendored
  // node entrypoint (Windows) → bare on PATH. Each candidate is spawn-probed,
  // not just existence-checked, so a blocked .exe doesn't pass.
  const envBin = process.env.CURSOR_AGENT_BIN;
  if (envBin) {
    if (existsSync(envBin) && canSpawn(envBin)) {
      return { ok: true, source: `CURSOR_AGENT_BIN=${envBin}` };
    }
    return {
      ok: false,
      source: `CURSOR_AGENT_BIN=${envBin} (not spawnable)`,
      fix:
        'The path is set but the binary cannot be spawned (file missing, ' +
        'permissions, or Windows SmartScreen/Defender block). Unset CURSOR_AGENT_BIN ' +
        'to fall back to the vendored cursor-agent install, or fix the shim.',
    };
  }
  const vendored = resolveCursorAgentNode();
  if (vendored && canSpawn(vendored.node, [vendored.index])) {
    return { ok: true, source: `vendored node entrypoint: ${vendored.index}` };
  }
  const onPath = resolveCursorAgentOnPath();
  if (onPath && canSpawn(onPath)) {
    return { ok: true, source: `PATH: ${onPath}` };
  }
  return {
    ok: false,
    source: 'not found',
    fix: 'Install cursor-agent from https://cursor.com/cli, or point CURSOR_AGENT_BIN at an alternate wrapper.',
  };
}

async function checkConfig(cwd: string): Promise<CheckResult['config']> {
  const cfg = await loadConfig(cwd);
  return {
    ok: Boolean(cfg._source),
    source: cfg._source,
    repoRoot: cfg._repoRoot,
  };
}

function checkJobsDir(cwd: string): CheckResult['jobsDir'] {
  // Job state is keyed by repo hash; check the dir for the cwd's repo so the
  // counts are scoped to "this repo" (matching what `ls` shows).
  const path = jobsDir(cwd);
  if (!existsSync(path)) {
    return { ok: true, path, jobs: 0, recent24h: 0 };
  }
  let jobs = 0;
  let recent24h = 0;
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  try {
    for (const name of readdirSync(path)) {
      if (!name.endsWith('.json')) continue;
      jobs += 1;
      try {
        const st = statSync(join(path, name));
        if (st.mtimeMs >= cutoff) recent24h += 1;
      } catch {
        // ignore unreadable entries
      }
    }
  } catch {
    // dir disappeared between exists check and readdir — treat as empty
  }
  return { ok: true, path, jobs, recent24h };
}

export async function runCheck(opts: { json?: boolean; cwd?: string }): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const result: CheckResult = {
    ok: true,
    node: checkNode(),
    cursorAgent: checkCursorAgent(),
    config: await checkConfig(cwd),
    jobsDir: checkJobsDir(cwd),
  };
  // Aggregate ok — node + cursorAgent are load-bearing; config is optional
  // (defaults work without a config file); jobsDir always ok (lazily created).
  result.ok = result.node.ok && result.cursorAgent.ok;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }

  const tick = (ok: boolean) => (ok ? '✓' : '✗');
  const lines: string[] = [];
  lines.push('');
  lines.push(
    `  ${tick(result.node.ok)} Node version         ${result.node.version} (required: ${result.node.required})`,
  );
  lines.push(
    `  ${tick(result.cursorAgent.ok)} cursor-agent binary  ${result.cursorAgent.source}`,
  );
  if (!result.cursorAgent.ok && result.cursorAgent.fix) {
    lines.push(`                          ${result.cursorAgent.fix}`);
  }
  if (result.config.ok) {
    lines.push(`  ${tick(true)} Config file          ${result.config.source}`);
  } else {
    lines.push(
      `  ${tick(true)} Config file          (none — using built-in defaults; optional)`,
    );
  }
  lines.push(
    `  ${tick(true)} Jobs directory       ${result.jobsDir.path}  (${result.jobsDir.jobs} jobs, ${result.jobsDir.recent24h} in last 24h)`,
  );
  lines.push('');
  process.stdout.write(lines.join('\n'));
  return result.ok ? 0 : 1;
}

// Used by the init flow to detect cursor-agent without printing.
export function detectCursorAgent(): { ok: boolean; source: string; fix?: string } {
  return checkCursorAgent();
}

// Expose to satisfy any test that wants to see the aggregate shape without
// running the CLI surface (printing). Not used internally.
export type { CheckResult };
