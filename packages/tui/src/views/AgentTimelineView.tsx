import React, { useEffect, useMemo, useState } from "react"
import { Box, Text, useInput, useStdout } from "ink"

import type { JobStatus } from "@davstack/open-agents/core/jobs"

import { useAgentTimeline } from "../hooks/useAgentTimeline.ts"
import { useNoColor, colorOrUndef } from "../hooks/useNoColor.ts"
import { getRepoRootSafe } from "../lib/package-info.ts"
import { readAgentSpecContent } from "../lib/read-agent-overlay.ts"
import { readAgentDiff } from "../lib/read-agent-diff.ts"
import { useAgents, type AgentPane } from "../state/agents-context.tsx"
import { inferAgentTitle } from "../lib/agent-title.ts"
import { ControlsHint } from "../components/ControlsHint.tsx"
import { Markdown } from "../components/Markdown.tsx"

const STATUS_COLOR: Record<JobStatus, string> = {
  running: "yellow",
  done: "gray",
  failed: "red",
  cancelled: "gray",
}

const TIMELINE_CONTROLS =
  "s spec  l logs  d diff  c clear logs  esc back  q quit"

export interface AgentTimelineViewProps {
  jobId: string
}

export function AgentTimelineView(props: AgentTimelineViewProps): React.ReactElement {
  const { jobId } = props
  const repoPath = getRepoRootSafe()
  const noColor = useNoColor()
  const { agentPane, setAgentPane, registerTimelineClear } = useAgents()
  const { lines, job, clear } = useAgentTimeline(repoPath, jobId, noColor)
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24
  const visible = Math.max(8, rows - 6)

  useEffect(() => {
    registerTimelineClear(clear)
    return () => registerTimelineClear(null)
  }, [clear, registerTimelineClear])

  // Default to the spec pane every time the user enters a new job.
  useEffect(() => {
    setAgentPane("spec")
  }, [jobId, setAgentPane])

  const rawModeSupported = process.stdin.isTTY === true
  const [controlsOpen, setControlsOpen] = useState(false)
  useInput(
    (input) => {
      if (input === "s") setAgentPane("spec")
      else if (input === "l") setAgentPane("logs")
      else if (input === "d") setAgentPane("diff")
      else if (input === "c") setControlsOpen((v) => !v)
    },
    { isActive: rawModeSupported },
  )

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

  const title = inferAgentTitle({ prompt: job.prompt })
  const adapter = job.model.toLowerCase().startsWith("gemini-") ? "gemini" : "cursor"

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{title || jobId}</Text>
        <Text dimColor> · {jobId} · {adapter} · {job.model} · </Text>
        <Text color={colorOrUndef(STATUS_COLOR[job.status], noColor)}>({job.status})</Text>
      </Box>
      <PaneTabs active={agentPane} />
      <Box flexDirection="column" marginTop={1} height={visible} flexShrink={0}>
        <PaneBody pane={agentPane} jobId={jobId} repoPath={repoPath} job={job} lines={lines} visible={visible} />
      </Box>
      <ControlsHint expanded={controlsOpen} controls={TIMELINE_CONTROLS} />
    </Box>
  )
}

function PaneTabs({ active }: { active: AgentPane }): React.ReactElement {
  const entries: Array<{ key: AgentPane; label: string; hotkey: string }> = [
    { key: "spec", label: "spec", hotkey: "s" },
    { key: "logs", label: "logs", hotkey: "l" },
    { key: "diff", label: "diff", hotkey: "d" },
  ]
  return (
    <Box marginTop={1}>
      {entries.map((e, i) => (
        <Box key={e.key} marginRight={i === entries.length - 1 ? 0 : 2}>
          <Text bold={active === e.key} inverse={active === e.key}>
            {" "}
            {e.hotkey} {e.label}{" "}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

interface PaneBodyProps {
  pane: AgentPane
  jobId: string
  repoPath: string
  job: NonNullable<ReturnType<typeof useAgentTimeline>["job"]>
  lines: ReturnType<typeof useAgentTimeline>["lines"]
  visible: number
}

function PaneBody(props: PaneBodyProps): React.ReactElement {
  if (props.pane === "spec") return <SpecPane repoPath={props.repoPath} jobId={props.jobId} visible={props.visible} />
  if (props.pane === "diff") return <DiffPane job={props.job} visible={props.visible} />
  return <LogsPane lines={props.lines} visible={props.visible} rawLogPath={props.job.rawLogPath} />
}

function SpecPane({
  repoPath,
  jobId,
  visible,
}: {
  repoPath: string
  jobId: string
  visible: number
}): React.ReactElement {
  const content = useMemo(() => readAgentSpecContent({ repoPath, jobId }), [repoPath, jobId])
  if (!content) {
    return <Text dimColor>(no spec file on disk)</Text>
  }
  const totalLines = content.replace(/\r\n/g, "\n").split("\n").length
  return (
    <Box flexDirection="column">
      <Markdown source={content} maxLines={visible} />
      {totalLines > visible ? (
        <Text dimColor>… {totalLines - visible} more lines</Text>
      ) : null}
    </Box>
  )
}

function LogsPane({
  lines,
  visible,
  rawLogPath,
}: {
  lines: ReturnType<typeof useAgentTimeline>["lines"]
  visible: number
  rawLogPath: string
}): React.ReactElement {
  const tail = lines.slice(-visible)
  return (
    <Box flexDirection="column">
      {tail.length === 0 ? (
        <Text dimColor>(no events yet)</Text>
      ) : (
        tail.map((l, i) => (
          <Text key={i}>
            {formatLineTs(l.ts)}  {l.text}
          </Text>
        ))
      )}
      <Box marginTop={1}>
        <Text dimColor>Raw log: {rawLogPath}</Text>
      </Box>
    </Box>
  )
}

function DiffPane({
  job,
  visible,
}: {
  job: PaneBodyProps["job"]
  visible: number
}): React.ReactElement {
  // Cache by jobId + filesChanged size — re-running git on every poll
  // tick (job ref changes every 700ms) blocks the render thread and
  // causes stale frames to stick around between pane switches.
  const jobId = job.id
  const filesCount = job.filesChanged?.length ?? 0
  const repoPath = job.repoPath
  const [state, setState] = useState<{ diff: string; files: string[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    setState(null)
    readAgentDiff(job).then((r) => {
      if (!cancelled) setState(r)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, filesCount, repoPath])

  if (state == null) return <Text dimColor>(computing diff…)</Text>
  const { diff, files } = state
  if (files.length === 0) {
    return <Text dimColor>(no filesChanged recorded for this job)</Text>
  }
  if (!diff.trim()) {
    return (
      <Box flexDirection="column">
        <Text dimColor>
          (no diff against HEAD — changes were committed, or files are outside the repo)
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Files reported:</Text>
          {files.map((f) => (
            <Text key={f}>  · {f}</Text>
          ))}
        </Box>
      </Box>
    )
  }
  const allLines = diff.split("\n")
  const slice = allLines.slice(0, visible)
  return (
    <Box flexDirection="column">
      {slice.map((l, i) => (
        <Text key={i} wrap="truncate" color={colorForDiffLine(l)}>
          {l}
        </Text>
      ))}
      {allLines.length > visible ? (
        <Text dimColor>… {allLines.length - visible} more lines</Text>
      ) : null}
    </Box>
  )
}

function colorForDiffLine(line: string): string | undefined {
  if (line.startsWith("+") && !line.startsWith("+++")) return "green"
  if (line.startsWith("-") && !line.startsWith("---")) return "red"
  if (line.startsWith("@@")) return "cyan"
  if (line.startsWith("diff --git") || line.startsWith("index ")) return "yellow"
  return undefined
}

function formatLineTs(ts: number): string {
  const d = new Date(ts)
  return d.toTimeString().slice(0, 8)
}
