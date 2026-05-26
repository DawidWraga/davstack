// Unit tests for useDaemonProcess via ink-testing-library: a small probe
// component exposes the hook's return value to the test through a ref-like
// callback so we can assert state transitions without a DOM dependency.

import React from "react"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { render } from "ink-testing-library"
import { Text } from "ink"

import {
  useDaemonProcess,
  type UseDaemonProcessDeps,
  type UseDaemonProcessResult,
} from "./useDaemonProcess.ts"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

type FakeChild = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  pid: number
  kill: (sig?: string) => boolean
  killCalls: string[]
}

let nextPid = 10000
function makeFakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild
  ee.stdout = new PassThrough()
  ee.stderr = new PassThrough()
  ee.pid = nextPid++
  ee.killCalls = []
  ee.kill = (sig?: string) => {
    ee.killCalls.push(sig ?? "SIGTERM")
    return true
  }
  return ee
}

function makeDescriptor(child: FakeChild): DaemonDescriptor {
  return {
    key: "logs",
    label: "logs",
    port: 0,
    readyRegex: /listening on http:\/\//i,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    spawn: () => child as any,
  }
}

function makeDeps(overrides: Partial<UseDaemonProcessDeps> = {}): {
  deps: UseDaemonProcessDeps
  killTreeCalls: Array<{ pid: number; signal: string }>
  probeReturns: { value: boolean }
} {
  const killTreeCalls: Array<{ pid: number; signal: string }> = []
  const probeReturns = { value: false }
  const deps: UseDaemonProcessDeps = {
    killTree: async (pid, signal) => {
      killTreeCalls.push({ pid, signal })
    },
    probePort: async () => probeReturns.value,
    registerChild: () => {},
    unregisterChild: () => {},
    ...overrides,
  }
  return { deps, killTreeCalls, probeReturns }
}

// Probe component: passes the hook result back through `onRender` each render.
function Probe({
  descriptor,
  deps,
  onRender,
}: {
  descriptor: DaemonDescriptor
  deps: UseDaemonProcessDeps
  onRender: (r: UseDaemonProcessResult) => void
}): React.ReactElement {
  const r = useDaemonProcess(descriptor, deps)
  onRender(r)
  return React.createElement(Text, null, r.status)
}

// Flush microtasks so React commits the state update.
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

// Two ticks — probePort resolves in a microtask, then doSpawn fires and
// state settles in a second commit.
async function tick2(): Promise<void> {
  await tick()
  await tick()
}

describe("useDaemonProcess", () => {
  let captured: UseDaemonProcessResult | null = null
  let active: ReturnType<typeof render> | null = null

  beforeEach(() => {
    captured = null
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    active?.unmount()
    active = null
    vi.useRealTimers()
  })

  function mount(desc: DaemonDescriptor, deps: UseDaemonProcessDeps) {
    active = render(
      React.createElement(Probe, {
        descriptor: desc,
        deps,
        onRender: (r) => {
          captured = r
        },
      }),
    )
  }

  test("idle -> starting -> running on ready line", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    const { deps } = makeDeps()
    mount(desc, deps)

    expect(captured!.status).toBe("idle")

    captured!.start()
    await tick()
    expect(captured!.status).toBe("starting")
    await tick2()

    child.stdout.write("booting...\n")
    await tick()
    expect(captured!.status).toBe("starting")

    child.stdout.write("log-server listening on http://127.0.0.1:7077  db=x\n")
    await tick()
    expect(captured!.status).toBe("running")
    expect(captured!.lines.some((l) => l.text.includes("listening on http"))).toBe(true)
  })

  test("crashes on non-zero exit, captures exit code in state", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    const { deps } = makeDeps()
    mount(desc, deps)

    captured!.start()
    await tick2()

    child.emit("exit", 1, null)
    await tick()

    expect(captured!.status).toBe("crashed")
    expect(captured!.exitCode).toBe(1)
  })

  test("stop() sends SIGTERM via killTree, escalates to SIGKILL after 2s", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    const { deps, killTreeCalls } = makeDeps()
    mount(desc, deps)

    captured!.start()
    await tick2()
    child.stdout.write("listening on http://x\n")
    await tick()
    expect(captured!.status).toBe("running")

    captured!.stop()
    await tick()
    expect(captured!.status).toBe("exiting")
    expect(killTreeCalls.map((c) => c.signal)).toEqual(["SIGTERM"])
    expect(killTreeCalls[0].pid).toBe(child.pid)

    vi.advanceTimersByTime(2_001)
    expect(killTreeCalls.map((c) => c.signal)).toEqual(["SIGTERM", "SIGKILL"])

    child.emit("exit", null, "SIGKILL")
    await tick()
    expect(captured!.status).toBe("exited")
  })

  test("stop() is idempotent", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    const { deps, killTreeCalls } = makeDeps()
    mount(desc, deps)

    captured!.start()
    await tick2()
    captured!.stop()
    captured!.stop()
    await tick()
    expect(killTreeCalls.length).toBe(1)
  })

  test("captures stdout and stderr into lines", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    const { deps } = makeDeps()
    mount(desc, deps)

    captured!.start()
    await tick2()
    child.stdout.write("hello\nworld\n")
    child.stderr.write("warning!\n")
    await tick()

    const texts = captured!.lines.map((l) => `${l.stream}:${l.text}`)
    expect(texts).toContain("out:hello")
    expect(texts).toContain("out:world")
    expect(texts).toContain("err:warning!")
  })

  test("port-probe returning true sets status=blocked and skips spawn", async () => {
    const child = makeFakeChild()
    const spawnSpy = vi.fn(() => child as never)
    const desc: DaemonDescriptor = {
      key: "logs",
      label: "logs",
      port: 7077,
      readyRegex: /listening on http:\/\//i,
      spawn: spawnSpy,
    }
    const { deps, probeReturns } = makeDeps()
    probeReturns.value = true
    mount(desc, deps)

    captured!.start()
    await tick2()
    expect(captured!.status).toBe("blocked")
    expect(spawnSpy).not.toHaveBeenCalled()
    expect(
      captured!.lines.some((l) => /port 7077 already in use/.test(l.text)),
    ).toBe(true)
  })

  test("takeover() kills external port owner, polls port free, then re-spawns", async () => {
    const child = makeFakeChild()
    const spawnSpy = vi.fn(() => child as never)
    const desc: DaemonDescriptor = {
      key: "logs",
      label: "logs",
      port: 7077,
      readyRegex: /listening on http:\/\//i,
      spawn: spawnSpy,
    }
    let probeCall = 0
    const { deps, killTreeCalls } = makeDeps({
      probePort: async () => {
        probeCall++
        // start preflight → blocked; takeover poll → still busy, then free; start preflight → ok
        return probeCall === 1 || probeCall === 2
      },
      findPortOwner: async () => 9999,
      isSupervisedChild: () => false,
    })
    mount(desc, deps)

    captured!.start()
    await tick2()
    expect(captured!.status).toBe("blocked")
    expect(spawnSpy).not.toHaveBeenCalled()

    captured!.takeover()
    await tick()
    await tick()
    vi.advanceTimersByTime(250)
    await tick()
    await tick2()

    expect(killTreeCalls).toEqual([{ pid: 9999, signal: "SIGKILL" }])
    expect(spawnSpy).toHaveBeenCalledTimes(1)
    expect(captured!.lines.some((l) => /taking over :7077 from PID 9999/.test(l.text))).toBe(true)

    child.stdout.write("log-server listening on http://127.0.0.1:7077\n")
    await tick()
    expect(captured!.status).toBe("running")
  })

  test("Windows path routes kill through killTree (no child.kill)", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    const { deps, killTreeCalls } = makeDeps()
    mount(desc, deps)

    captured!.start()
    await tick2()
    child.stdout.write("listening on http://x\n")
    await tick()
    captured!.stop()
    await tick()
    // We never call child.kill directly anymore — killTree owns it.
    expect(child.killCalls).toEqual([])
    expect(killTreeCalls[0]).toEqual({ pid: child.pid, signal: "SIGTERM" })
  })

  test("graceful /shutdown: POST succeeds + child exits within timeout, no killTree", async () => {
    const child = makeFakeChild()
    const desc: DaemonDescriptor = {
      key: "vitest",
      label: "vitest",
      port: 0,
      readyRegex: /listening on http:\/\//i,
      shutdownUrl: "http://127.0.0.1:5179/shutdown",
      shutdownTimeoutMs: 500,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spawn: () => child as any,
    }
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = []
    const fakeFetch = (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init })
      return Promise.resolve(new Response("ok", { status: 200 }))
    }
    const { deps, killTreeCalls } = makeDeps({ fetch: fakeFetch as typeof fetch })
    mount(desc, deps)

    captured!.start()
    await tick2()
    child.stdout.write("listening on http://x\n")
    await tick()
    expect(captured!.status).toBe("running")

    captured!.stop()
    await tick()
    expect(captured!.status).toBe("exiting")

    // Let the fetch microtask settle (it's a resolved Promise).
    await tick()
    await tick()
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toBe("http://127.0.0.1:5179/shutdown")
    expect(fetchCalls[0].init?.method).toBe("POST")

    // Child exits cleanly before the escalation timer fires.
    child.emit("exit", 0, null)
    await tick()
    expect(captured!.status).toBe("exited")
    expect(killTreeCalls).toHaveLength(0)
  })

  test("graceful /shutdown: fetch rejects → falls back to killTree", async () => {
    const child = makeFakeChild()
    const desc: DaemonDescriptor = {
      key: "vitest",
      label: "vitest",
      port: 0,
      readyRegex: /listening on http:\/\//i,
      shutdownUrl: "http://127.0.0.1:5179/shutdown",
      shutdownTimeoutMs: 500,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      spawn: () => child as any,
    }
    const fakeFetch = () => Promise.reject(new Error("ECONNREFUSED"))
    const { deps, killTreeCalls } = makeDeps({ fetch: fakeFetch as typeof fetch })
    mount(desc, deps)

    captured!.start()
    await tick2()
    child.stdout.write("listening on http://x\n")
    await tick()

    captured!.stop()
    await tick()
    // Fetch rejection microtask flush.
    await tick()
    await tick()

    // Now advance past the shutdownTimeoutMs to trigger escalate().
    vi.advanceTimersByTime(501)
    await tick()

    expect(killTreeCalls.map((c) => c.signal)).toEqual(["SIGTERM"])
    expect(killTreeCalls[0].pid).toBe(child.pid)

    // Confirm the error line landed in the ring buffer.
    expect(
      captured!.lines.some((l) => /\/shutdown.*ECONNREFUSED/i.test(l.text)),
    ).toBe(true)
  })

  test("POSIX path: real killTree invokes process.kill", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    // Don't override killTree — use the real one via the default import path.
    const { deps } = makeDeps()
    delete (deps as Partial<UseDaemonProcessDeps>).killTree
    // Force the POSIX branch.
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: "linux", configurable: true })
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true)
    try {
      mount(desc, deps)
      captured!.start()
      await tick2()
      child.stdout.write("listening on http://x\n")
      await tick()
      captured!.stop()
      await tick()
      // killTree runs via microtask — wait for it.
      await tick()
      expect(killSpy).toHaveBeenCalledWith(child.pid, "SIGTERM")
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true })
      killSpy.mockRestore()
    }
  })
})
