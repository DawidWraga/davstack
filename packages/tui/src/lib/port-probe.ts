// Single-shot TCP probe — does anything answer on <host>:<port>?
// Returns true if a connection succeeds (then immediately destroys the
// socket), false on ECONNREFUSED or timeout. Used as a preflight before
// spawning a daemon so we can surface "blocked by external process"
// instead of letting the daemon crash with EADDRINUSE.

import net from "node:net"

export async function probePort(
  host: string,
  port: number,
  timeoutMs: number = 250,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const sock = new net.Socket()
    let settled = false
    const finish = (open: boolean): void => {
      if (settled) return
      settled = true
      sock.destroy()
      resolve(open)
    }
    sock.setTimeout(timeoutMs)
    sock.once("connect", () => finish(true))
    sock.once("timeout", () => finish(false))
    sock.once("error", () => finish(false))
    sock.connect(port, host)
  })
}
