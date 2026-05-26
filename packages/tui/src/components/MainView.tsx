// View router: loading shimmer / empty state / list / log. Reads view
// state and daemon rows from context.

import React from "react"
import { Box, Text, useStdout } from "ink"

import { ServerList } from "../views/ServerList.tsx"
import { ServerLogView } from "../views/ServerLogView.tsx"
import { AgentsList } from "../views/AgentsList.tsx"
import { AgentTimelineView } from "../views/AgentTimelineView.tsx"
import { useView } from "../state/view-context.tsx"
import { useDaemons } from "../state/daemons-context.tsx"
import { getPackageVersion, getRepoRootSafe } from "../lib/package-info.ts"

interface MainViewProps {
  // null = config discovery still in progress; empty array = none found.
  discoveryDone: boolean
  hasAnyDaemon: boolean
}

export function MainView({ discoveryDone, hasAnyDaemon }: MainViewProps): React.ReactElement {
  const { view } = useView()
  const { rows } = useDaemons()

  if (view.kind === "agent") {
    return <AgentTimelineView jobId={view.id} />
  }
  if (view.kind === "agents") {
    return <AgentsList />
  }
  if (!discoveryDone) {
    return <Text dimColor>scanning .davstack/config…</Text>
  }
  if (!hasAnyDaemon) {
    return <EmptyState />
  }
  if (view.kind === "list") {
    return <ServerList />
  }
  const row = rows.find((r) => r.descriptor.key === view.key)
  if (!row) return <Text>missing daemon: {view.key}</Text>
  return (
    <ServerLogView
      descriptor={row.descriptor}
      status={row.status}
      lines={row.lines}
      exitCode={row.exitCode ?? null}
    />
  )
}

function EmptyState(): React.ReactElement {
  const version = getPackageVersion()
  const repoRoot = getRepoRootSafe()
  const { stdout } = useStdout()
  // Reserve a few lines for the title bar + bottom pills so the centered
  // block lands roughly mid-screen. Falls back to a sensible default in
  // detached/non-TTY hosts (tests).
  const rows = stdout?.rows ?? 18
  const blockHeight = Math.max(8, rows - 6)
  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      height={blockHeight}
    >
      <Box marginBottom={1}>
        <Text bold>davstack TUI v{version}</Text>
      </Box>
      <Box>
        <Text>No davstack configs found in {repoRoot}.</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Run: </Text>
        <Text bold>pnpm dlx @davstack/init</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press q to quit.</Text>
      </Box>
    </Box>
  )
}
