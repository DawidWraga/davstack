// Consumer-facing config loader for vitest-server. The skill knows nothing
// about which vitest project a consumer wants to host or which file makes a
// good prime; that's all here, with defaults that match the common case
// (storybook addon-vitest + a stories.tsx file).

import { pathToFileURL } from 'node:url';
import { findToolConfig } from '@davstack/cli-utils/config';

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

export async function loadConfig(cwd: string): Promise<ServerConfig> {
  const configPath = findToolConfig('vitest-server', cwd);
  if (!configPath) return { ...DEFAULT_CONFIG };
  console.error('[vitest-server] config loaded from: ' + configPath);
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
