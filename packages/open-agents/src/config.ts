// Config-file loader for @davstack/open-agents.
//
// Reads `<repo-root>/.davstack/config/open-agents.config.ts` (or the fallbacks
// resolved by `findToolConfig`) and exposes the merged shape to the caller.
// CLI flags and env vars still win — this layer only fills in defaults below
// them. Per-repo overrides for defaultModel / defaultAdapter / defaultTimeoutSec
// + per-profile prompt extensions (the originally motivating use case — repo
// conventions like "cite path:line" that the profile scaffolds don't include).
//
// Runtime is bun in production; loader uses dynamic import() so plain Node
// with `--experimental-transform-types` also works for the smoke test.

import { resolve } from 'node:path';
import { findRepoRoot, findToolConfig } from '@davstack/cli-utils/config';

export type AdapterName = 'cursor' | 'gemini' | 'agy';

export type ProfileOverrides = {
  systemPromptExtension?: string;
};

export type OpenAgentsConfig = {
  defaultModel?: string;
  defaultAdapter?: AdapterName;
  defaultTimeoutSec?: number;
  profiles?: {
    explore?: ProfileOverrides;
    edit?: ProfileOverrides;
  };
};

export type LoadedConfig = OpenAgentsConfig & {
  _source?: string;
  _repoRoot?: string;
};

const VALID_ADAPTERS: AdapterName[] = ['cursor', 'gemini', 'agy'];

export async function loadConfig(cwd: string = process.cwd()): Promise<LoadedConfig> {
  const repoRoot = findRepoRoot(cwd);
  const configPath = findToolConfig('open-agents', cwd);

  if (!configPath) {
    return { _repoRoot: repoRoot };
  }

  let raw: OpenAgentsConfig = {};
  try {
    // file:// URL keeps Windows absolute paths import-safe.
    const mod = await import(/* @vite-ignore */ pathToFileUrl(configPath));
    const exported = (mod as { default?: unknown }).default ?? mod;
    if (exported && typeof exported === 'object') {
      raw = exported as OpenAgentsConfig;
    }
  } catch (err) {
    process.stderr.write(
      `[open-agents] failed to load config ${configPath}: ${(err as Error).message}\n`,
    );
    return { _source: configPath, _repoRoot: repoRoot };
  }

  const merged: LoadedConfig = {
    defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel : undefined,
    defaultAdapter:
      typeof raw.defaultAdapter === 'string' && VALID_ADAPTERS.includes(raw.defaultAdapter)
        ? raw.defaultAdapter
        : undefined,
    defaultTimeoutSec:
      typeof raw.defaultTimeoutSec === 'number' && raw.defaultTimeoutSec > 0
        ? raw.defaultTimeoutSec
        : undefined,
    profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : undefined,
    _source: configPath,
    _repoRoot: repoRoot,
  };

  return merged;
}

function pathToFileUrl(p: string): string {
  // Minimal local equivalent of url.pathToFileURL(p).href to avoid the extra
  // import and to keep the surface trivially auditable.
  const abs = resolve(p).replace(/\\/g, '/');
  return abs.startsWith('/') ? `file://${abs}` : `file:///${abs}`;
}
