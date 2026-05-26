// Discover which davstack daemons are configured in the current repo.
//
// v1 strategy: existence-check `.davstack/config/<tool>.config.ts`. The
// daemon packages themselves load these via tsx — the TUI does NOT parse
// them. Ports/hosts stay hardcoded in daemon-registry.ts for now.
//
// TODO: tolerant regex parse of `port:` / `host:` / `enabled:` from
// the config file text, OR have the daemons emit a resolved config JSON
// that the TUI can read.

import fs from "node:fs/promises"
import fsSync from "node:fs"
import path from "node:path"

import type { DaemonKey } from "./daemon-registry.ts"

// File name -> daemon key. Mirrors the templates in
// packages/init/src/templates/. Daemons whose config file isn't present
// won't render a row in the TUI.
const CONFIG_FILE_TO_KEY: Record<string, DaemonKey> = {
  "logs-server.config.ts": "logs",
  "vitest-server.config.ts": "vitest",
  "playwright-server.config.ts": "playwright",
}

export async function discoverEnabledDaemons(repoRoot: string): Promise<Set<DaemonKey>> {
  const configDir = path.join(repoRoot, ".davstack", "config")
  const enabled = new Set<DaemonKey>()
  let entries: string[]
  try {
    entries = await fs.readdir(configDir)
  } catch {
    return enabled
  }
  for (const entry of entries) {
    const key = CONFIG_FILE_TO_KEY[entry]
    if (key !== undefined) enabled.add(key)
  }
  return enabled
}

// Walk up from `startDir` looking for the nearest `.davstack/config/`
// directory; returns the parent dir (treat as the config root) or null.
// Consumers can park `.davstack/config/` at the monorepo root while
// running the TUI from a workspace subdir.
export function findConfigRoot(startDir: string): string | null {
  let dir = path.resolve(startDir)
  while (true) {
    try {
      const stat = fsSync.statSync(path.join(dir, ".davstack", "config"))
      if (stat.isDirectory()) return dir
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}
