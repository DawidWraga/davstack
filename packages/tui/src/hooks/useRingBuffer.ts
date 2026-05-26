// React hook wrapping a RingBuffer<LogLine> behind a re-render counter.
//
// We deliberately do NOT keep lines in React state — that would force a
// copy on every push, which gets expensive for chatty daemons. Instead we
// keep a stable ref, tick a counter on push, and snapshot `toArray()` on
// each render.

import { useCallback, useRef, useState } from "react"

import { RingBuffer } from "../lib/ring-buffer.ts"

export type LogLine = {
  ts: number
  stream: "out" | "err"
  text: string
}

export type UseRingBufferResult = {
  lines: LogLine[]
  push: (line: LogLine) => void
  clear: () => void
}

export function useRingBuffer(capacity: number = 10_000): UseRingBufferResult {
  const bufRef = useRef<RingBuffer<LogLine> | null>(null)
  if (bufRef.current === null) bufRef.current = new RingBuffer<LogLine>(capacity)
  const [, setTick] = useState(0)

  const push = useCallback((line: LogLine) => {
    bufRef.current!.push(line)
    setTick((t) => (t + 1) | 0)
  }, [])

  const clear = useCallback(() => {
    bufRef.current!.clear()
    setTick((t) => (t + 1) | 0)
  }, [])

  return { lines: bufRef.current.toArray(), push, clear }
}
