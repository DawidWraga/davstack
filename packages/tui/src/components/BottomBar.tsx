// Persistent bottom bar — renders in both list and log views. Reads
// rows + current view from context to derive pills and which one is
// focused (highlighted bold + inverse).

import React from "react"

import { StatusBar, type DaemonPill, type DaemonStatus as PillStatus } from "./StatusBar.tsx"
import { useDaemons, type DaemonRow } from "../state/daemons-context.tsx"
import { useView } from "../state/view-context.tsx"

function statusToPill(s: DaemonRow["status"]): PillStatus {
  if (s === "running") return "running"
  if (s === "crashed") return "crashed"
  if (s === "blocked") return "blocked"
  return "not-running"
}

export function BottomBar(): React.ReactElement {
  const { rows } = useDaemons()
  const { view } = useView()
  const pills: DaemonPill[] = rows.map((r, i) => ({
    key: String(i + 1),
    daemonKey: r.descriptor.key,
    label: r.descriptor.label,
    status: statusToPill(r.status),
  }))
  return <StatusBar daemons={pills} focusedKey={view.kind === "log" ? view.key : undefined} />
}
