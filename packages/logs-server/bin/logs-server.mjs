#!/usr/bin/env node
// logs-server launches under bun: src/db.ts uses bun:sqlite and src/server.ts
// uses Bun.serve. Runs the compiled dist/index.js — bun executes plain ESM
// fine. A node-runtime port is open in the migration backlog but blocked on
// the bun:sqlite / Bun.serve calls; once swapped the node branch becomes real.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'dist', 'index.js')
const runtime = process.env.LOGS_SERVER_RUNTIME ?? 'bun'

let cmd, args
if (runtime === 'bun') {
  cmd = 'bun'
  args = [entry, ...process.argv.slice(2)]
} else if (runtime === 'node') {
  cmd = process.execPath
  args = [entry, ...process.argv.slice(2)]
} else {
  console.error(`logs-server: unknown LOGS_SERVER_RUNTIME='${runtime}' (expected 'bun' or 'node')`)
  process.exit(2)
}

// shell:true on win32 is needed for the `bun` .cmd shim but breaks
// process.execPath (spaces in "Program Files"). Gate it to bun.
const needsShell = process.platform === 'win32' && runtime === 'bun'
const child = spawn(cmd, args, { stdio: 'inherit', shell: needsShell })
child.on('error', (err) => {
  if (err.code === 'ENOENT' && runtime === 'bun') {
    console.error("logs-server: bun not found on PATH. Install bun (https://bun.sh) or set LOGS_SERVER_RUNTIME=node once the node port lands.")
  } else {
    console.error('logs-server: launcher error:', err)
  }
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
