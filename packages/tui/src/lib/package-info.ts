// Small helpers for the empty-state block — package version + repo root.
// Pulled out so MainView doesn't need to deal with JSON-import gymnastics
// or repo-root throw-paths.

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { findRepoRoot } from "./repo-root.ts"

let cachedVersion: string | null = null

export function getPackageVersion(): string {
  if (cachedVersion !== null) return cachedVersion
  try {
    // package-info.ts lives at packages/tui/src/lib/. The package.json is
    // two dirs up.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const pkgPath = path.join(here, "..", "..", "package.json")
    const raw = fs.readFileSync(pkgPath, "utf8")
    const parsed = JSON.parse(raw) as { version?: string }
    cachedVersion = parsed.version ?? "0.0.0"
  } catch {
    cachedVersion = "0.0.0"
  }
  return cachedVersion
}

export function getRepoRootSafe(): string {
  try {
    return findRepoRoot(process.cwd())
  } catch {
    return process.cwd()
  }
}
