// Smoke test for the App shell: render <App /> with a fake registry that
// never actually spawns a process, and assert the list view shows the
// logs daemon row.

import React from "react"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { test, expect, afterEach } from "vitest"
import { render } from "ink-testing-library"

import { App } from "./App.tsx"
import type { DaemonDescriptor } from "./lib/daemon-registry.ts"

function makeFakeDescriptor(): DaemonDescriptor {
  return {
    key: "logs",
    label: "logs",
    port: 7077,
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
  active = render(<App registry={[makeFakeDescriptor()]} autoStart={false} />)
  const frame = active.lastFrame() ?? ""

  expect(frame).toContain("davstack")
  expect(frame).toContain("Daemons")
  expect(frame).toContain("logs")
  // Idle glyph appears for both the row and the bottom pill (○).
  expect(frame).toMatch(/○/)
})
