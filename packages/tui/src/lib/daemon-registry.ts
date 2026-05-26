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
//   playwright-server port=5180  ready=/\[playwright-server\] listening on http:\/\//i
//                     bin: packages/playwright-server/bin/playwright-server.mjs
//                     shutdown route: POST http://127.0.0.1:5180/shutdown
//                     (see packages/playwright-server/src/http.ts:76)
//
// TODO(P5+): parse `.davstack/config/<tool>.config.ts` to honor user-set
// ports/hosts. For v1 we existence-check the config files (see
// config-discovery.ts) and keep these hardcoded defaults.

import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"

import { findRepoRoot } from "./repo-root.ts"

export type DaemonKey = "logs" | "vitest" | "playwright"

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
const PLAYWRIGHT_DEFAULT_PORT = 5180

const DEFAULT_HOST = "127.0.0.1"

function pkgLauncher(pkgName: string, binName: string): string {
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
  {
    key: "playwright",
    label: "playwright",
    port: PLAYWRIGHT_DEFAULT_PORT,
    host: DEFAULT_HOST,
    readyRegex: /\[playwright-server\] listening on http:\/\//i,
    shutdownUrl: `http://${DEFAULT_HOST}:${PLAYWRIGHT_DEFAULT_PORT}/shutdown`,
    spawn: () => {
      const repoRoot = findRepoRoot(process.cwd())
      return spawnLauncher(pkgLauncher("playwright-server", "playwright-server"), [
        "serve",
        "--port",
        String(PLAYWRIGHT_DEFAULT_PORT),
        "--host",
        DEFAULT_HOST,
        "--cwd",
        repoRoot,
      ])
    },
  },
]
