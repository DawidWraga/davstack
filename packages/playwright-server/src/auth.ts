// Consumer-facing config + storage-state plumbing. The skill provides the
// machinery (warm browser, reset, run loop); each consumer project ships its
// own `playwright-server.config.ts` describing how to mint a session token
// and where to persist it. The skill never knows the consumer's auth shape.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type StorageStateOrigin = {
  origin: string;
  localStorage: { name: string; value: string }[];
};

export type StorageState = {
  cookies: unknown[];
  origins: StorageStateOrigin[];
};

export type ServerConfig = {
  baseUrl: string;
  storageStatePath: string;
  profilePath: string;
  refreshAuth?: () => Promise<StorageState | null>;
};

export const DEFAULT_CONFIG: ServerConfig = {
  baseUrl: 'http://localhost:3001',
  storageStatePath: 'e2e/.auth/user.json',
  profilePath: '.playwright-profile',
};

const CONFIG_FILENAME = 'playwright-server.config.ts';

export async function loadConfig(cwd: string): Promise<ServerConfig> {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
  let mod: { default?: Partial<ServerConfig> } & Partial<ServerConfig>;
  try {
    mod = await import(pathToFileURL(configPath).href);
  } catch (e) {
    throw new Error(
      `playwright-server: failed to load ${configPath}: ${(e as Error)?.message ?? e}`,
    );
  }
  const user: Partial<ServerConfig> = (mod.default ?? mod) as Partial<ServerConfig>;
  return { ...DEFAULT_CONFIG, ...user };
}

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
