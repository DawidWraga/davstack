// View router: loading shimmer / empty state / list / log. Reads view
// state and daemon rows from context.

import React from "react"
import { Text } from "ink"

import { ServerList } from "../views/ServerList.tsx"
import { ServerLogView } from "../views/ServerLogView.tsx"
import { useView } from "../state/view-context.tsx"
import { useDaemons } from "../state/daemons-context.tsx"

interface MainViewProps {
  // null = config discovery still in progress; empty array = none found.
  discoveryDone: boolean
  hasAnyDaemon: boolean
}

export function MainView({ discoveryDone, hasAnyDaemon }: MainViewProps): React.ReactElement {
  const { view } = useView()
  const { rows } = useDaemons()

  if (!discoveryDone) {
    return <Text dimColor>scanning .davstack/config…</Text>
  }
  if (!hasAnyDaemon) {
    return (
      <Text dimColor>
        no davstack configs found. run `pnpm dlx @davstack/init` first. (press q to quit)
      </Text>
    )
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
