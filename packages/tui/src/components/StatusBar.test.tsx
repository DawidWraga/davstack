// StatusBar rendering: focused pill carries `inverse` + `bold`, others
// don't. We assert on Ink's ANSI output for `inverse` since ink-testing-
// library renders styled output.

import React from "react"
import { afterEach, expect, test } from "vitest"
import { render } from "ink-testing-library"

import { StatusBar, type DaemonPill } from "./StatusBar.tsx"

const PILLS: DaemonPill[] = [
  { key: "1", daemonKey: "logs", label: "logs", status: "running" },
  { key: "2", daemonKey: "vitest", label: "vitest", status: "not-running" },
  { key: "3", daemonKey: "playwright", label: "playwright", status: "not-running" },
]

let active: ReturnType<typeof render> | null = null
afterEach(() => {
  active?.unmount()
  active = null
})

// ANSI escape for `inverse` is CSI 7 m; restored with CSI 27 m. We look for
// the focused label between those markers.
const INVERSE_ON = "[7m"

test("renders all pills with labels and number keys", () => {
  active = render(<StatusBar daemons={PILLS} />)
  const frame = active.lastFrame() ?? ""
  expect(frame).toContain("1 logs")
  expect(frame).toContain("2 vitest")
  expect(frame).toContain("3 playwright")
})

test("focused pill is rendered with `inverse` styling", () => {
  active = render(<StatusBar daemons={PILLS} focusedKey="vitest" />)
  const frame = active.lastFrame() ?? ""

  // The vitest pill must appear inside an inverse-on segment.
  expect(frame).toContain(INVERSE_ON)
  const inverseIdx = frame.indexOf(INVERSE_ON)
  // The label after the inverse-on marker (within a small window) should
  // be the focused pill's label.
  const window = frame.slice(inverseIdx, inverseIdx + 50)
  expect(window).toContain("vitest")
  expect(window).not.toContain("logs ")
})

test("no inverse styling when focusedKey is undefined", () => {
  active = render(<StatusBar daemons={PILLS} />)
  const frame = active.lastFrame() ?? ""
  expect(frame).not.toContain(INVERSE_ON)
})
