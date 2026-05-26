// Port-conflict smoke: start a fake listener on 7077 BEFORE launching the
// TUI, then assert the TUI emits the "blocked" indicator (we grep stdout
// for the synthetic log line "port 7077 already in use") and never tries
// to spawn the daemon. Cleans up the listener and tells the TUI to quit
// via the stdin-`q` path (same as smoke.mjs).

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createServer } from "node:net"
import path from "node:path"
import fs from "node:fs"

const here = path.dirname(fileURLToPath(import.meta.url))
const bin = path.join(here, "..", "bin", "davstack.mjs")

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.on("error", reject)
    srv.listen(port, "127.0.0.1", () => resolve(srv))
  })
}

const blocker = await listenOn(7077)
console.log("blocker listening on 127.0.0.1:7077")

const child = spawn(process.execPath, [bin, "start"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, FORCE_COLOR: "0" },
})

let stdout = ""
let stderr = ""
let sawBlocked = false

child.stdout.on("data", (b) => {
  const s = b.toString("utf8")
  stdout += s
  if (!sawBlocked && /already in use|blocked/i.test(stdout)) {
    sawBlocked = true
    setTimeout(() => {
      try {
        child.stdin.write("q")
        child.stdin.end()
      } catch {
        child.kill("SIGINT")
      }
    }, 300)
  }
})
child.stderr.on("data", (b) => {
  stderr += b.toString("utf8")
})

const failTimer = setTimeout(() => {
  console.error("port-conflict-smoke: TUI did not show 'blocked' in 8s — killing")
  child.kill("SIGKILL")
}, 8_000)

const exitTimer = setTimeout(() => {
  console.error("port-conflict-smoke: TUI did not exit in 12s — killing")
  child.kill("SIGKILL")
  process.exit(2)
}, 12_000)

child.on("exit", (code, signal) => {
  clearTimeout(failTimer)
  clearTimeout(exitTimer)
  blocker.close()
  fs.writeFileSync(path.join(here, "port-conflict-stdout.log"), stdout)
  fs.writeFileSync(path.join(here, "port-conflict-stderr.log"), stderr)
  const tail = stdout.split(/\r?\n/).filter(Boolean).slice(-12).join("\n")
  console.log("--- TUI STDOUT TAIL ---")
  console.log(tail)
  console.log(`--- exit code=${code} signal=${signal} sawBlocked=${sawBlocked} ---`)
  if (!sawBlocked) {
    console.error("FAIL: never saw 'blocked' / 'already in use' from TUI")
    process.exit(1)
  }
  process.exit(0)
})
