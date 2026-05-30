// Static registry of supervisable davstack daemons.
//
// Each descriptor wraps a `spawn()` factory that returns an attached
// ChildProcess with piped stdout/stderr (NOT inherited — we want the TUI
// to capture the streams into a ring buffer).
//
// Per-daemon defaults (read from each daemon's `src/index.ts`):
//
//   logs-server       port=7077  ready=/listening on http:\/\//i
//                     bin: packages/logs-server/bin/logs-server.mjs
//                     shutdown route: NONE (no /shutdown endpoint; SIGTERM only)
//
//   vitest-server     port=5179  ready=/\[vitest-server\] listening on http:\/\//i
//                     bin: packages/vitest-server/bin/vitest-server.mjs
//                     shutdown route: POST http://127.0.0.1:5179/shutdown
//                     (see packages/vitest-server/src/http.ts:60)
//
// TODO(P5+): parse `.davstack/config/<tool>.config.ts` to honor user-set
// ports/hosts. For v1 we existence-check the config files (see
// config-discovery.ts) and keep these hardcoded defaults.

import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { findRepoRoot } from "./repo-root.ts"

export type DaemonKey = "logs" | "vitest"

export type DaemonDescriptor = {
  key: DaemonKey
  label: string
  port: number
  host?: string
  readyRegex: RegExp
  spawn: () => ChildProcess
  // When set, stop() POSTs to this URL before falling back to killTree.
  shutdownUrl?: string
  // Grace period for the HTTP /shutdown round-trip + clean child exit
  // before SIGTERM escalation. Defaults to 1500ms in useDaemonProcess.
  shutdownTimeoutMs?: number
}

const LOGS_DEFAULT_PORT = 7077
const VITEST_DEFAULT_PORT = 5179

const DEFAULT_HOST = "127.0.0.1"

function pkgLauncher(pkgName: string, binName: string): string {
  // Walk up from cwd looking for node_modules/@davstack/<pkg>/bin/<bin>.mjs.
  // We can't use require.resolve('@davstack/<pkg>/package.json') because
  // Node's strict exports field blocks subpath access to /package.json
  // for every daemon package (they only export `.` and `./config`).
  let dir = process.cwd()
  while (true) {
    const candidate = path.join(
      dir,
      "node_modules",
      "@davstack",
      pkgName,
      "bin",
      `${binName}.mjs`,
    )
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback: in-repo dev (running from the davstack monorepo itself).
  const repoRoot = findRepoRoot(process.cwd())
  return path.join(repoRoot, "packages", pkgName, "bin", `${binName}.mjs`)
}

function spawnLauncher(launcher: string, args: string[]): ChildProcess {
  return spawn(process.execPath, [launcher, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  })
}

export const daemonRegistry: DaemonDescriptor[] = [
  {
    key: "logs",
    label: "logs",
    port: LOGS_DEFAULT_PORT,
    host: DEFAULT_HOST,
    readyRegex: /listening on http:\/\//i,
    spawn: () =>
      spawnLauncher(pkgLauncher("logs-server", "logs-server"), [
        "serve",
        "--port",
        String(LOGS_DEFAULT_PORT),
        "--host",
        DEFAULT_HOST,
      ]),
  },
  {
    key: "vitest",
    label: "vitest",
    port: VITEST_DEFAULT_PORT,
    host: DEFAULT_HOST,
    readyRegex: /\[vitest-server\] listening on http:\/\//i,
    shutdownUrl: `http://${DEFAULT_HOST}:${VITEST_DEFAULT_PORT}/shutdown`,
    spawn: () => {
      const repoRoot = findRepoRoot(process.cwd())
      return spawnLauncher(pkgLauncher("vitest-server", "vitest-server"), [
        "serve",
        "--port",
        String(VITEST_DEFAULT_PORT),
        "--host",
        DEFAULT_HOST,
        "--cwd",
        repoRoot,
      ])
    },
  },
]
