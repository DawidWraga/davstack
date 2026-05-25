#!/usr/bin/env node
// vitest-server launcher. Default to tsx (handles TS under node_modules,
// which Node 24's --experimental-transform-types refuses; bun runs the
// daemon fine but spawns vitest workers that misbehave under bun, so
// node-via-tsx is the safe default). Opt into bun with
// VITEST_SERVER_RUNTIME=bun, or plain Node with =node (only works when
// src is NOT under node_modules).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'src', 'index.ts')
const runtime = process.env.VITEST_SERVER_RUNTIME ?? 'tsx'

let cmd, args
if (runtime === 'tsx') {
  const require = createRequire(import.meta.url)
  const tsxCli = require.resolve('tsx/cli')
  cmd = process.execPath
  args = [tsxCli, entry, ...process.argv.slice(2)]
} else if (runtime === 'bun') {
  cmd = 'bun'
  args = [entry, ...process.argv.slice(2)]
} else if (runtime === 'node') {
  cmd = process.execPath
  args = ['--experimental-transform-types', entry, ...process.argv.slice(2)]
} else {
  console.error(`vitest-server: unknown VITEST_SERVER_RUNTIME='${runtime}' (expected 'tsx', 'bun', or 'node')`)
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
