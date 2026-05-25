// Consumer-facing config loader for vitest-server. The skill knows nothing
// about which vitest project a consumer wants to host or which file makes a
// good prime; that's all here, with defaults that match the common case
// (storybook addon-vitest + a stories.tsx file).

import { pathToFileURL } from 'node:url';
import { findToolConfig } from '@davstack/cli-utils/config';

// User-facing config shape. Every field is optional — defaults below fill in
// the rest. Consumers `satisfies ServerConfig` their config file with this.
export type ServerConfig = {
  // Daemon HTTP port (default 5179).
  port?: number;
  // Daemon HTTP host (default 127.0.0.1).
  host?: string;
  // Vitest project filter (the `project` CLI flag). Most setups have a
  // dedicated browser-mode project for storybook stories.
  project?: string;
  // File path used to prime the storybook plugin's per-story `transform`
  // hook on boot. If unset, the daemon auto-discovers. Must be a REAL
  // test/story file when provided — not a noop, or the plugin
  // half-initialises and reruns yield "(0 test)".
  primeFile?: string;
};

// Post-merge resolved shape used internally. `project` is always populated
// because the default below provides it.
export type ResolvedConfig = {
  port?: number;
  host?: string;
  project: string;
  primeFile?: string;
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  project: 'storybook',
};

export async function loadConfig(cwd: string): Promise<ResolvedConfig> {
  const configPath = findToolConfig('vitest-server', cwd);
  if (!configPath) return { ...DEFAULT_CONFIG };
  console.error('[vitest-server] config loaded from: ' + configPath);
  let mod: { default?: ServerConfig } & ServerConfig;
  try {
    mod = await import(pathToFileURL(configPath).href);
  } catch (e) {
    throw new Error(
      `vitest-server: failed to load ${configPath}: ${(e as Error)?.message ?? e}`,
    );
  }
  const user: ServerConfig = (mod.default ?? mod) as ServerConfig;
  return { ...DEFAULT_CONFIG, ...user };
}
