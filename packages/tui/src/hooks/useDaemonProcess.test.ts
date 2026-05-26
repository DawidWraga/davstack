// Unit tests for useDaemonProcess via ink-testing-library: a small probe
// component exposes the hook's return value to the test through a ref-like
// callback so we can assert state transitions without a DOM dependency.

import React from "react"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { render } from "ink-testing-library"
import { Text } from "ink"

import { useDaemonProcess, type UseDaemonProcessResult } from "./useDaemonProcess.ts"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

type FakeChild = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  kill: (sig?: string) => boolean
  killCalls: string[]
}

function makeFakeChild(): FakeChild {
  const ee = new EventEmitter() as FakeChild
  ee.stdout = new PassThrough()
  ee.stderr = new PassThrough()
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

// Probe component: passes the hook result back through `onRender` each render.
function Probe({
  descriptor,
  onRender,
}: {
  descriptor: DaemonDescriptor
  onRender: (r: UseDaemonProcessResult) => void
}): React.ReactElement {
  const r = useDaemonProcess(descriptor)
  onRender(r)
  return React.createElement(Text, null, r.status)
}

// Flush microtasks so React commits the state update.
async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
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

  function mount(desc: DaemonDescriptor) {
    active = render(
      React.createElement(Probe, {
        descriptor: desc,
        onRender: (r) => {
          captured = r
        },
      }),
    )
  }

  test("idle -> starting -> running on ready line", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    mount(desc)

    expect(captured!.status).toBe("idle")

    captured!.start()
    await tick()
    expect(captured!.status).toBe("starting")

    child.stdout.write("booting...\n")
    await tick()
    expect(captured!.status).toBe("starting")

    child.stdout.write("log-server listening on http://127.0.0.1:7077  db=x\n")
    await tick()
    expect(captured!.status).toBe("running")
    expect(captured!.lines.some((l) => l.text.includes("listening on http"))).toBe(true)
  })

  test("crashes on non-zero exit", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    mount(desc)

    captured!.start()
    await tick()

    child.emit("exit", 1, null)
    await tick()

    expect(captured!.status).toBe("crashed")
    expect(captured!.exitCode).toBe(1)
  })

  test("stop() sends SIGTERM, escalates to SIGKILL after 2s", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    mount(desc)

    captured!.start()
    await tick()
    child.stdout.write("listening on http://x\n")
    await tick()
    expect(captured!.status).toBe("running")

    captured!.stop()
    await tick()
    expect(captured!.status).toBe("exiting")
    expect(child.killCalls).toEqual(["SIGTERM"])

    vi.advanceTimersByTime(2_001)
    expect(child.killCalls).toEqual(["SIGTERM", "SIGKILL"])

    child.emit("exit", null, "SIGKILL")
    await tick()
    expect(captured!.status).toBe("exited")
  })

  test("stop() is idempotent", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    mount(desc)

    captured!.start()
    await tick()
    captured!.stop()
    captured!.stop()
    await tick()
    expect(child.killCalls).toEqual(["SIGTERM"])
  })

  test("captures stdout and stderr into lines", async () => {
    const child = makeFakeChild()
    const desc = makeDescriptor(child)
    mount(desc)

    captured!.start()
    await tick()
    child.stdout.write("hello\nworld\n")
    child.stderr.write("warning!\n")
    await tick()

    const texts = captured!.lines.map((l) => `${l.stream}:${l.text}`)
    expect(texts).toContain("out:hello")
    expect(texts).toContain("out:world")
    expect(texts).toContain("err:warning!")
  })
})
