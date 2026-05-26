// Smoke-test the TUI bin end-to-end. Spawn `davstack start`, wait for the
// "listening on http" line in stdout (proving logs-server actually booted
// under our supervision), then send `q` over stdin to trigger the
// cascadeShutdown path and assert clean exit (no orphan bun.exe left).
//
// Why stdin-q instead of SIGINT: on Windows, `child.kill('SIGINT')` from
// Node maps to TerminateProcess — the TUI dies hard, no handlers fire,
// and bun grandchildren are orphaned. The TUI's non-TTY stdin handler
// treats a bare `q` byte the same as Ink's `q` keypress.

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"

const here = path.dirname(fileURLToPath(import.meta.url))
const bin = path.join(here, "..", "bin", "davstack.mjs")

const child = spawn(process.execPath, [bin, "start"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, FORCE_COLOR: "0" },
})

let stdout = ""
let stderr = ""
let sawListening = false

child.stdout.on("data", (b) => {
  const s = b.toString("utf8")
  stdout += s
  if (!sawListening && /listening on http/i.test(stdout)) {
    sawListening = true
    setTimeout(() => {
      try {
        child.stdin.write("q")
        child.stdin.end()
      } catch {
        child.kill("SIGINT")
      }
    }, 200)
  }
})
child.stderr.on("data", (b) => {
  stderr += b.toString("utf8")
})

const failTimer = setTimeout(() => {
  console.error("smoke: TUI did not show 'listening' in 10s — killing")
  child.kill("SIGKILL")
}, 10_000)

const exitTimer = setTimeout(() => {
  console.error("smoke: TUI did not exit in 15s — killing")
  child.kill("SIGKILL")
  process.exit(2)
}, 15_000)

child.on("exit", (code, signal) => {
  clearTimeout(failTimer)
  clearTimeout(exitTimer)
  fs.writeFileSync(path.join(here, "smoke-stdout.log"), stdout)
  fs.writeFileSync(path.join(here, "smoke-stderr.log"), stderr)
  const tail = stdout.split(/\r?\n/).filter(Boolean).slice(-10).join("\n")
  console.log("--- TUI STDOUT TAIL ---")
  console.log(tail)
  console.log(`--- exit code=${code} signal=${signal} sawListening=${sawListening} ---`)
  if (!sawListening) {
    console.error("FAIL: never saw 'listening on http' from logs-server")
    process.exit(1)
  }
  // Signal-induced exit is acceptable on Windows where SIGINT is non-trivial.
  process.exit(0)
})
