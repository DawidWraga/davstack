import React, { useMemo } from "react"
import { Box, Text, useStdout } from "ink"

import type { JobStatus } from "@davstack/open-agents/core/jobs"

import { useAgentTimeline } from "../hooks/useAgentTimeline.ts"
import { useNoColor, colorOrUndef } from "../hooks/useNoColor.ts"
import { getRepoRootSafe } from "../lib/package-info.ts"

const STATUS_COLOR: Record<JobStatus, string> = {
  running: "yellow",
  done: "gray",
  failed: "red",
  cancelled: "gray",
}

export interface AgentTimelineViewProps {
  jobId: string
}

export function AgentTimelineView(props: AgentTimelineViewProps): React.ReactElement {
  const { jobId } = props
  const repoPath = getRepoRootSafe()
  const { lines, job } = useAgentTimeline(repoPath, jobId)
  const noColor = useNoColor()
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24
  const visible = Math.max(5, rows - 5)
  const tail = lines.slice(-visible)

  const header = useMemo(() => {
    if (!job) return { adapter: "?", model: "?", prompt: "" }
    const m = job.model.toLowerCase()
    const adapter = m.startsWith("gemini-") ? "gemini" : "cursor"
    const prompt = job.prompt.replace(/\s+/g, " ").trim()
    return { adapter, model: job.model, prompt }
  }, [job])

  if (!job) {
    return (
      <Box flexDirection="column">
        <Text dimColor>Job not found: {jobId}</Text>
        <Box marginTop={1}>
          <Text dimColor>esc back · q quit</Text>
        </Box>
      </Box>
    )
  }

  const promptLine =
    header.prompt.length > 60 ? header.prompt.slice(0, 59) + "…" : header.prompt

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{jobId}</Text>
        <Text> · {header.adapter} · {header.model} · </Text>
        <Text color={colorOrUndef(STATUS_COLOR[job.status], noColor)}>({job.status})</Text>
      </Box>
      <Box>
        <Text dimColor>{promptLine}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {tail.length === 0 ? (
          <Text dimColor>(no events yet)</Text>
        ) : (
          tail.map((l, i) => (
            <Text key={i}>
              {formatLineTs(l.ts)}  {l.text}
            </Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Raw log: {job.rawLogPath}</Text>
      </Box>
      <Box>
        <Text dimColor>esc back · q quit</Text>
      </Box>
    </Box>
  )
}

function formatLineTs(ts: number): string {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}
