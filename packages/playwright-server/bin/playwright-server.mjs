#!/usr/bin/env node
// playwright-server launcher. Plain node runs the compiled dist/ directly;
// bun stays as an opt-in (PLAYWRIGHT_SERVER_RUNTIME=bun) for cold-boot speed.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'dist', 'index.js')
const runtime = process.env.PLAYWRIGHT_SERVER_RUNTIME ?? 'node'

let cmd, args
if (runtime === 'node') {
  cmd = process.execPath
  args = [entry, ...process.argv.slice(2)]
} else if (runtime === 'bun') {
  cmd = 'bun'
  args = [entry, ...process.argv.slice(2)]
} else {
  console.error(`playwright-server: unknown PLAYWRIGHT_SERVER_RUNTIME='${runtime}' (expected 'node' or 'bun')`)
  process.exit(2)
}

const needsShell = process.platform === 'win32' && runtime === 'bun'
const child = spawn(cmd, args, { stdio: 'inherit', shell: needsShell })
child.on('error', (err) => {
  if (err.code === 'ENOENT' && runtime === 'bun') {
    console.error("playwright-server: bun not found on PATH. Install bun (https://bun.sh) or unset PLAYWRIGHT_SERVER_RUNTIME.")
  } else {
    console.error('playwright-server: launcher error:', err)
  }
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
