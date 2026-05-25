#!/usr/bin/env node
// davstack-init launcher. Default to tsx (handles TS under node_modules,
// which Node 24's --experimental-transform-types refuses). Opt into bun
// with DAVSTACK_INIT_RUNTIME=bun, or plain Node with =node (the latter
// only works when src is NOT under node_modules).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'src', 'index.ts')
const runtime = process.env.DAVSTACK_INIT_RUNTIME ?? 'tsx'

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
  console.error(`davstack-init: unknown DAVSTACK_INIT_RUNTIME='${runtime}' (expected 'tsx', 'bun', or 'node')`)
  process.exit(2)
}

const needsShell = process.platform === 'win32' && runtime === 'bun'
const child = spawn(cmd, args, { stdio: 'inherit', shell: needsShell })
child.on('error', (err) => {
  if (err.code === 'ENOENT' && runtime === 'bun') {
    console.error("davstack-init: bun not found on PATH. Install bun (https://bun.sh) or unset DAVSTACK_INIT_RUNTIME.")
  } else {
    console.error('davstack-init: launcher error:', err)
  }
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
