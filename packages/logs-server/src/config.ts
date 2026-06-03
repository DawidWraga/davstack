// Config-file loader for the logs-server daemon.
//
// Reads `<repo-root>/.davstack/config/logs-server.config.ts` (or the fallbacks
// resolved by `findToolConfig`) and exposes the merged shape to the caller.
// CLI flags and env vars still win — this layer only fills in defaults below
// them. `dbPath` is returned both as-authored (so callers can detect relative
// paths) and as a repo-root-resolved absolute path.
//
// Runtime is bun in production; loader uses dynamic import() so plain Node
// with `--experimental-transform-types` also works for the smoke test.

import { isAbsolute, resolve } from 'node:path';
import { findRepoRoot, findToolConfig } from '@davstack/cli-utils/config';
import { parseDuration } from './duration.js';

export type ServerConfig = {
  port?: number;
  host?: string;
  dbPath?: string;
  /**
   * CORS policy for browser-origin requests. Sink binds to 127.0.0.1
   * so default-permissive is safe.
   *
   *   "*"      — default; echo Access-Control-Allow-Origin: * (no creds)
   *   string[] — allowlist; if request Origin matches, echo it back + Vary: Origin
   *              otherwise send no CORS headers (browser will block)
   *   false    — emit no CORS headers (legacy behaviour)
   */
  cors?: '*' | string[] | false;
  /**
   * Daemon auto-clean sweep cadence, e.g. `"10m"`. **Unset → auto-clean OFF.**
   * Each tick runs a WINDOWED clean (rows older than `autoCleanWindow`).
   */
  autoCleanInterval?: string;
  /**
   * Retention window for auto-clean, e.g. `"24h"`. Default `"24h"` (NOT 1h —
   * an aggressive window can delete logs mid-session). Manual `clean` ignores
   * this (full sweep) unless `--window` is passed.
   */
  autoCleanWindow?: string;
  /**
   * What auto-clean and manual `clean` do with targeted rows. Default
   * `"archive"` (lossless): write a `.sql.br` before deleting. `"delete"`
   * drops them outright. Both VACUUM afterward.
   */
  cleaningMode?: 'archive' | 'delete';
};

export const DEFAULT_AUTO_CLEAN_WINDOW = '24h';
export const DEFAULT_CLEANING_MODE = 'archive' as const;

export type LoadedConfig = ServerConfig & {
  _source?: string;
  _repoRoot?: string;
  _dbPathResolved?: string;
};

export async function loadConfig(cwd: string = process.cwd()): Promise<LoadedConfig> {
  const repoRoot = findRepoRoot(cwd);
  const configPath = findToolConfig('logs-server', cwd);

  if (!configPath) {
    process.stderr.write(`[logs-server] no config file found (searched from ${cwd})\n`);
    return { _repoRoot: repoRoot };
  }

  let raw: ServerConfig = {};
  try {
    // file:// URL keeps Windows absolute paths import-safe.
    const mod = await import(/* @vite-ignore */ pathToFileUrl(configPath));
    const exported = (mod as { default?: unknown }).default ?? mod;
    if (exported && typeof exported === 'object') {
      raw = exported as ServerConfig;
    }
    process.stderr.write(`[logs-server] loaded config from ${configPath}\n`);
  } catch (err) {
    process.stderr.write(
      `[logs-server] failed to load config ${configPath}: ${(err as Error).message}\n`,
    );
    return { _source: configPath, _repoRoot: repoRoot };
  }

  const merged: LoadedConfig = {
    port: typeof raw.port === 'number' ? raw.port : undefined,
    host: typeof raw.host === 'string' ? raw.host : undefined,
    dbPath: typeof raw.dbPath === 'string' ? raw.dbPath : undefined,
    cors: normalizeCors(raw.cors),
    autoCleanInterval:
      typeof raw.autoCleanInterval === 'string' ? raw.autoCleanInterval : undefined,
    autoCleanWindow:
      typeof raw.autoCleanWindow === 'string' ? raw.autoCleanWindow : DEFAULT_AUTO_CLEAN_WINDOW,
    cleaningMode: raw.cleaningMode === 'delete' ? 'delete' : DEFAULT_CLEANING_MODE,
    _source: configPath,
    _repoRoot: repoRoot,
  };

  if (merged.dbPath) {
    merged._dbPathResolved = isAbsolute(merged.dbPath)
      ? merged.dbPath
      : resolve(repoRoot, merged.dbPath);
  }

  // Validate duration strings up front so a typo surfaces here (and disables
  // the offending knob) rather than throwing deep in the daemon's timer.
  for (const key of ['autoCleanInterval', 'autoCleanWindow'] as const) {
    const v = merged[key];
    if (v && !isValidDuration(v)) {
      process.stderr.write(
        `[logs-server] ignoring invalid ${key}="${v}" (expected e.g. "10m", "24h")\n`,
      );
      merged[key] = key === 'autoCleanWindow' ? DEFAULT_AUTO_CLEAN_WINDOW : undefined;
    }
  }

  return merged;
}

function isValidDuration(value: string): boolean {
  try {
    parseDuration(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeCors(value: unknown): ServerConfig['cors'] {
  if (value === false) return false;
  if (value === '*') return '*';
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
    return value as string[];
  }
  return undefined;
}

function pathToFileUrl(p: string): string {
  // Minimal local equivalent of url.pathToFileURL(p).href to avoid the extra
  // import and to keep the surface trivially auditable.
  const abs = resolve(p).replace(/\\/g, '/');
  return abs.startsWith('/') ? `file://${abs}` : `file:///${abs}`;
}
