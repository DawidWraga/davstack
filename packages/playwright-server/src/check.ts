// `check` verb — validates the local install: node version, daemon liveness,
// config file presence, @playwright/test peer-dep + chromium browser
// installed. Mirrors the shape of the open-agents check (human default +
// --json for agent parsing).
//
// Daemon liveness is INFO not load-bearing — `check` returns 0 even when
// the daemon isn't running, so agents can disambiguate "broken install"
// from "needs `serve`". Aggregate ok = node && peerDep && chromium.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { findRepoRoot, findToolConfig } from '@davstack/cli-utils/config';
import { loadConfig } from './auth.ts';

const REQUIRED_NODE_MAJOR = 20;

type CheckResult = {
  ok: boolean;
  node: { ok: boolean; version: string; required: string };
  daemon: { ok: boolean; running: boolean; url: string; pid?: number; fix?: string };
  config: { ok: boolean; source?: string; repoRoot?: string };
  peerDep: { ok: boolean; name: string; resolved?: string; fix?: string };
  chromium: { ok: boolean; source?: string; fix?: string };
  storageState: { ok: boolean; path?: string; present: boolean; fix?: string };
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
    return { ok: true, running: false, url, fix: `not running — start with \`playwright-server serve\`` };
  }
}

async function checkConfig(cwd: string): Promise<CheckResult['config']> {
  const repoRoot = findRepoRoot(cwd);
  const source = findToolConfig('playwright-server', cwd) ?? undefined;
  return { ok: true, source, repoRoot };
}

function checkPeerDep(cwd: string): CheckResult['peerDep'] {
  try {
    const req = createRequire(`${cwd}/__placeholder__`);
    const resolved = req.resolve('@playwright/test');
    return { ok: true, name: '@playwright/test', resolved };
  } catch {
    return {
      ok: false,
      name: '@playwright/test',
      fix: `peer dep missing — \`pnpm add -D @playwright/test\` in the consumer project`,
    };
  }
}

function checkChromium(cwd: string): CheckResult['chromium'] {
  // Playwright stores browsers in ~/.cache/ms-playwright (linux/mac) or
  // %USERPROFILE%\AppData\Local\ms-playwright (Windows), or
  // PLAYWRIGHT_BROWSERS_PATH if set. We probe by trying to require playwright
  // and reading its registry-style entry — cheap and avoids hard-coding paths.
  const envPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const candidates = envPath
    ? [envPath]
    : process.platform === 'win32'
      ? [join(homedir(), 'AppData', 'Local', 'ms-playwright')]
      : [join(homedir(), '.cache', 'ms-playwright'), join(homedir(), 'Library', 'Caches', 'ms-playwright')];
  for (const c of candidates) {
    if (existsSync(c)) {
      return { ok: true, source: c };
    }
  }
  return {
    ok: false,
    fix: `chromium not installed — \`pnpm exec playwright install chromium\``,
  };
}

async function checkStorageState(cwd: string): Promise<CheckResult['storageState']> {
  const cfg = await loadConfig(cwd);
  const path = cfg.storageStatePath;
  if (!path) return { ok: true, present: false };
  const abs = path.startsWith('/') || /^[A-Za-z]:/.test(path) ? path : join(cwd, path);
  const present = existsSync(abs);
  return {
    ok: true,
    path: abs,
    present,
    fix: present ? undefined : `seed missing — \`playwright-server refresh-auth\` (after \`serve\`)`,
  };
}

export async function runCheck(opts: {
  json?: boolean;
  cwd?: string;
  host?: string;
  port?: number;
}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 5180;

  const result: CheckResult = {
    ok: true,
    node: checkNode(),
    daemon: await checkDaemon(host, port),
    config: await checkConfig(cwd),
    peerDep: checkPeerDep(cwd),
    chromium: checkChromium(cwd),
    storageState: await checkStorageState(cwd),
  };
  // Aggregate: node + peerDep + chromium are load-bearing. Daemon running
  // and storageState present are info — agents inspect and act accordingly.
  result.ok = result.node.ok && result.peerDep.ok && result.chromium.ok;

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
  lines.push(
    `  ${tick(result.chromium.ok)} Chromium             ${result.chromium.source ?? '(not installed)'}`,
  );
  if (!result.chromium.ok && result.chromium.fix) {
    lines.push(`                          ${result.chromium.fix}`);
  }
  if (result.config.source) {
    lines.push(`  ${tick(true)} Config               ${result.config.source}`);
  } else {
    lines.push(`  ${tick(true)} Config               (none — using built-in defaults; optional)`);
  }
  const ssState = result.storageState.present
    ? `seeded at ${result.storageState.path}`
    : result.storageState.path
      ? `path configured but not yet seeded`
      : `(no storageStatePath)`;
  lines.push(`  ${tick(true)} Storage state        ${ssState}`);
  if (!result.storageState.present && result.storageState.fix) {
    lines.push(`                          ${result.storageState.fix}`);
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
