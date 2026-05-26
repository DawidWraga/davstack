// Storage-state file IO for playwright-server. The config types + loader
// moved to ./config.ts; re-exported here so existing callers continue to
// resolve the same names.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export {
  DEFAULT_CONFIG,
  loadConfig,
  type ResolvedConfig,
  type ServerConfig,
  type StorageState,
  type StorageStateOrigin,
} from './config.js';

import type { StorageState } from './config.js';

export type AuthSeed = {
  origin: string;
  entries: { name: string; value: string }[];
};

export function readAuthSeed(storageStatePath: string): AuthSeed | null {
  if (!existsSync(storageStatePath)) return null;
  let parsed: StorageState;
  try {
    parsed = JSON.parse(readFileSync(storageStatePath, 'utf8')) as StorageState;
  } catch {
    return null;
  }
  const origin = parsed.origins?.[0];
  if (!origin) return null;
  return { origin: origin.origin, entries: origin.localStorage ?? [] };
}

export function writeStorageState(path: string, state: StorageState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}
