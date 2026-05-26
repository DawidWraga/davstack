// Process-level emergency teardown.
//
// Keeps a module-level Set of supervised child PIDs. `useDaemonProcess`
// registers on spawn and unregisters on exit. If the TUI itself dies
// (uncaughtException / unhandledRejection / process.exit), we synchronously
// best-effort kill the lot so we don't leave orphan bun/node grandchildren.
//
// `exit` is sync — we fire taskkill /T /F on Windows (the OS handles
// reaping) and process.kill SIGKILL elsewhere. We do NOT await; if the
// process is on its way out anyway, the OS will clean us up.

import { exec } from "node:child_process"

const supervised = new Set<number>()
let installed = false

export function registerChild(pid: number): void {
  if (pid > 0) supervised.add(pid)
}

export function unregisterChild(pid: number): void {
  supervised.delete(pid)
}

// Sync best-effort kill — used inside process exit handlers where async
// has no time to run.
function killAllSync(): void {
  for (const pid of supervised) {
    try {
      if (process.platform === "win32") {
        // Fire-and-forget. We're inside an exit handler — don't await.
        exec(`taskkill /T /F /PID ${pid}`)
      } else {
        process.kill(pid, "SIGKILL")
      }
    } catch {
      // Ignore — best effort.
    }
  }
}

export function installGlobalTeardown(): void {
  if (installed) return
  installed = true

  process.on("exit", () => {
    killAllSync()
  })

  process.on("uncaughtException", (err) => {
    killAllSync()
    // Re-surface so the user actually sees what crashed.
    // eslint-disable-next-line no-console
    console.error("[davstack tui] uncaughtException — killed children:", err)
    process.exit(1)
  })

  process.on("unhandledRejection", (reason) => {
    killAllSync()
    // eslint-disable-next-line no-console
    console.error("[davstack tui] unhandledRejection — killed children:", reason)
    process.exit(1)
  })
}

// Test-only helpers.
export function _resetForTests(): void {
  supervised.clear()
  installed = false
}

export function _supervisedSnapshot(): number[] {
  return Array.from(supervised)
}
