// Unit tests for the hotkey dispatcher. We mount the contexts (View +
// Daemons) and a small capture component that grabs the hook's return
// value so tests can call handlers directly. This is the seam where
// keystrokes arrive from <GlobalHotkeys>, so testing here covers the
// production routing without depending on Ink's raw-mode plumbing.

import React from "react"
import { afterEach, expect, test, vi } from "vitest"
import { render } from "ink-testing-library"

import { ViewProvider, useView, type View } from "../state/view-context.tsx"
import { DaemonsProvider, useDaemons, type DaemonRow } from "../state/daemons-context.tsx"
import { QuitProvider, useQuit } from "../state/quit-context.tsx"
import { useHotkeys, type HotkeyHandlers } from "./useHotkeys.ts"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

function makeDescriptor(key: "logs" | "vitest" | "playwright"): DaemonDescriptor {
  return {
    key,
    label: key,
    port: 1000,
    readyRegex: /listening/i,
    spawn: () => {
      throw new Error("not spawned in this test")
    },
  }
}

interface CapturedApis {
  hotkeys: HotkeyHandlers
  view: View
  setFocusedIdx: (n: number) => void
  registerRow: (row: DaemonRow) => void
  registerControls: ReturnType<typeof useDaemons>["registerControls"]
  quitConfirming: boolean
}

function Capture({ onUpdate, onQuit }: {
  onUpdate: (api: CapturedApis) => void
  onQuit: () => void
}): null {
  const hotkeys = useHotkeys(onQuit)
  const v = useView()
  const d = useDaemons()
  const q = useQuit()
  // Publish during render so tests can synchronously read the latest
  // context values + handlers after render(...). Safe here — onUpdate
  // is a setter into a closure, not a React state update.
  onUpdate({
    hotkeys,
    view: v.view,
    setFocusedIdx: v.setFocusedIdx,
    registerRow: d.registerRow,
    registerControls: d.registerControls,
    quitConfirming: q.confirming,
  })
  return null
}

async function tick(): Promise<void> {
  // Let React flush queued setState/effects between assertions.
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function renderWithProviders(descriptors: DaemonDescriptor[], onQuit: () => void) {
  let captured: CapturedApis | null = null
  const r = render(
    <ViewProvider>
      <DaemonsProvider descriptors={descriptors}>
        <QuitProvider>
          <Capture onQuit={onQuit} onUpdate={(api) => (captured = api)} />
        </QuitProvider>
      </DaemonsProvider>
    </ViewProvider>,
  )
  if (!captured) throw new Error("Capture never published")
  return { r, get: (): CapturedApis => captured! }
}

let unmount: (() => void) | null = null
afterEach(() => {
  unmount?.()
  unmount = null
})

test("pressing `1` from list view jumps into daemon 1's log view", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest"), makeDescriptor("playwright")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  // Seed rows so toggleByKey + numberKey see populated rowsRef.
  get().registerRow({ descriptor: descriptors[0], status: "idle", lines: [], exitCode: null })
  get().registerRow({ descriptor: descriptors[1], status: "idle", lines: [], exitCode: null })
  get().registerRow({ descriptor: descriptors[2], status: "idle", lines: [], exitCode: null })
  await tick()

  get().hotkeys.handle("1", {})
  await tick()
  expect(get().view).toEqual({ kind: "log", key: "logs" })
})

test("pressing `2` from inside log view jumps to daemon 2", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest"), makeDescriptor("playwright")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  for (const d of descriptors) {
    get().registerRow({ descriptor: d, status: "idle", lines: [], exitCode: null })
  }
  await tick()

  get().hotkeys.handle("1", {})
  await tick()
  expect(get().view).toEqual({ kind: "log", key: "logs" })

  get().hotkeys.handle("2", {})
  await tick()
  expect(get().view).toEqual({ kind: "log", key: "vitest" })
})

test("escape from log view returns to list view", async () => {
  const descriptors = [makeDescriptor("logs")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  get().registerRow({ descriptor: descriptors[0], status: "idle", lines: [], exitCode: null })
  await tick()
  get().hotkeys.handle("1", {})
  await tick()
  expect(get().view.kind).toBe("log")

  get().hotkeys.handle("", { escape: true })
  await tick()
  expect(get().view.kind).toBe("list")
})

test("escape from list view is a no-op", async () => {
  const descriptors = [makeDescriptor("logs")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  get().registerRow({ descriptor: descriptors[0], status: "idle", lines: [], exitCode: null })
  await tick()
  expect(get().view.kind).toBe("list")
  get().hotkeys.handle("", { escape: true })
  await tick()
  expect(get().view.kind).toBe("list")
})

test("out-of-range number keys are no-ops", async () => {
  const descriptors = [makeDescriptor("logs")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  get().registerRow({ descriptor: descriptors[0], status: "idle", lines: [], exitCode: null })
  await tick()
  get().hotkeys.handle("5", {})
  await tick()
  expect(get().view.kind).toBe("list")
})

test("`q` invokes the quit handler", () => {
  const descriptors = [makeDescriptor("logs")]
  const onQuit = vi.fn()
  const { r, get } = renderWithProviders(descriptors, onQuit)
  unmount = () => r.unmount()

  get().hotkeys.handle("q", {})
  expect(onQuit).toHaveBeenCalledTimes(1)
})

test("ctrl-c also invokes the quit handler", () => {
  const descriptors = [makeDescriptor("logs")]
  const onQuit = vi.fn()
  const { r, get } = renderWithProviders(descriptors, onQuit)
  unmount = () => r.unmount()

  get().hotkeys.handle("c", { ctrl: true })
  expect(onQuit).toHaveBeenCalledTimes(1)
})

test("onToggleFocused calls stop on a running focused daemon", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  const start = vi.fn()
  const stop = vi.fn()
  get().registerControls("logs", { start, stop })
  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  await tick()
  // focusedIdx defaults to 0 -> logs.

  get().hotkeys.onToggleFocused()
  expect(stop).toHaveBeenCalledTimes(1)
  expect(start).not.toHaveBeenCalled()
})

test("onToggleFocused calls start on an idle focused daemon", async () => {
  const descriptors = [makeDescriptor("logs")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  const start = vi.fn()
  const stop = vi.fn()
  get().registerControls("logs", { start, stop })
  get().registerRow({ descriptor: descriptors[0], status: "idle", lines: [], exitCode: null })
  await tick()

  get().hotkeys.onToggleFocused()
  expect(start).toHaveBeenCalledTimes(1)
  expect(stop).not.toHaveBeenCalled()
})

test("`q` with a running daemon enters the confirm-quit state instead of quitting", async () => {
  const descriptors = [makeDescriptor("logs")]
  const onQuit = vi.fn()
  const { r, get } = renderWithProviders(descriptors, onQuit)
  unmount = () => r.unmount()

  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  await tick()

  get().hotkeys.handle("q", {})
  await tick()

  expect(onQuit).not.toHaveBeenCalled()
  expect(get().quitConfirming).toBe(true)
})

test("pressing `y` while confirming triggers cascade shutdown", async () => {
  const descriptors = [makeDescriptor("logs")]
  const onQuit = vi.fn()
  const { r, get } = renderWithProviders(descriptors, onQuit)
  unmount = () => r.unmount()

  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  await tick()

  get().hotkeys.handle("q", {})
  await tick()
  expect(get().quitConfirming).toBe(true)

  get().hotkeys.handle("y", {})
  await tick()
  expect(onQuit).toHaveBeenCalledTimes(1)
  expect(get().quitConfirming).toBe(false)
})

test("pressing `n` while confirming cancels back to the prior view", async () => {
  const descriptors = [makeDescriptor("logs")]
  const onQuit = vi.fn()
  const { r, get } = renderWithProviders(descriptors, onQuit)
  unmount = () => r.unmount()

  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  await tick()

  get().hotkeys.handle("q", {})
  await tick()
  expect(get().quitConfirming).toBe(true)

  get().hotkeys.handle("n", {})
  await tick()
  expect(get().quitConfirming).toBe(false)
  expect(onQuit).not.toHaveBeenCalled()
})

test("pressing `esc` while confirming cancels", async () => {
  const descriptors = [makeDescriptor("logs")]
  const onQuit = vi.fn()
  const { r, get } = renderWithProviders(descriptors, onQuit)
  unmount = () => r.unmount()

  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  await tick()
  get().hotkeys.handle("q", {})
  await tick()

  get().hotkeys.handle("", { escape: true })
  await tick()
  expect(get().quitConfirming).toBe(false)
  expect(onQuit).not.toHaveBeenCalled()
})

test("while confirming, number keys are swallowed", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest")]
  const onQuit = vi.fn()
  const { r, get } = renderWithProviders(descriptors, onQuit)
  unmount = () => r.unmount()

  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  get().registerRow({ descriptor: descriptors[1], status: "idle", lines: [], exitCode: null })
  await tick()
  get().hotkeys.handle("q", {})
  await tick()
  expect(get().quitConfirming).toBe(true)

  // Number key while confirming should NOT navigate.
  get().hotkeys.handle("2", {})
  await tick()
  expect(get().view.kind).toBe("list")
  expect(get().quitConfirming).toBe(true)
})

test("`q` with no running daemons quits immediately (no confirm)", async () => {
  const descriptors = [makeDescriptor("logs")]
  const onQuit = vi.fn()
  const { r, get } = renderWithProviders(descriptors, onQuit)
  unmount = () => r.unmount()

  // All-idle rows.
  get().registerRow({ descriptor: descriptors[0], status: "idle", lines: [], exitCode: null })
  await tick()

  get().hotkeys.handle("q", {})
  await tick()
  expect(onQuit).toHaveBeenCalledTimes(1)
  expect(get().quitConfirming).toBe(false)
})

test("`c` in log view clears the focused daemon's ring buffer", async () => {
  const descriptors = [makeDescriptor("logs")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  const clear = vi.fn()
  get().registerControls("logs", { start: vi.fn(), stop: vi.fn(), clear })
  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  await tick()

  // Drill into log view first.
  get().hotkeys.handle("1", {})
  await tick()
  expect(get().view.kind).toBe("log")

  get().hotkeys.handle("c", {})
  expect(clear).toHaveBeenCalledTimes(1)
})

test("`c` in list view is a no-op (does not clear)", async () => {
  const descriptors = [makeDescriptor("logs")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  const clear = vi.fn()
  get().registerControls("logs", { start: vi.fn(), stop: vi.fn(), clear })
  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  await tick()

  get().hotkeys.handle("c", {})
  expect(clear).not.toHaveBeenCalled()
})

test("`k` on a blocked focused row calls takeover", async () => {
  const descriptors = [makeDescriptor("logs")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  const takeover = vi.fn()
  get().registerControls("logs", { start: vi.fn(), stop: vi.fn(), takeover })
  get().registerRow({ descriptor: descriptors[0], status: "blocked", lines: [], exitCode: null })
  await tick()

  get().hotkeys.handle("k", {})
  expect(takeover).toHaveBeenCalledTimes(1)
})

test("`k` on a running focused row is a no-op", async () => {
  const descriptors = [makeDescriptor("logs")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  const takeover = vi.fn()
  get().registerControls("logs", { start: vi.fn(), stop: vi.fn(), takeover })
  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  await tick()

  get().hotkeys.handle("k", {})
  expect(takeover).not.toHaveBeenCalled()
})

test("left arrow from list-view cycles focus backward and wraps from 0 to last", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest"), makeDescriptor("playwright")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  for (const d of descriptors) {
    get().registerRow({ descriptor: d, status: "idle", lines: [], exitCode: null })
  }
  await tick()
  // focusedIdx starts at 0; left wraps to last (index 2).
  get().hotkeys.handle("", { leftArrow: true })
  await tick()
  // Still in list view; assert via onToggleFocused targeting the focused row.
  expect(get().view.kind).toBe("list")
  const stop = vi.fn()
  get().registerControls("playwright", { start: vi.fn(), stop })
  get().registerRow({ descriptor: descriptors[2], status: "running", lines: [], exitCode: null })
  await tick()
  get().hotkeys.onToggleFocused()
  expect(stop).toHaveBeenCalledTimes(1)
})

test("right arrow from list-view cycles focus forward and wraps from last to 0", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest"), makeDescriptor("playwright")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  for (const d of descriptors) {
    get().registerRow({ descriptor: d, status: "idle", lines: [], exitCode: null })
  }
  await tick()
  // Advance focus to the last (index 2): two right presses.
  get().hotkeys.handle("", { rightArrow: true })
  await tick()
  get().hotkeys.handle("", { rightArrow: true })
  await tick()
  // One more right wraps back to index 0.
  get().hotkeys.handle("", { rightArrow: true })
  await tick()
  expect(get().view.kind).toBe("list")
  const stop = vi.fn()
  get().registerControls("logs", { start: vi.fn(), stop })
  get().registerRow({ descriptor: descriptors[0], status: "running", lines: [], exitCode: null })
  await tick()
  get().hotkeys.onToggleFocused()
  expect(stop).toHaveBeenCalledTimes(1)
})

test("left arrow from log-view cycles the focused log target backward", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest"), makeDescriptor("playwright")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  for (const d of descriptors) {
    get().registerRow({ descriptor: d, status: "idle", lines: [], exitCode: null })
  }
  await tick()
  // Drill into log view on daemon 2 (index 1).
  get().hotkeys.handle("2", {})
  await tick()
  expect(get().view).toEqual({ kind: "log", key: "vitest" })

  get().hotkeys.handle("", { leftArrow: true })
  await tick()
  expect(get().view).toEqual({ kind: "log", key: "logs" })
})

test("right arrow from log-view cycles the focused log target forward", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest"), makeDescriptor("playwright")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  for (const d of descriptors) {
    get().registerRow({ descriptor: d, status: "idle", lines: [], exitCode: null })
  }
  await tick()
  get().hotkeys.handle("1", {})
  await tick()
  expect(get().view).toEqual({ kind: "log", key: "logs" })

  get().hotkeys.handle("", { rightArrow: true })
  await tick()
  expect(get().view).toEqual({ kind: "log", key: "vitest" })
})

test("tab from list-view cycles focus forward like right arrow", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest"), makeDescriptor("playwright")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  for (const d of descriptors) {
    get().registerRow({ descriptor: d, status: "idle", lines: [], exitCode: null })
  }
  await tick()
  // From focusedIdx 0, one tab -> idx 1 (vitest).
  get().hotkeys.handle("", { tab: true })
  await tick()
  expect(get().view.kind).toBe("list")
  const stop = vi.fn()
  get().registerControls("vitest", { start: vi.fn(), stop })
  get().registerRow({ descriptor: descriptors[1], status: "running", lines: [], exitCode: null })
  await tick()
  get().hotkeys.onToggleFocused()
  expect(stop).toHaveBeenCalledTimes(1)
})

test("shift+tab from list-view cycles focus backward like left arrow", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest"), makeDescriptor("playwright")]
  const { r, get } = renderWithProviders(descriptors, () => {})
  unmount = () => r.unmount()

  for (const d of descriptors) {
    get().registerRow({ descriptor: d, status: "idle", lines: [], exitCode: null })
  }
  await tick()
  // From focusedIdx 0, shift+tab wraps backward -> idx 2 (playwright).
  get().hotkeys.handle("", { tab: true, shift: true })
  await tick()
  expect(get().view.kind).toBe("list")
  const stop = vi.fn()
  get().registerControls("playwright", { start: vi.fn(), stop })
  get().registerRow({ descriptor: descriptors[2], status: "running", lines: [], exitCode: null })
  await tick()
  get().hotkeys.onToggleFocused()
  expect(stop).toHaveBeenCalledTimes(1)
})
