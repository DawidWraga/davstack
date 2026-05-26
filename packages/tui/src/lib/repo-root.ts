// Walk up from a starting directory to find the davstack repo root.
// A davstack-shaped repo has either a `pnpm-workspace.yaml` or a top-level
// `package.json` with `"private": true` at its root.

import fs from "node:fs"
import path from "node:path"

export function findRepoRoot(startDir: string): string {
  let cur = path.resolve(startDir)
  // Stop at filesystem root.
  while (true) {
    if (fs.existsSync(path.join(cur, "pnpm-workspace.yaml"))) return cur
    const pkgPath = path.join(cur, "package.json")
    if (fs.existsSync(pkgPath)) {
      try {
        const raw = fs.readFileSync(pkgPath, "utf8")
        const parsed = JSON.parse(raw) as { private?: boolean }
        if (parsed.private === true) return cur
      } catch {
        // Ignore malformed package.json and keep walking.
      }
    }
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  throw new Error(
    `findRepoRoot: not inside a davstack-shaped repo (no pnpm-workspace.yaml or private package.json found walking up from ${startDir})`,
  )
}
