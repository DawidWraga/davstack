// Persistent bottom bar — renders in both list and log views. Reads
// rows + current view from context to derive pills and which one is
// focused (highlighted bold + inverse).

import React, { useMemo } from "react"

import { StatusBar, type DaemonPill, type DaemonStatus as PillStatus, type AgentPill } from "./StatusBar.tsx"
import { useDaemons, type DaemonRow } from "../state/daemons-context.tsx"
import { useView } from "../state/view-context.tsx"
import { useAgents } from "../state/agents-context.tsx"
import { formatAgentPillLabel, getRunningPillJobs } from "../lib/agent-pill.ts"

function statusToPill(s: DaemonRow["status"]): PillStatus {
  if (s === "running") return "running"
  if (s === "crashed") return "crashed"
  if (s === "blocked") return "blocked"
  return "not-running"
}

export function BottomBar(): React.ReactElement {
  const { rows } = useDaemons()
  const { view, focusedIdx, highlightedAgentId } = useView()
  const { jobs } = useAgents()

  const pills: DaemonPill[] = rows.map((r, i) => ({
    key: String(i + 1),
    daemonKey: r.descriptor.key,
    label: r.descriptor.label,
    status: statusToPill(r.status),
  }))

  const runningJobs = useMemo(() => getRunningPillJobs(jobs), [jobs])
  const agentPills: AgentPill[] = useMemo(
    () =>
      runningJobs.map((job) => ({
        jobId: job.id,
        label: formatAgentPillLabel(job),
      })),
    [runningJobs],
  )

  const focusedAgentId = useMemo(() => {
    if (highlightedAgentId && runningJobs.some((j) => j.id === highlightedAgentId)) {
      return highlightedAgentId
    }
    if (view.kind === "agents") {
      const safeFocus = jobs.length === 0 ? 0 : Math.min(focusedIdx, jobs.length - 1)
      const job = jobs[safeFocus]
      return job?.status === "running" ? job.id : undefined
    }
    return undefined
  }, [highlightedAgentId, runningJobs, view.kind, focusedIdx, jobs])

  return (
    <StatusBar
      daemons={pills}
      agents={agentPills}
      focusedKey={view.kind === "log" ? view.key : undefined}
      focusedAgentId={focusedAgentId}
    />
  )
}
