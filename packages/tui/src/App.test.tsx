// Shell-level smoke tests for the App composition. Navigation hotkey
// behaviour is covered as a unit in `hooks/useHotkeys.test.tsx` — those
// tests render the providers without App and drive the dispatcher
// directly, sidestepping ink's raw-mode plumbing which
// ink-testing-library doesn't simulate.

import React from "react"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { test, expect, afterEach } from "vitest"
import { render } from "ink-testing-library"

import { App } from "./App.tsx"
import type { DaemonDescriptor, DaemonKey } from "./lib/daemon-registry.ts"

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

test("renders the empty state with version + init command when no daemons configured", () => {
  active = render(<App registry={[]} autoStart={false} skipConfigDiscovery />)
  const frame = active.lastFrame() ?? ""

  expect(frame).toContain("davstack TUI v")
  expect(frame).toContain("No davstack configs found")
  expect(frame).toContain("pnpm dlx @davstack/init")
  expect(frame).toContain("Press q to quit")
})

test("renders two daemon rows + two status pills when all configured", () => {
  active = render(
    <App
      registry={[
        makeFakeDescriptor("logs", "logs", 7077),
        makeFakeDescriptor("vitest", "vitest", 5179),
      ]}
      autoStart={false}
      skipConfigDiscovery
    />,
  )
  const frame = active.lastFrame() ?? ""

  expect(frame).toContain("logs")
  expect(frame).toContain("vitest")
  // Status pills are numbered 1/2 in the bottom bar.
  expect(frame).toMatch(/1.*logs/)
  expect(frame).toMatch(/2.*vitest/)
})
