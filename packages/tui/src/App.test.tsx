// Smoke test for the P1 shell: render <App />, assert the title and all
// three daemon pills appear. ink-testing-library renders to a string; we
// just check substrings rather than parsing structure.

import React from "react"
import { test, expect, afterEach } from "vitest"
import { render } from "ink-testing-library"

import { App } from "./App.tsx"

let active: ReturnType<typeof render> | null = null

afterEach(() => {
  active?.unmount()
  active = null
})

test("renders title, placeholder body, and three daemon pills", () => {
  active = render(<App />)
  const frame = active.lastFrame() ?? ""

  expect(frame).toContain("davstack")
  expect(frame).toContain("Hello TUI")
  expect(frame).toContain("1 vitest")
  expect(frame).toContain("2 playwright")
  expect(frame).toContain("3 logs")
  // Not-running glyph for each pill.
  expect(frame.match(/○/g)?.length).toBe(3)
})
