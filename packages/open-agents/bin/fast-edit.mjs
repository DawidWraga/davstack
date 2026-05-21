#!/usr/bin/env node
// open-agents (fast-edit profile) launcher. See bin/explore.mjs for the
// runtime selection rationale — same shim, different entrypoint.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'src', 'entrypoints', 'fast-edit.ts')
const runtime = process.env.OPEN_AGENTS_RUNTIME ?? 'bun'

let cmd, args
if (runtime === 'bun') {
  cmd = 'bun'
  args = [entry, ...process.argv.slice(2)]
} else if (runtime === 'node') {
  cmd = process.execPath
  args = ['--experimental-transform-types', entry, ...process.argv.slice(2)]
} else {
  console.error(`fast-edit: unknown OPEN_AGENTS_RUNTIME='${runtime}' (expected 'bun' or 'node')`)
  process.exit(2)
}

const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' })
child.on('error', (err) => {
  if (err.code === 'ENOENT' && runtime === 'bun') {
    console.error("fast-edit: bun not found on PATH. Install bun (https://bun.sh) or set OPEN_AGENTS_RUNTIME=node.")
  } else {
    console.error('fast-edit: launcher error:', err)
  }
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
