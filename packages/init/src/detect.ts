// Repo root + package manager detection for @davstack/init.
//
// Resolution order for the repo root:
//   1. `git rev-parse --show-toplevel`
//   2. Walk up for pnpm-workspace.yaml / turbo.json / lerna.json /
//      package.json with a `workspaces` field (monorepo signal)
//   3. Walk up for any package.json (single-package signal)
//   4. cwd (last resort)
//
// Package manager is sniffed by lockfile, with a sane default of npm.

import { execSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

export type RepoRootSource =
  | "git"
  | "workspace"
  | "package.json"
  | "cwd"

export interface RepoRootResult {
  root: string
  source: RepoRootSource
}

export type PackageManager = "pnpm" | "yarn" | "bun" | "npm"

export interface PackageManagerResult {
  manager: PackageManager
  source: "lockfile" | "default"
  lockfile?: string
}

const WORKSPACE_FILES = ["pnpm-workspace.yaml", "turbo.json", "lerna.json"]

function tryGitRoot(cwd: string): string | undefined {
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
    if (out) return path.resolve(out)
  } catch {
    // not a git repo
  }
  return undefined
}

function hasWorkspaceMarker(dir: string): boolean {
  for (const f of WORKSPACE_FILES) {
    if (existsSync(path.join(dir, f))) return true
  }
  const pkgPath = path.join(dir, "package.json")
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
      if (pkg.workspaces) return true
    } catch {
      // ignore malformed package.json
    }
  }
  return false
}

function walkUp(start: string, predicate: (dir: string) => boolean): string | undefined {
  let dir = path.resolve(start)
  while (true) {
    if (predicate(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export function detectRepoRoot(cwd: string = process.cwd()): RepoRootResult {
  const gitRoot = tryGitRoot(cwd)
  if (gitRoot) return { root: gitRoot, source: "git" }

  const workspaceRoot = walkUp(cwd, hasWorkspaceMarker)
  if (workspaceRoot) return { root: workspaceRoot, source: "workspace" }

  const pkgRoot = walkUp(cwd, (d) => existsSync(path.join(d, "package.json")))
  if (pkgRoot) return { root: pkgRoot, source: "package.json" }

  return { root: path.resolve(cwd), source: "cwd" }
}

const LOCKFILES: { file: string; manager: PackageManager }[] = [
  { file: "pnpm-lock.yaml", manager: "pnpm" },
  { file: "yarn.lock", manager: "yarn" },
  { file: "bun.lockb", manager: "bun" },
  { file: "package-lock.json", manager: "npm" },
]

export function detectPackageManager(root: string): PackageManagerResult {
  for (const { file, manager } of LOCKFILES) {
    if (existsSync(path.join(root, file))) {
      return { manager, source: "lockfile", lockfile: file }
    }
  }
  return { manager: "npm", source: "default" }
}

export function isPnpmWorkspaceRoot(root: string): boolean {
  return existsSync(path.join(root, "pnpm-workspace.yaml"))
}
