// Static registry of supervisable davstack daemons.
//
// Each descriptor wraps a `spawn()` factory that returns an attached
// ChildProcess with piped stdout/stderr (NOT inherited — we want the TUI
// to capture the streams into a ring buffer).

import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"

import { findRepoRoot } from "./repo-root.ts"

export type DaemonKey = "logs"

export type DaemonDescriptor = {
  key: DaemonKey
  label: string
  port: number
  readyRegex: RegExp
  spawn: () => ChildProcess
}

// logs-server hardcoded default — `packages/logs-server/src/server.ts:18`.
// P4 will read this from `.davstack/config/logs-server.config.ts`.
const LOGS_DEFAULT_PORT = 7077

export const daemonRegistry: DaemonDescriptor[] = [
  {
    key: "logs",
    label: "logs",
    port: LOGS_DEFAULT_PORT,
    readyRegex: /listening on http:\/\//i,
    spawn: () => {
      const repoRoot = findRepoRoot(process.cwd())
      const launcher = path.join(repoRoot, "packages", "logs-server", "bin", "logs-server.mjs")
      return spawn(
        process.execPath,
        [launcher, "serve", "--port", String(LOGS_DEFAULT_PORT), "--host", "127.0.0.1"],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      )
    },
  },
]
