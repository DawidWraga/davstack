#!/usr/bin/env node
// vitest-server launcher. Plain node runs the compiled dist/ directly; bun
// stays as an opt-in (VITEST_SERVER_RUNTIME=bun) for users who want the
// cold-boot speed but accept the Storybook-on-Windows caveat.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'dist', 'index.js')
const runtime = process.env.VITEST_SERVER_RUNTIME ?? 'node'

let cmd, args
if (runtime === 'node') {
  cmd = process.execPath
  args = [entry, ...process.argv.slice(2)]
} else if (runtime === 'bun') {
  cmd = 'bun'
  args = [entry, ...process.argv.slice(2)]
} else {
  console.error(`vitest-server: unknown VITEST_SERVER_RUNTIME='${runtime}' (expected 'node' or 'bun')`)
  process.exit(2)
}

const needsShell = process.platform === 'win32' && runtime === 'bun'
const child = spawn(cmd, args, { stdio: 'inherit', shell: needsShell })
child.on('error', (err) => {
  if (err.code === 'ENOENT' && runtime === 'bun') {
    console.error("vitest-server: bun not found on PATH. Install bun (https://bun.sh) or unset VITEST_SERVER_RUNTIME.")
  } else {
    console.error('vitest-server: launcher error:', err)
  }
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
