// Smoke tests for the App shell: render <App /> with a fake registry that
// never actually spawns a process, and assert the list view + status bar.

import React from "react"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { test, expect, afterEach } from "vitest"
import { render } from "ink-testing-library"

import { App } from "./App.tsx"
import type { DaemonDescriptor, DaemonKey } from "./lib/daemon-registry.ts"

// ink's useInput is gated on process.stdin.isTTY; stub it true for the
// duration of these tests so simulated keypresses dispatch.
const originalIsTTY = process.stdin.isTTY
function enableTtyForTest(): void {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
}
function restoreTty(): void {
  Object.defineProperty(process.stdin, "isTTY", {
    value: originalIsTTY,
    configurable: true,
  })
}

function makeFakeDescriptor(key: DaemonKey, label: string, port: number): DaemonDescriptor {
  return {
    key,
    label,
    port,
    readyRegex: /listening on http:\/\//i,
    spawn: () => {
      const ee = new EventEmitter() as EventEmitter & {
        stdout: PassThrough
        stderr: PassThrough
        kill: () => boolean
      }
      ee.stdout = new PassThrough()
      ee.stderr = new PassThrough()
      ee.kill = () => true
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ee as any
    },
  }
}

let active: ReturnType<typeof render> | null = null

afterEach(() => {
  active?.unmount()
  active = null
  restoreTty()
})

test("renders title, list view with logs row, and a status bar pill", () => {
  active = render(
    <App
      registry={[makeFakeDescriptor("logs", "logs", 7077)]}
      autoStart={false}
      skipConfigDiscovery
    />,
  )
  const frame = active.lastFrame() ?? ""

  expect(frame).toContain("davstack")
  expect(frame).toContain("Daemons")
  expect(frame).toContain("logs")
  // Idle glyph appears for both the row and the bottom pill (○).
  expect(frame).toMatch(/○/)
})

test("renders three daemon rows + three status pills when all configured", () => {
  active = render(
    <App
      registry={[
        makeFakeDescriptor("logs", "logs", 7077),
        makeFakeDescriptor("vitest", "vitest", 5179),
        makeFakeDescriptor("playwright", "playwright", 5180),
      ]}
      autoStart={false}
      skipConfigDiscovery
    />,
  )
  const frame = active.lastFrame() ?? ""

  expect(frame).toContain("logs")
  expect(frame).toContain("vitest")
  expect(frame).toContain("playwright")
  // Status pills are numbered 1/2/3 in the bottom bar.
  expect(frame).toMatch(/1.*logs/)
  expect(frame).toMatch(/2.*vitest/)
  expect(frame).toMatch(/3.*playwright/)
})

test("pressing `1` from the list view drills into daemon 1's log view", async () => {
  enableTtyForTest()
  active = render(
    <App
      registry={[
        makeFakeDescriptor("logs", "logs", 7077),
        makeFakeDescriptor("vitest", "vitest", 5179),
        makeFakeDescriptor("playwright", "playwright", 5180),
      ]}
      autoStart={false}
      skipConfigDiscovery
    />,
  )
  // Sanity: starting on list view.
  expect(active.lastFrame() ?? "").toContain("Daemons")

  active.stdin.write("1")
  // Let React flush.
  await new Promise((r) => setTimeout(r, 20))

  const frame = active.lastFrame() ?? ""
  // ServerLogView header includes "(<status>) — port <n>"; list view never does.
  expect(frame).toMatch(/port 7077/)
  expect(frame).toContain("esc back")
})

test("pressing `2` from inside daemon 1's log view jumps to daemon 2's logs", async () => {
  enableTtyForTest()
  active = render(
    <App
      registry={[
        makeFakeDescriptor("logs", "logs", 7077),
        makeFakeDescriptor("vitest", "vitest", 5179),
        makeFakeDescriptor("playwright", "playwright", 5180),
      ]}
      autoStart={false}
      skipConfigDiscovery
    />,
  )
  active.stdin.write("1")
  await new Promise((r) => setTimeout(r, 20))
  expect(active.lastFrame() ?? "").toMatch(/port 7077/)

  active.stdin.write("2")
  await new Promise((r) => setTimeout(r, 20))
  expect(active.lastFrame() ?? "").toMatch(/port 5179/)
})
