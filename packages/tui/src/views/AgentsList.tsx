import React, { useMemo } from "react"
import { Box, Text, useInput } from "ink"

import type { JobRecord, JobStatus } from "@davstack/open-agents/core/jobs"
import { useAgentJobs } from "../hooks/useAgentJobs.ts"
import { getRepoRootSafe } from "../lib/package-info.ts"
import { jobStatusGlyph } from "../lib/agent-glyphs.ts"
import { inferAgentTitle } from "../lib/agent-title.ts"
import { useView } from "../state/view-context.tsx"
import { useNoColor, colorOrUndef } from "../hooks/useNoColor.ts"

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
  const { jobs } = useAgentJobs(repoPath)
  const { focusedIdx, setFocusedIdx, showAgent } = useView()
  const noColor = useNoColor()

  const rawModeSupported = process.stdin.isTTY === true
  useInput(
    (input, key) => {
      if (jobs.length === 0) return
      if (key.upArrow || input === "k") {
        setFocusedIdx((focusedIdx - 1 + jobs.length) % jobs.length)
      } else if (key.downArrow || input === "j") {
        setFocusedIdx((focusedIdx + 1) % jobs.length)
      } else if (key.leftArrow) {
        setFocusedIdx((focusedIdx - 1 + jobs.length) % jobs.length)
      } else if (key.rightArrow) {
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
      <Box marginBottom={1}>
        <Text bold>Agents</Text>
      </Box>
      {jobs.map((job, i) => (
        <AgentListRow key={job.id} job={job} focused={i === safeFocus} />
      ))}
      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ j/k focus  ←/→ cycle  enter drill in  esc back  g agents  q quit{" "}
          {jobStatusGlyph("running", noColor)} running {jobStatusGlyph("done", noColor)} done{" "}
          {jobStatusGlyph("failed", noColor)} failed
        </Text>
      </Box>
    </Box>
  )
}

function AgentListRow({ job, focused }: { job: JobRecord; focused: boolean }): React.ReactElement {
  const noColor = useNoColor()
  const { adapter, inferred } = useMemo(() => inferAdapter(job.model), [job.model])
  const age = formatAge(job.startedAt)
  const title = useMemo(() => truncateOneLine(inferAgentTitle({ prompt: job.prompt }), 36), [job.prompt])
  const adapterLabel = inferred ? `${adapter} (inferred)` : adapter

  return (
    <Box>
      <Text color={colorOrUndef(focused ? "cyan" : undefined, noColor)}>
        {focused ? "› " : "  "}
      </Text>
      <Text color={colorOrUndef(STATUS_COLOR[job.status], noColor)}>
        {jobStatusGlyph(job.status, noColor)}
      </Text>
      <Text> {STATUS_LABEL[job.status].padEnd(5)}</Text>
      <Text dimColor={!inferred}>{adapterLabel.padEnd(14)}</Text>
      <Text bold>{title.padEnd(36)}</Text>
      <Text dimColor>{job.id.padEnd(22)}</Text>
      <Text dimColor>{age.padStart(4)} </Text>
      <Text dimColor>{job.model}</Text>
    </Box>
  )
}

function AgentsEmptyState(): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Agents</Text>
      </Box>
      <Text dimColor>
        No agents have run in this repo yet. Submit one with: explore &quot;&lt;prompt&gt;&quot;
      </Text>
      <Box marginTop={1}>
        <Text dimColor>esc back  g agents  q quit</Text>
      </Box>
    </Box>
  )
}

function inferAdapter(model: string): { adapter: string; inferred: boolean } {
  const m = model.toLowerCase()
  if (m.startsWith("gemini-")) return { adapter: "gemini", inferred: false }
  if (m.startsWith("composer-") || m.startsWith("cursor-")) return { adapter: "cursor", inferred: false }
  return { adapter: "cursor", inferred: true }
}

function formatAge(startedAt: string): string {
  const ageMin = Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)
  if (ageMin < 60) return `${ageMin}m`
  return `${Math.round(ageMin / 60)}h`
}

function truncateOneLine(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim()
  if (one.length <= n) return one
  return one.slice(0, n - 1) + "…"
}
