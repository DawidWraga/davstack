// Verifies killTree shells out to taskkill on Windows and uses
// process.kill on POSIX. We can't actually fork+kill in unit tests
// reliably across platforms, so we mock child_process / process.kill.

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
import { killTree } from "./kill-tree.ts"

const originalPlatform = process.platform

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true })
}

describe("killTree", () => {
  beforeEach(() => {
    vi.mocked(exec).mockClear()
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  test("Windows path shells out to taskkill /T /F /PID", async () => {
    setPlatform("win32")
    await killTree(1234, "SIGTERM")
    expect(exec).toHaveBeenCalledTimes(1)
    const cmd = vi.mocked(exec).mock.calls[0][0]
    expect(cmd).toBe("taskkill /T /F /PID 1234")
  })

  test("Windows ignores SIGKILL/SIGTERM distinction (always /F)", async () => {
    setPlatform("win32")
    await killTree(99, "SIGKILL")
    const cmd = vi.mocked(exec).mock.calls[0][0]
    expect(cmd).toBe("taskkill /T /F /PID 99")
  })

  test("POSIX path calls process.kill with the given signal", async () => {
    setPlatform("linux")
    const spy = vi.spyOn(process, "kill").mockImplementation(() => true)
    await killTree(1234, "SIGTERM")
    expect(spy).toHaveBeenCalledWith(1234, "SIGTERM")
    spy.mockRestore()
  })

  test("POSIX swallows ESRCH (process already gone)", async () => {
    setPlatform("linux")
    const spy = vi.spyOn(process, "kill").mockImplementation(() => {
      throw new Error("ESRCH")
    })
    await expect(killTree(1234, "SIGKILL")).resolves.toBeUndefined()
    spy.mockRestore()
  })
})
