import React, { useEffect, useMemo } from "react"
import { Box, Text, useStdout } from "ink"

import type { JobStatus } from "@davstack/open-agents/core/jobs"

import { useAgentTimeline } from "../hooks/useAgentTimeline.ts"
import { adapterForJob } from "../hooks/useAdapterFor.ts"
import { useNoColor, colorOrUndef } from "../hooks/useNoColor.ts"
import { getRepoRootSafe } from "../lib/package-info.ts"
import { readAgentResultContent, readAgentSpecContent } from "../lib/read-agent-overlay.ts"
import { inferAgentTitle } from "../lib/agent-title.ts"
import { useAgents } from "../state/agents-context.tsx"
import { AgentFilePopover } from "./AgentFilePopover.tsx"

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
  const noColor = useNoColor()
  const { agentPopover, setAgentPopover, registerTimelineClear } = useAgents()
  const { lines, job, clear } = useAgentTimeline(repoPath, jobId, noColor)
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24
  const visible = Math.max(5, rows - 5)
  const tail = lines.slice(-visible)

  useEffect(() => {
    registerTimelineClear(clear)
    return () => registerTimelineClear(null)
  }, [clear, registerTimelineClear])

  useEffect(() => {
    setAgentPopover(null)
  }, [jobId, setAgentPopover])

  const header = useMemo(() => {
    if (!job) return { adapter: "?", model: "?", prompt: "", title: "" }
    const m = job.model.toLowerCase()
    const adapter = m.startsWith("gemini-") ? "gemini" : "cursor"
    const prompt = job.prompt.replace(/\s+/g, " ").trim()
    const title = inferAgentTitle({ prompt: job.prompt })
    return { adapter, model: job.model, prompt, title }
  }, [job])

  const popoverBody = useMemo(() => {
    if (!job || !agentPopover) return null
    if (agentPopover === "spec") return readAgentSpecContent({ repoPath, jobId })
    return readAgentResultContent({ adapter: adapterForJob(job), job })
  }, [agentPopover, job, repoPath, jobId])

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

  if (agentPopover) {
    const title = agentPopover === "result" ? `Result · ${jobId}` : `Spec · ${jobId}`
    const emptyLabel =
      agentPopover === "result"
        ? "(no deliverable yet — inspect raw log below)"
        : "(no spec file on disk)"
    return (
      <Box flexDirection="column">
        <AgentFilePopover title={title} body={popoverBody} emptyLabel={emptyLabel} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{header.title || jobId}</Text>
        <Text dimColor> · {jobId} · {header.adapter} · {header.model} · </Text>
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
        <Text dimColor>esc back · c clear · r result · s spec · q quit</Text>
      </Box>
    </Box>
  )
}

function formatLineTs(ts: number): string {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}
