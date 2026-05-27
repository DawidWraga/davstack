// Consumer-facing config types + loader for playwright-server. The
// storage-state plumbing lives in ./auth.ts; this file owns the public
// type surface the user `satisfies` in their .davstack/config file.

import { pathToFileURL } from 'node:url';

import { findToolConfig } from '@davstack/cli-utils/config';

export type StorageStateOrigin = {
  origin: string;
  localStorage: { name: string; value: string }[];
};

export type StorageState = {
  cookies: unknown[];
  origins: StorageStateOrigin[];
};

// User-facing config shape. Every field is optional — defaults below fill in
// the rest. Consumers `satisfies ServerConfig` their config file with this.
export type ServerConfig = {
  // Daemon HTTP port (default 5180).
  port?: number;
  // Daemon HTTP host (default 127.0.0.1).
  host?: string;
  // App base URL the warm browser navigates to.
  baseUrl?: string;
  // Where the captured login state is persisted between runs.
  storageStatePath?: string;
  // Persistent chromium user-data directory.
  profilePath?: string;
  // User-supplied login + capture. Called by `refresh-auth` to mint a
  // fresh storage state. Return null to skip the rewrite.
  refreshAuth?: () => Promise<StorageState | null>;
  // Force the legacy regex-extraction runner instead of the new
  // registration-interception runner. The new runner supports full TS,
  // module-level helpers, multiple test() blocks, and test.use /
  // beforeEach / afterEach. Set this true to opt back into the
  // single-test source-extractor (codegen-style spec files).
  legacyExtract?: boolean;
};

// Post-merge resolved shape used internally. Required fields here are
// always populated because the defaults below provide them.
export type ResolvedConfig = {
  port?: number;
  host?: string;
  baseUrl: string;
  storageStatePath: string;
  profilePath: string;
  refreshAuth?: () => Promise<StorageState | null>;
  legacyExtract?: boolean;
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  baseUrl: 'http://localhost:3001',
  storageStatePath: 'e2e/.auth/user.json',
  profilePath: '.playwright-profile',
};

export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const configPath = findToolConfig('playwright-server', cwd);
  if (!configPath) return { ...DEFAULT_CONFIG };
  let mod: { default?: ServerConfig } & ServerConfig;
  try {
    mod = await import(pathToFileURL(configPath).href);
  } catch (e) {
    throw new Error(
      `playwright-server: failed to load ${configPath}: ${(e as Error)?.message ?? e}`,
    );
  }
  console.error('[playwright-server] config loaded from: ' + configPath);
  const user: ServerConfig = (mod.default ?? mod) as ServerConfig;
  return { ...DEFAULT_CONFIG, ...user };
}
