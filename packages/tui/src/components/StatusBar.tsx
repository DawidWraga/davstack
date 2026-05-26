// Bottom status bar — horizontal list of daemon pills. P1 only renders the
// "not-running" glyph; the running/crashed glyphs are wired here so P2 can
// flip them on without a UI rewrite.

import React from "react"
import { Box, Text } from "ink"

export type DaemonStatus = "not-running" | "running" | "crashed" | "blocked"

export interface DaemonPill {
  key: string
  label: string
  status: DaemonStatus
}

const STATUS_GLYPH: Record<DaemonStatus, string> = {
  "not-running": "○",
  running: "●",
  crashed: "✗",
  blocked: "⚠",
}

const STATUS_COLOR: Record<DaemonStatus, string | undefined> = {
  "not-running": undefined,
  running: "green",
  crashed: "red",
  blocked: "yellow",
}

interface StatusBarProps {
  daemons: DaemonPill[]
}

export function StatusBar({ daemons }: StatusBarProps): React.ReactElement {
  return (
    <Box flexDirection="row">
      {daemons.map((d, i) => (
        <Box key={d.key} marginRight={i === daemons.length - 1 ? 0 : 2}>
          <Text>
            {d.key} {d.label}{" "}
            <Text color={STATUS_COLOR[d.status]}>{STATUS_GLYPH[d.status]}</Text>
          </Text>
        </Box>
      ))}
    </Box>
  )
}
