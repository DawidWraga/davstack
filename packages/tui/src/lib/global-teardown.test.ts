// Register a fake PID, assert it shows up in the snapshot, install
// handlers, fire an uncaughtException, assert taskkill/process.kill was
// invoked. We mock child_process.exec so no real taskkill runs.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("node:child_process", () => {
  return { exec: vi.fn() }
})

import { exec } from "node:child_process"
import {
  _resetForTests,
  _supervisedSnapshot,
  installGlobalTeardown,
  registerChild,
  unregisterChild,
} from "./global-teardown.ts"

const originalPlatform = process.platform

function setPlatform(p: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", { value: p, configurable: true })
}

describe("global-teardown", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    _resetForTests()
    vi.mocked(exec).mockClear()
    // Stub process.exit so the test doesn't actually terminate.
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((_c?: number) => {
      return undefined as never
    }) as never)
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    setPlatform(originalPlatform)
    process.removeAllListeners("uncaughtException")
    process.removeAllListeners("unhandledRejection")
    exitSpy.mockRestore()
    consoleErrorSpy.mockRestore()
    _resetForTests()
  })

  test("register/unregister manages the supervised set", () => {
    registerChild(111)
    registerChild(222)
    expect(_supervisedSnapshot().sort()).toEqual([111, 222])
    unregisterChild(111)
    expect(_supervisedSnapshot()).toEqual([222])
  })

  test("uncaughtException handler kills registered children on Windows", () => {
    setPlatform("win32")
    registerChild(4242)
    installGlobalTeardown()
    process.emit("uncaughtException", new Error("boom"))
    expect(exec).toHaveBeenCalledWith("taskkill /T /F /PID 4242")
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  test("uncaughtException handler uses process.kill on POSIX", () => {
    setPlatform("linux")
    registerChild(7777)
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true)
    installGlobalTeardown()
    process.emit("uncaughtException", new Error("boom"))
    expect(killSpy).toHaveBeenCalledWith(7777, "SIGKILL")
    killSpy.mockRestore()
  })
})
