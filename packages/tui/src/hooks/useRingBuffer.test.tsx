// Hook test for useRingBuffer via ink-testing-library probe. Asserts that
// `push` triggers a re-render carrying the new lines, and `clear` resets.

import React from "react"
import { afterEach, expect, test } from "vitest"
import { render } from "ink-testing-library"
import { Text } from "ink"

import { useRingBuffer, type UseRingBufferResult } from "./useRingBuffer.ts"

function Probe({
  onRender,
}: {
  onRender: (r: UseRingBufferResult) => void
}): React.ReactElement {
  const r = useRingBuffer(3)
  onRender(r)
  return React.createElement(Text, null, `n=${r.lines.length}`)
}

let active: ReturnType<typeof render> | null = null
afterEach(() => {
  active?.unmount()
  active = null
})

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

test("push triggers re-render with new lines; clear resets", async () => {
  let captured: UseRingBufferResult | null = null
  active = render(
    React.createElement(Probe, {
      onRender: (r) => {
        captured = r
      },
    }),
  )

  expect(captured!.lines).toEqual([])

  captured!.push({ ts: 1, stream: "out", text: "a" })
  await tick()
  captured!.push({ ts: 2, stream: "out", text: "b" })
  await tick()
  expect(captured!.lines.map((l) => l.text)).toEqual(["a", "b"])

  // Wrap.
  captured!.push({ ts: 3, stream: "out", text: "c" })
  captured!.push({ ts: 4, stream: "err", text: "d" })
  await tick()
  expect(captured!.lines.map((l) => l.text)).toEqual(["b", "c", "d"])

  captured!.clear()
  await tick()
  expect(captured!.lines).toEqual([])
})

test("lines array reference is stable across renders unless push/clear fires", async () => {
  // Regression: without memoization, toArray() allocates a fresh array
  // every render. Consumers that include `lines` in effect deps
  // (DaemonSupervisor) then loop forever, even when contents are
  // identical. Lines MUST share a reference between renders that didn't
  // mutate the buffer.
  const seenLines: LogLine[][] = []
  const Spy = (): React.ReactElement => {
    const r = useRingBuffer(3)
    seenLines.push(r.lines)
    return React.createElement(Text, null, " ")
  }

  active = render(React.createElement(Spy))
  const initial = seenLines[0]
  active.rerender(React.createElement(Spy))
  active.rerender(React.createElement(Spy))
  active.rerender(React.createElement(Spy))

  expect(seenLines.length).toBeGreaterThanOrEqual(4)
  for (const snap of seenLines) {
    expect(snap).toBe(initial)
  }
})

// Local type import for the regression test.
type LogLine = { ts: number; stream: "out" | "err"; text: string }
