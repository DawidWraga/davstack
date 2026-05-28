import React, { useMemo } from "react"
import { Box, Text, useInput } from "ink"

import type { JobRecord, JobStatus } from "@davstack/open-agents/core/jobs"
import { useAgentJobs } from "../hooks/useAgentJobs.ts"
import { getRepoRootSafe } from "../lib/package-info.ts"
import { jobStatusGlyph } from "../lib/agent-glyphs.ts"
import { inferAgentTitle } from "../lib/agent-title.ts"
import { useView } from "../state/view-context.tsx"
import { useNoColor, colorOrUndef } from "../hooks/useNoColor.ts"
import { ControlsHint } from "../components/ControlsHint.tsx"

const AGENTS_CONTROLS =
  "↑/↓ j/k focus  enter drill in  r refresh  esc back  g agents  q quit"

const STATUS_LABEL: Record<JobStatus, string> = {
  running: "run",
  done: "done",
  failed: "fail",
  cancelled: "cancel",
}

const STATUS_COLOR: Record<JobStatus, string> = {
  running: "yellow",
  done: "gray",
  failed: "red",
  cancelled: "gray",
}

export function AgentsList(): React.ReactElement {
  const repoPath = getRepoRootSafe()
  const { jobs, refresh } = useAgentJobs(repoPath)
  const { focusedIdx, setFocusedIdx, showAgent } = useView()

  const rawModeSupported = process.stdin.isTTY === true
  useInput(
    (input, key) => {
      if (input === "r") {
        refresh()
        return
      }
      if (jobs.length === 0) return
      if (key.upArrow || input === "k") {
        setFocusedIdx((focusedIdx - 1 + jobs.length) % jobs.length)
      } else if (key.downArrow || input === "j") {
        setFocusedIdx((focusedIdx + 1) % jobs.length)
      } else if (key.return) {
        const job = jobs[Math.min(focusedIdx, jobs.length - 1)]
        if (job) showAgent(job.id)
      }
    },
    { isActive: rawModeSupported },
  )

  if (jobs.length === 0) {
    return <AgentsEmptyState />
  }

  const safeFocus = Math.min(focusedIdx, jobs.length - 1)

  return (
    <Box flexDirection="column">
      {jobs.map((job, i) => (
        <AgentListRow key={job.id} job={job} focused={i === safeFocus} />
      ))}
      <ControlsHint controls={AGENTS_CONTROLS} />
    </Box>
  )
}

function AgentListRow({ job, focused }: { job: JobRecord; focused: boolean }): React.ReactElement {
  const noColor = useNoColor()
  const title = useMemo(() => truncateOneLine(inferAgentTitle({ prompt: job.prompt }), 80), [job.prompt])
  const when = formatWhen(job.startedAt)

  return (
    <Box>
      <Text color={colorOrUndef(focused ? "cyan" : undefined, noColor)}>
        {focused ? "› " : "  "}
      </Text>
      <Text color={colorOrUndef(STATUS_COLOR[job.status], noColor)}>
        {jobStatusGlyph(job.status, noColor)}
      </Text>
      <Text> {STATUS_LABEL[job.status].padEnd(7)}</Text>
      <Text bold>{title.padEnd(82)}</Text>
      <Text dimColor>{when}</Text>
    </Box>
  )
}

function AgentsEmptyState(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text dimColor>
        No agents have run in this repo yet. Submit one with: explore &quot;&lt;prompt&gt;&quot;
      </Text>
      <ControlsHint controls={AGENTS_CONTROLS} />
    </Box>
  )
}

function formatWhen(startedAt: string, now = Date.now()): string {
  const then = new Date(startedAt).getTime()
  const ageMs = now - then
  const dayMs = 24 * 60 * 60 * 1000
  if (ageMs < dayMs) {
    const ageMin = Math.max(0, Math.round(ageMs / 60000))
    if (ageMin < 1) return "just now"
    if (ageMin < 60) return `${ageMin}m ago`
    const ageHr = Math.round(ageMin / 60)
    return `${ageHr}h ago`
  }
  const d = new Date(then)
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]}`
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

function truncateOneLine(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim()
  if (one.length <= n) return one
  return one.slice(0, n - 1) + "…"
}
