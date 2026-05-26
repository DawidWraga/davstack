import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test, expect, describe } from "vitest"

import { findRepoRoot } from "./repo-root.ts"

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe("findRepoRoot", () => {
  test("locates root via pnpm-workspace.yaml from a nested dir", () => {
    const root = mkTmp("davstack-rr-")
    fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n")
    const nested = path.join(root, "packages", "foo", "src", "deep")
    fs.mkdirSync(nested, { recursive: true })
    // realpath: tmpdir on macOS/Windows can be a symlink alias.
    expect(fs.realpathSync(findRepoRoot(nested))).toBe(fs.realpathSync(root))
  })

  test("locates root via private package.json when no workspace yaml", () => {
    const root = mkTmp("davstack-rr-")
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x", private: true }))
    const nested = path.join(root, "a", "b")
    fs.mkdirSync(nested, { recursive: true })
    expect(fs.realpathSync(findRepoRoot(nested))).toBe(fs.realpathSync(root))
  })

  test("throws when not inside a davstack-shaped repo", () => {
    const root = mkTmp("davstack-rr-nope-")
    // No workspace yaml, no private package.json.
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x" }))
    expect(() => findRepoRoot(root)).toThrow(/not inside a davstack-shaped repo/)
  })
})
