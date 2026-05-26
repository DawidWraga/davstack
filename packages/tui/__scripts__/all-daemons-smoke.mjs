// Multi-daemon smoke test for `davstack start`.
//
// Spawn the TUI bin, watch stdout for the "listening on http" line from
// each daemon whose `.davstack/config/<tool>.config.ts` is present in
// this repo, then send `q` to trigger a clean cascade shutdown.
//
// Prerequisites:
// - `bun` on PATH (logs-server defaults to bun runtime).
// - vitest-server + playwright-server use tsx by default — no extra
//   binary needed beyond Node 24.
// - Playwright chromium download may not be present on every dev box;
//   if playwright-server fails to start, that's noted in the report
//   but doesn't fail the run (unit tests are the contract).
//
// Reports which daemons came up + which didn't.

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"
import fs from "node:fs"

const here = path.dirname(fileURLToPath(import.meta.url))
const tuiRoot = path.dirname(here)
const repoRoot = path.resolve(tuiRoot, "..", "..")
const bin = path.join(tuiRoot, "bin", "davstack.mjs")

// Detect which configs are present so we know what to expect.
const configDir = path.join(repoRoot, ".davstack", "config")
const knownConfigs = {
  "logs-server.config.ts": "logs",
  "vitest-server.config.ts": "vitest",
  "playwright-server.config.ts": "playwright",
}
let expected = []
try {
  const entries = fs.readdirSync(configDir)
  expected = entries.map((e) => knownConfigs[e]).filter(Boolean)
} catch {
  // no configs — TUI will render empty state
}

console.log(`smoke: repo=${repoRoot}`)
console.log(`smoke: expected daemons from configs: [${expected.join(", ") || "(none)"}]`)

const child = spawn(process.execPath, [bin, "start"], {
  cwd: repoRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, FORCE_COLOR: "0" },
})

let stdout = ""
let stderr = ""
const sawListening = new Set()

function checkListening(s) {
  // Each daemon prefixes its log lines slightly differently, but they all
  // contain "listening on http://". For multi-daemon disambiguation, look
  // for the labels too.
  if (/\[vitest-server\] listening on http/i.test(s)) sawListening.add("vitest")
  if (/\[playwright-server\] listening on http/i.test(s)) sawListening.add("playwright")
  if (/log-server listening on http/i.test(s)) sawListening.add("logs")
}

child.stdout.on("data", (b) => {
  const s = b.toString("utf8")
  stdout += s
  checkListening(stdout)
})
child.stderr.on("data", (b) => {
  stderr += b.toString("utf8")
})

// Per-daemon boot timeouts: vitest cold start can be 30s; playwright
// (chromium launch + auth) can be 30s. Give them all 60s total.
const BOOT_TIMEOUT_MS = 60_000
const EXIT_TIMEOUT_MS = 75_000

const failTimer = setTimeout(() => {
  console.error(`smoke: only saw ${sawListening.size}/${expected.length} daemons in ${BOOT_TIMEOUT_MS}ms — sending q`)
  try {
    child.stdin.write("q")
    child.stdin.end()
  } catch {
    child.kill("SIGKILL")
  }
}, BOOT_TIMEOUT_MS)

const exitTimer = setTimeout(() => {
  console.error("smoke: TUI did not exit — killing")
  child.kill("SIGKILL")
  process.exit(2)
}, EXIT_TIMEOUT_MS)

// Periodically check if all expected daemons booted; once they have,
// send `q`.
const pollHandle = setInterval(() => {
  if (expected.length > 0 && expected.every((k) => sawListening.has(k))) {
    clearInterval(pollHandle)
    console.log(`smoke: all ${expected.length} daemon(s) booted — sending q`)
    try {
      child.stdin.write("q")
      child.stdin.end()
    } catch {
      child.kill("SIGINT")
    }
  }
}, 250)

child.on("exit", (code, signal) => {
  clearTimeout(failTimer)
  clearTimeout(exitTimer)
  clearInterval(pollHandle)
  fs.writeFileSync(path.join(here, "all-daemons-smoke-stdout.log"), stdout)
  fs.writeFileSync(path.join(here, "all-daemons-smoke-stderr.log"), stderr)
  const tail = stdout.split(/\r?\n/).filter(Boolean).slice(-20).join("\n")
  console.log("--- TUI STDOUT TAIL ---")
  console.log(tail)
  console.log(`--- exit code=${code} signal=${signal} ---`)
  console.log(`expected: [${expected.join(", ")}]`)
  console.log(`sawListening: [${[...sawListening].join(", ")}]`)
  const missing = expected.filter((k) => !sawListening.has(k))
  if (missing.length > 0) {
    console.error(`MISSING: [${missing.join(", ")}]`)
    process.exit(1)
  }
  process.exit(0)
})
