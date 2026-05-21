// `check` verb — validates the local install: node version, daemon liveness,
// config file presence, vitest peer-dep installed. Mirrors the shape of the
// open-agents check (human default + --json for agent parsing).
//
// Daemon liveness is INFO not load-bearing — `check` returns 0 even when
// the daemon isn't running, so agents can disambiguate "broken install"
// from "needs `serve`". Aggregate ok = node && peerDep.

import { createRequire } from 'node:module';
import { findRepoRoot, findToolConfig } from '@davstack/cli-utils/config';
import { loadConfig } from './config.ts';

const REQUIRED_NODE_MAJOR = 20;

type CheckResult = {
  ok: boolean;
  node: { ok: boolean; version: string; required: string };
  daemon: { ok: boolean; running: boolean; url: string; pid?: number; fix?: string };
  config: { ok: boolean; source?: string; repoRoot?: string };
  peerDep: { ok: boolean; name: string; resolved?: string; fix?: string };
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

async function checkDaemon(host: string, port: number): Promise<CheckResult['daemon']> {
  const url = `http://${host}:${port}`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 800);
    const res = await fetch(`${url}/health`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) {
      return { ok: true, running: false, url, fix: `daemon at ${url} returned ${res.status}` };
    }
    const body = (await res.json()) as { ok?: boolean; pid?: number };
    return { ok: true, running: !!body.ok, url, pid: body.pid };
  } catch {
    return { ok: true, running: false, url, fix: `not running — start with \`vitest-server serve\`` };
  }
}

async function checkConfig(cwd: string): Promise<CheckResult['config']> {
  const repoRoot = findRepoRoot(cwd);
  const source = findToolConfig('vitest-server', cwd) ?? undefined;
  // config is optional (defaults work without one) — surface presence but don't fail on absence
  return { ok: true, source, repoRoot };
}

function checkPeerDep(cwd: string): CheckResult['peerDep'] {
  try {
    const req = createRequire(`${cwd}/__placeholder__`);
    const resolved = req.resolve('vitest/node');
    return { ok: true, name: 'vitest', resolved };
  } catch {
    return {
      ok: false,
      name: 'vitest',
      fix: `peer dep missing — \`pnpm add -D vitest\` in the consumer project`,
    };
  }
}

export async function runCheck(opts: {
  json?: boolean;
  cwd?: string;
  host?: string;
  port?: number;
}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = await loadConfig(cwd);
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 5179;

  const result: CheckResult = {
    ok: true,
    node: checkNode(),
    daemon: await checkDaemon(host, port),
    config: await checkConfig(cwd),
    peerDep: checkPeerDep(cwd),
  };
  // Aggregate: node + peerDep are load-bearing. Daemon running is info — the
  // agent inspects the daemon block and serves if needed.
  result.ok = result.node.ok && result.peerDep.ok;

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }

  const tick = (ok: boolean) => (ok ? '✓' : '✗');
  const lines: string[] = [''];
  lines.push(`  ${tick(result.node.ok)} Node                 ${result.node.version} (required: ${result.node.required})`);
  lines.push(
    `  ${tick(result.peerDep.ok)} Peer dep             ${result.peerDep.name}${result.peerDep.resolved ? ` (${result.peerDep.resolved})` : ''}`,
  );
  if (!result.peerDep.ok && result.peerDep.fix) {
    lines.push(`                          ${result.peerDep.fix}`);
  }
  if (result.config.source) {
    lines.push(`  ${tick(true)} Config               ${result.config.source}`);
  } else {
    lines.push(`  ${tick(true)} Config               (none — using built-in defaults; optional)`);
  }
  const daemonState = result.daemon.running
    ? `running pid=${result.daemon.pid} at ${result.daemon.url}`
    : `not running at ${result.daemon.url}`;
  lines.push(`  ${tick(true)} Daemon               ${daemonState}`);
  if (!result.daemon.running && result.daemon.fix) {
    lines.push(`                          ${result.daemon.fix}`);
  }
  lines.push('');
  process.stdout.write(lines.join('\n'));
  return result.ok ? 0 : 1;
}

export type { CheckResult };
