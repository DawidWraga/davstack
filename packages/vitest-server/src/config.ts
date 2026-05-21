// Consumer-facing config loader for vitest-server. The skill knows nothing
// about which vitest project a consumer wants to host or which file makes a
// good prime; that's all here, with defaults that match the common case
// (storybook addon-vitest + a stories.tsx file).

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export type ServerConfig = {
  // Vitest project filter (the `project` CLI flag). Most setups have a
  // dedicated browser-mode project for storybook stories.
  project: string;
  // File path used to prime the storybook plugin's per-story `transform`
  // hook on boot. Must be a REAL test/story file in the consumer project —
  // not a noop, or the plugin half-initialises and reruns yield "(0 test)".
  primeFile: string;
};

export const DEFAULT_CONFIG: ServerConfig = {
  project: 'storybook',
  primeFile: '',
};

const CONFIG_FILENAME = 'vitest-server.config.ts';

export async function loadConfig(cwd: string): Promise<ServerConfig> {
  const configPath = resolve(cwd, CONFIG_FILENAME);
  if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
  let mod: { default?: Partial<ServerConfig> } & Partial<ServerConfig>;
  try {
    mod = await import(pathToFileURL(configPath).href);
  } catch (e) {
    throw new Error(
      `vitest-server: failed to load ${configPath}: ${(e as Error)?.message ?? e}`,
    );
  }
  const user: Partial<ServerConfig> = (mod.default ?? mod) as Partial<ServerConfig>;
  return { ...DEFAULT_CONFIG, ...user };
}
