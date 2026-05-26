#!/usr/bin/env node
// open-agents (explore profile) launcher. Runs the compiled dist/explore.js
// under plain node by default; bun stays as an opt-in via OPEN_AGENTS_RUNTIME=bun.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'dist', 'explore.js')
const runtime = process.env.OPEN_AGENTS_RUNTIME ?? 'node'

let cmd, args
if (runtime === 'node') {
  cmd = process.execPath
  args = [entry, ...process.argv.slice(2)]
} else if (runtime === 'bun') {
  cmd = 'bun'
  args = [entry, ...process.argv.slice(2)]
} else {
  console.error(`explore: unknown OPEN_AGENTS_RUNTIME='${runtime}' (expected 'node' or 'bun')`)
  process.exit(2)
}

// shell: true on Windows is needed for the `bun` .cmd shim, but it breaks
// `process.execPath` which has spaces ("C:\Program Files\nodejs\node.exe").
// Only enable for the bun path.
const needsShell = process.platform === 'win32' && runtime === 'bun'
const child = spawn(cmd, args, { stdio: 'inherit', shell: needsShell })
child.on('error', (err) => {
  if (err.code === 'ENOENT' && runtime === 'bun') {
    console.error("explore: bun not found on PATH. Install bun (https://bun.sh) or unset OPEN_AGENTS_RUNTIME.")
  } else {
    console.error('explore: launcher error:', err)
  }
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
