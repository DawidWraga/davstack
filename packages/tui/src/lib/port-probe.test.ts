// 3 cases: open port (real listener), refused (unbound port), timeout.

import net from "node:net"
import { describe, expect, test } from "vitest"

import { probePort } from "./port-probe.ts"

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.on("error", reject)
    srv.listen(port, "127.0.0.1", () => resolve(srv))
  })
}

function close(srv: net.Server): Promise<void> {
  return new Promise((resolve) => srv.close(() => resolve()))
}

describe("probePort", () => {
  test("returns true when a listener is bound", async () => {
    const srv = await listenOn(0)
    const addr = srv.address() as net.AddressInfo
    const open = await probePort("127.0.0.1", addr.port, 500)
    expect(open).toBe(true)
    await close(srv)
  })

  test("returns false on ECONNREFUSED (no listener)", async () => {
    // Pick a high port unlikely to be bound. 1 is reserved, never bound.
    const open = await probePort("127.0.0.1", 1, 500)
    expect(open).toBe(false)
  })

  test("returns false on timeout (route to TEST-NET-1)", async () => {
    // 192.0.2.0/24 is RFC-5737 TEST-NET-1, guaranteed not routable.
    // With a 50ms timeout we should never connect.
    const open = await probePort("192.0.2.1", 9, 50)
    expect(open).toBe(false)
  })
})
