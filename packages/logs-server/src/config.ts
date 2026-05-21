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

export type ServerConfig = {
  port?: number;
  host?: string;
  dbPath?: string;
  pruneDays?: number;
};

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
    pruneDays: typeof raw.pruneDays === 'number' ? raw.pruneDays : undefined,
    _source: configPath,
    _repoRoot: repoRoot,
  };

  if (merged.dbPath) {
    merged._dbPathResolved = isAbsolute(merged.dbPath)
      ? merged.dbPath
      : resolve(repoRoot, merged.dbPath);
  }

  return merged;
}

function pathToFileUrl(p: string): string {
  // Minimal local equivalent of url.pathToFileURL(p).href to avoid the extra
  // import and to keep the surface trivially auditable.
  const abs = resolve(p).replace(/\\/g, '/');
  return abs.startsWith('/') ? `file://${abs}` : `file:///${abs}`;
}
