// Resolve the PID listening on a TCP port. Pure lookup — no side effects.
//
// Windows: `netstat -ano -p tcp` (no admin). POSIX: `lsof` only in v1 — if
// missing, return null and log rather than trying ss/fuser fallbacks.

import { exec } from "node:child_process"

function execStdout(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

export async function findPortOwner(host: string, port: number): Promise<number | null> {
  if (process.platform === "win32") {
    return findPortOwnerWindows(host, port)
  }
  return findPortOwnerPosix(port)
}

function matchesHost(localHost: string, targetHost: string): boolean {
  if (localHost === "0.0.0.0" || localHost === "[::]" || localHost === "::") return true
  if (targetHost === "127.0.0.1" && localHost === "127.0.0.1") return true
  if (targetHost === "localhost" && localHost === "127.0.0.1") return true
  if (targetHost === "::1" && (localHost === "::1" || localHost === "[::1]")) return true
  return localHost === targetHost || localHost === `[${targetHost}]`
}

function parseNetstatLine(line: string, host: string, port: number): number | null {
  if (!line.includes("LISTENING")) return null
  const parts = line.trim().split(/\s+/)
  if (parts.length < 5 || parts[3] !== "LISTENING") return null

  const local = parts[1]
  const portMatch = local.match(/:(\d+)$/)
  if (!portMatch || Number(portMatch[1]) !== port) return null

  const localHost = local.slice(0, local.lastIndexOf(":"))
  if (!matchesHost(localHost, host)) return null

  const pid = Number(parts[4])
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

function pickFirstPid(pids: number[], port: number): number | null {
  if (pids.length === 0) return null
  if (pids.length > 1) {
    // eslint-disable-next-line no-console
    console.warn(
      `[davstack tui] multiple PIDs listening on :${port}, using first (${pids[0]})`,
    )
  }
  return pids[0]
}

async function findPortOwnerWindows(host: string, port: number): Promise<number | null> {
  try {
    const stdout = await execStdout("netstat -ano -p tcp")
    const pids: number[] = []
    for (const line of stdout.split(/\r?\n/)) {
      const pid = parseNetstatLine(line, host, port)
      if (pid != null) pids.push(pid)
    }
    return pickFirstPid(pids, port)
  } catch {
    return null
  }
}

async function findPortOwnerPosix(port: number): Promise<number | null> {
  try {
    const stdout = await execStdout(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`)
    const pids = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((p) => Number.isFinite(p) && p > 0)
    return pickFirstPid(pids, port)
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      // eslint-disable-next-line no-console
      console.warn("[davstack tui] lsof not found — cannot identify port owner")
    }
    return null
  }
}
