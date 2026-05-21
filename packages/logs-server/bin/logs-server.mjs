#!/usr/bin/env node
// logs-server launches under bun: src/db.ts uses bun:sqlite and src/server.ts
// uses Bun.serve. A node-runtime port is open in the migration backlog but
// not blocking — bun is already required by traffease's existing setup.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'src', 'index.ts')
const runtime = process.env.LOGS_SERVER_RUNTIME ?? 'bun'

let cmd, args
if (runtime === 'bun') {
  cmd = 'bun'
  args = [entry, ...process.argv.slice(2)]
} else if (runtime === 'node') {
  cmd = process.execPath
  args = ['--experimental-transform-types', entry, ...process.argv.slice(2)]
} else {
  console.error(`logs-server: unknown LOGS_SERVER_RUNTIME='${runtime}' (expected 'bun' or 'node')`)
  process.exit(2)
}

const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
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
