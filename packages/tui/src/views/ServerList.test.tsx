// Focused tests for ServerList's `s` toggle hotkey. The list owns up/down
// + enter + s; everything else flows through App.

import React from "react"
import { afterEach, expect, test, vi } from "vitest"
import { render } from "ink-testing-library"

import { ServerList, type DaemonRow } from "./ServerList.tsx"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

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

function makeRow(key: "logs" | "vitest" | "playwright", status: DaemonRow["status"]): DaemonRow {
  const descriptor: DaemonDescriptor = {
    key,
    label: key,
    port: 1000,
    readyRegex: /listening/i,
    spawn: () => {
      throw new Error("not spawned in this test")
    },
  }
  return { descriptor, status, lines: [], exitCode: null }
}

let active: ReturnType<typeof render> | null = null
afterEach(() => {
  active?.unmount()
  active = null
  restoreTty()
})

test("pressing `s` on a running focused row invokes onToggle with the focused index", async () => {
  enableTtyForTest()
  const onToggle = vi.fn()
  active = render(
    <ServerList
      rows={[makeRow("logs", "running"), makeRow("vitest", "idle")]}
      focusedIdx={0}
      onFocusChange={() => {}}
      onSelect={() => {}}
      onToggle={onToggle}
    />,
  )

  active.stdin.write("s")
  await new Promise((r) => setTimeout(r, 10))

  expect(onToggle).toHaveBeenCalledTimes(1)
  expect(onToggle).toHaveBeenCalledWith(0)
})

test("pressing `s` on an idle focused row also invokes onToggle (toggle covers start too)", async () => {
  enableTtyForTest()
  const onToggle = vi.fn()
  active = render(
    <ServerList
      rows={[makeRow("logs", "running"), makeRow("vitest", "idle")]}
      focusedIdx={1}
      onFocusChange={() => {}}
      onSelect={() => {}}
      onToggle={onToggle}
    />,
  )

  active.stdin.write("s")
  await new Promise((r) => setTimeout(r, 10))

  expect(onToggle).toHaveBeenCalledWith(1)
})

test("legend advertises the new hotkeys", () => {
  active = render(
    <ServerList
      rows={[makeRow("logs", "idle")]}
      focusedIdx={0}
      onFocusChange={() => {}}
      onSelect={() => {}}
      onToggle={() => {}}
    />,
  )
  const frame = active.lastFrame() ?? ""
  expect(frame).toContain("s start/stop")
  expect(frame).toContain("1-9 jump")
})
