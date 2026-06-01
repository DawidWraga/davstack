// Pure rendering check for StatusBar pills + a unit test on isPillFocused.
// ink-testing-library strips ANSI in debug mode so we can't assert on
// inverse escapes via the rendered frame; the focus-prop wiring is
// exercised via the extracted helper instead.

import React from "react"
import { afterEach, expect, test } from "vitest"
import { render } from "ink-testing-library"

import { StatusBar, isPillFocused, type DaemonPill } from "./StatusBar.tsx"

const PILLS: DaemonPill[] = [
  { key: "1", daemonKey: "logs", label: "logs", status: "running" },
  { key: "2", daemonKey: "vitest", label: "vitest", status: "not-running" },
]

let active: ReturnType<typeof render> | null = null
afterEach(() => {
  active?.unmount()
  active = null
})

test("renders all pills with labels and number keys", () => {
  active = render(<StatusBar daemons={PILLS} />)
  const frame = active.lastFrame() ?? ""
  expect(frame).toContain("1 logs")
  expect(frame).toContain("2 vitest")
})

test("status glyphs reflect each pill's status", () => {
  active = render(<StatusBar daemons={PILLS} />)
  const frame = active.lastFrame() ?? ""
  // running -> ●, not-running -> ○
  expect(frame).toContain("●")
  expect(frame).toContain("○")
})

test("isPillFocused returns true only for the matching daemonKey", () => {
  const logs = PILLS[0]
  const vitest = PILLS[1]
  expect(isPillFocused(logs, undefined)).toBe(false)
  expect(isPillFocused(logs, "logs")).toBe(true)
  expect(isPillFocused(logs, "vitest")).toBe(false)
  expect(isPillFocused(vitest, "vitest")).toBe(true)
})
