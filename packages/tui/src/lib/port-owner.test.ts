// Mock child_process.exec for netstat / lsof shell-outs. Assert parse for:
// zero matches → null, single match → that PID, multiple matches → first PID.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("node:child_process", () => {
  return {
    exec: vi.fn(
      (
        _cmd: string,
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        cb(null, "", "")
      },
    ),
  }
})

import { exec } from "node:child_process"
import { findPortOwner } from "./port-owner.ts"

const originalPlatform = process.platform

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true })
}

function mockExecStdout(stdout: string): void {
  vi.mocked(exec).mockImplementation(
    (_cmd, cb) => {
      ;(cb as (err: null, stdout: string, stderr: string) => void)(null, stdout, "")
      return undefined as never
    },
  )
}

describe("findPortOwner", () => {
  beforeEach(() => {
    vi.mocked(exec).mockClear()
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  test("Windows: zero netstat matches → null", async () => {
    setPlatform("win32")
    mockExecStdout("  TCP    127.0.0.1:8080    0.0.0.0:0    LISTENING    999\n")
    expect(await findPortOwner("127.0.0.1", 7077)).toBeNull()
  })

  test("Windows: single LISTENING match → that PID", async () => {
    setPlatform("win32")
    mockExecStdout(
      "  TCP    127.0.0.1:7077         0.0.0.0:0              LISTENING       4242\n",
    )
    expect(await findPortOwner("127.0.0.1", 7077)).toBe(4242)
  })

  test("Windows: 0.0.0.0 bind matches 127.0.0.1 host", async () => {
    setPlatform("win32")
    mockExecStdout(
      "  TCP    0.0.0.0:7077           0.0.0.0:0              LISTENING       5555\n",
    )
    expect(await findPortOwner("127.0.0.1", 7077)).toBe(5555)
  })

  test("Windows: multiple matches → first PID", async () => {
    setPlatform("win32")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockExecStdout(
      [
        "  TCP    127.0.0.1:7077         0.0.0.0:0              LISTENING       1111",
        "  TCP    0.0.0.0:7077           0.0.0.0:0              LISTENING       2222",
      ].join("\n"),
    )
    expect(await findPortOwner("127.0.0.1", 7077)).toBe(1111)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test("POSIX: single lsof match → that PID", async () => {
    setPlatform("linux")
    mockExecStdout("4242\n")
    const pid = await findPortOwner("127.0.0.1", 7077)
    const cmd = vi.mocked(exec).mock.calls[0][0]
    expect(cmd).toBe("lsof -nP -iTCP:7077 -sTCP:LISTEN -t")
    expect(pid).toBe(4242)
  })

  test("POSIX: empty lsof output → null", async () => {
    setPlatform("linux")
    mockExecStdout("")
    expect(await findPortOwner("127.0.0.1", 7077)).toBeNull()
  })

  test("POSIX: multiple PIDs → first", async () => {
    setPlatform("linux")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    mockExecStdout("1111\n2222\n")
    expect(await findPortOwner("127.0.0.1", 7077)).toBe(1111)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
