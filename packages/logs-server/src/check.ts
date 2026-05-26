// `check` verb — validates the local install: node version, resolved config
// path, resolved db path + recent row count, daemon liveness (GET on the
// configured host:port — the sink replies "diag sink ok" with 200 on GET).
// Mirrors the shape of vitest-server / playwright-server check (human default
// + --json for agent parsing).
//
// Daemon liveness is INFO not load-bearing — `check` returns 0 even when the
// daemon isn't running, so agents can disambiguate "broken install" from
// "needs `serve`". Aggregate ok = node.

import { existsSync, statSync } from 'node:fs';
import { findRepoRoot, findToolConfig } from '@davstack/cli-utils/config';
import { loadConfig } from './config.js';
import { dbPath as resolveDbPath } from './paths.js';

const REQUIRED_NODE_MAJOR = 20;

type CheckResult = {
  ok: boolean;
  node: { ok: boolean; version: string; required: string };
  daemon: { ok: boolean; running: boolean; url: string; fix?: string };
  config: { ok: boolean; source?: string; repoRoot?: string };
  db: { ok: boolean; path: string; exists: boolean; totalRows?: number; recentRows?: number; recentWindowMs: number; fix?: string };
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
    // The sink replies 200 with "diag sink ok\n" on any non-POST. We don't
    // require the body match exactly — any 2xx means the daemon is alive.
    const res = await fetch(`${url}/`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) {
      return { ok: true, running: false, url, fix: `daemon at ${url} returned ${res.status}` };
    }
    return { ok: true, running: true, url };
  } catch {
    return { ok: true, running: false, url, fix: `not running — start with \`logs-server serve\`` };
  }
}

function checkConfig(cwd: string): CheckResult['config'] {
  const repoRoot = findRepoRoot(cwd);
  const source = findToolConfig('logs-server', cwd) ?? undefined;
  return { ok: true, source, repoRoot };
}

// Recent-row window — matches the kind of "is data flowing right now" question
// `diagnose` asks. 5 minutes is wide enough that a recently-restarted daemon
// still shows non-zero, narrow enough that a stale DB shows zero.
const RECENT_WINDOW_MS = 5 * 60 * 1000;

const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

/** Pretty glyph: ✗ hard-fail, ~ advisory (ok + fix), ✓ pass. */
function rowGlyph(opts: { ok: boolean; fix?: string }): string {
  if (!opts.ok) return '✗';
  if (opts.fix) return `${YELLOW}~${RESET}`;
  return '✓';
}

/** Idle sink (daemon up, lifetime rows > 0, recent = 0) is not broken — drop stale hint. */
function suppressStaleRowsFix(db: CheckResult['db'], daemon: CheckResult['daemon']): void {
  if (!db.fix?.includes('no rows in last')) return;
  if (!daemon.running || (db.totalRows ?? 0) > 0) {
    delete db.fix;
  }
}

async function checkDb(file: string): Promise<CheckResult['db']> {
  if (!existsSync(file)) {
    return {
      ok: true,
      path: file,
      exists: false,
      recentWindowMs: RECENT_WINDOW_MS,
      fix: `db file not created yet — POST an envelope or run \`logs-server serve\``,
    };
  }
  try {
    // Sanity: surface the file even if we can't open it.
    statSync(file);
  } catch (err) {
    return {
      ok: true,
      path: file,
      exists: true,
      recentWindowMs: RECENT_WINDOW_MS,
      fix: `could not stat db: ${(err as Error).message}`,
    };
  }
  return countRows(file);
}

async function countRows(file: string): Promise<CheckResult['db']> {
  // bun:sqlite only resolves under bun. Under node the dynamic import throws
  // and we fall through to the "exists but uncountable" branch. The bin shim
  // launches under bun by default so the common path is the happy one.
  try {
    const { Database } = (await import(/* @vite-ignore */ 'bun:sqlite')) as typeof import('bun:sqlite');
    const db = new Database(file, { readonly: true });
    const total = db.query('SELECT COUNT(*) as c FROM logs').get() as { c: number } | undefined;
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const recent = db
      .query('SELECT COUNT(*) as c FROM logs WHERE recv_ts >= ?')
      .get(cutoff) as { c: number } | undefined;
    db.close();
    return {
      ok: true,
      path: file,
      exists: true,
      totalRows: total?.c ?? 0,
      recentRows: recent?.c ?? 0,
      recentWindowMs: RECENT_WINDOW_MS,
      fix:
        (recent?.c ?? 0) === 0
          ? `no rows in last ${Math.round(RECENT_WINDOW_MS / 1000)}s — verify transmitter DSN points at the daemon`
          : undefined,
    };
  } catch {
    return {
      ok: true,
      path: file,
      exists: true,
      recentWindowMs: RECENT_WINDOW_MS,
      fix: `db exists but bun:sqlite unavailable (run \`check\` under bun for row counts)`,
    };
  }
}

export async function runCheck(opts: {
  json?: boolean;
  cwd?: string;
  host?: string;
  port?: number;
  db?: string;
}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const cfg = await loadConfig(cwd);
  // Resolution order mirrors serve/prune: CLI flag > DIAG_* env > config > built-in.
  const host = opts.host ?? process.env.DIAG_HOST ?? cfg.host ?? '127.0.0.1';
  const envPort = process.env.DIAG_PORT ? Number(process.env.DIAG_PORT) : undefined;
  const port = opts.port ?? envPort ?? cfg.port ?? 7077;
  const configDbPath = cfg._dbPathResolved ?? cfg.dbPath;
  const file = resolveDbPath(opts.db ?? configDbPath);

  const result: CheckResult = {
    ok: true,
    node: checkNode(),
    daemon: await checkDaemon(host, port),
    config: checkConfig(cwd),
    db: await checkDb(file),
  };
  // Node is the only load-bearing gate. Daemon/db are info — agents inspect
  // and act accordingly.
  result.ok = result.node.ok;
  suppressStaleRowsFix(result.db, result.daemon);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.ok ? 0 : 1;
  }

  const lines: string[] = [''];
  lines.push(`  ${rowGlyph({ ok: result.node.ok })} Node                 ${result.node.version} (required: ${result.node.required})`);
  if (result.config.source) {
    lines.push(`  ${rowGlyph({ ok: true })} Config               ${result.config.source}`);
  } else {
    lines.push(`  ${rowGlyph({ ok: true })} Config               (none — using built-in defaults; optional)`);
  }
  const dbState = result.db.exists
    ? result.db.totalRows !== undefined
      ? `${result.db.path} (${result.db.totalRows} rows total, ${result.db.recentRows} in last ${Math.round(result.db.recentWindowMs / 1000)}s)`
      : `${result.db.path} (exists; row count unavailable)`
    : `${result.db.path} (not yet created)`;
  lines.push(`  ${rowGlyph({ ok: result.db.ok, fix: result.db.fix })} DB                   ${dbState}`);
  if (result.db.fix) {
    lines.push(`                          ${result.db.fix}`);
  }
  const daemonState = result.daemon.running
    ? `running at ${result.daemon.url}`
    : `not running at ${result.daemon.url}`;
  lines.push(`  ${rowGlyph({ ok: result.daemon.ok, fix: result.daemon.fix })} Daemon               ${daemonState}`);
  if (!result.daemon.running && result.daemon.fix) {
    lines.push(`                          ${result.daemon.fix}`);
  }
  lines.push('');
  process.stdout.write(lines.join('\n'));
  return result.ok ? 0 : 1;
}

export type { CheckResult };
export { rowGlyph, suppressStaleRowsFix };
