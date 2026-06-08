#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'dist', 'cli.js')
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit' })

child.on('error', (err) => {
  console.error('davstack-meta: launcher error:', err)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
