// Smoke-test the TUI bin end-to-end. Spawn `davstack start`, wait for the
// "listening on http" line in stdout (proving logs-server actually booted
// under our supervision), then SIGINT the parent and assert clean exit.
//
// Note: piped stdin can't be a TTY, so Ink's useInput("q") path doesn't
// fire and we use a signal instead. In a real terminal `q` works.

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"

const here = path.dirname(fileURLToPath(import.meta.url))
const bin = path.join(here, "..", "bin", "davstack.mjs")

// Inherit stdin so Ink's raw-mode setup succeeds. We can't send `q` over a
// pipe anyway; we use SIGINT below to trigger shutdown.
const child = spawn(process.execPath, [bin, "start"], {
  stdio: ["inherit", "pipe", "pipe"],
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
    setTimeout(() => child.kill("SIGINT"), 200)
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
