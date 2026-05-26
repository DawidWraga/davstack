import fs from "node:fs"
import { useEffect, useMemo, useRef, useState } from "react"

import { readJob, type JobRecord } from "@davstack/open-agents/core/jobs"
import { walkToolUses } from "@davstack/open-agents/core/parse"
import type { ParsedEvent, RunSummary } from "@davstack/open-agents/adapters/types"
import type { MutableRefObject } from "react"

import { adapterForJob } from "./useAdapterFor.ts"
import { useRingBuffer, type LogLine } from "./useRingBuffer.ts"
import {
  formatEventLines,
  formatResultSummaryLine,
  formatStartLine,
} from "../lib/format-agent-timeline.ts"

const TERMINAL = new Set(["done", "failed", "cancelled"])

export interface UseAgentTimelineResult {
  job: JobRecord | null
  lines: LogLine[]
  summary: RunSummary | null
  done: boolean
  clear: () => void
}

export function useAgentTimeline(
  repoPath: string,
  id: string,
  noColor: boolean,
): UseAgentTimelineResult {
  const { lines, push, clear } = useRingBuffer()
  const eventsRef = useRef<ParsedEvent[]>([])
  const offsetRef = useRef(0)
  const startLineRef = useRef(false)
  const summaryRef = useRef<RunSummary | null>(null)
  const [job, setJob] = useState<JobRecord | null>(null)
  const [done, setDone] = useState(false)
  const [summaryTick, setSummaryTick] = useState(0)

  const adapter = useMemo(() => (job ? adapterForJob(job) : cursorAdapterFallback()), [job])

  useEffect(() => {
    eventsRef.current = []
    offsetRef.current = 0
    startLineRef.current = false
    summaryRef.current = null
    setDone(false)
    setSummaryTick(0)
    clear()
  }, [repoPath, id, clear])

  useEffect(() => {
    let cancelled = false

    const poll = () => {
      if (cancelled) return
      const fresh = readJob(repoPath, id)
      if (!fresh) return
      setJob(fresh)

      if (!startLineRef.current) {
        startLineRef.current = true
        const start = formatStartLine({ prompt: fresh.prompt, noColor })
        push({ ts: Date.now(), stream: "out", text: start.text })
      }

      if (fs.existsSync(fresh.rawLogPath)) {
        const txt = fs.readFileSync(fresh.rawLogPath, "utf8")
        if (txt.length > offsetRef.current) {
          const slice = txt.slice(offsetRef.current)
          offsetRef.current = txt.length
          ingestLines({ adapter, chunk: slice, eventsRef, push, noColor })
        }
      }

      if (TERMINAL.has(fresh.status)) {
        setDone(true)
        if (!summaryRef.current) {
          summaryRef.current = adapter.summarise(eventsRef.current)
          const toolCalls = countToolCalls(eventsRef.current)
          const usage = pickUsage(eventsRef.current)
          const cost = pickCostFromEvents(eventsRef.current)
          const summaryLine = formatResultSummaryLine({
            toolCallCount: toolCalls,
            filesChanged: summaryRef.current.filesChanged,
            usage,
            cost,
            noColor,
          })
          push({ ts: Date.now(), stream: "out", text: summaryLine.text })
          setSummaryTick((t) => t + 1)
        }
      }
    }

    poll()
    const idTimer = setInterval(poll, 700)
    return () => {
      cancelled = true
      clearInterval(idTimer)
    }
  }, [repoPath, id, adapter, push, noColor])

  const summary = useMemo(() => summaryRef.current, [summaryTick, done])

  return { job, lines, summary, done, clear }
}

function ingestLines(opts: {
  adapter: ReturnType<typeof adapterForJob>
  chunk: string
  eventsRef: MutableRefObject<ParsedEvent[]>
  push: (line: LogLine) => void
  noColor: boolean
}): void {
  for (const line of opts.chunk.split("\n")) {
    if (!line.trim()) continue
    const ev = opts.adapter.parseLine(line)
    if (!ev) continue
    opts.eventsRef.current.push(ev)
    for (const row of formatEventLines({ ev, noColor: opts.noColor })) {
      opts.push({ ts: Date.now(), stream: "out", text: row.text })
    }
  }
}

function countToolCalls(events: ParsedEvent[]): number {
  let n = 0
  for (const ev of events) {
    for (const _ of walkToolUses(ev)) n += 1
    const type = ev.type
    if (type === "tool_use" || type === "tool_call") n += 1
  }
  return n
}

function pickUsage(events: ParsedEvent[]): { input?: number; output?: number } | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev?.type !== "result") continue
    const usage = ev.usage as Record<string, unknown> | undefined
    if (!usage) continue
    const input =
      typeof usage.input_tokens === "number"
        ? usage.input_tokens
        : typeof usage.input === "number"
          ? usage.input
          : undefined
    const output =
      typeof usage.output_tokens === "number"
        ? usage.output_tokens
        : typeof usage.output === "number"
          ? usage.output
          : undefined
    if (input != null || output != null) return { input, output }
  }
  return undefined
}

function pickCostFromEvents(events: ParsedEvent[]): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev?.type !== "result") continue
    if (typeof ev.cost === "number") return `$${ev.cost.toFixed(2)}`
    if (typeof ev.cost === "string") return ev.cost
    const pricing = ev.pricing as Record<string, unknown> | undefined
    if (pricing && typeof pricing.total === "number") return `$${pricing.total.toFixed(2)}`
    if (pricing && typeof pricing.total_cost === "number") return `$${pricing.total_cost.toFixed(2)}`
  }
  return undefined
}

function cursorAdapterFallback(): ReturnType<typeof adapterForJob> {
  return adapterForJob({ model: "composer-2.5" })
}
