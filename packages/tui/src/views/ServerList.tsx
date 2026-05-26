// Daemon list view: one row per registered daemon, focused row highlighted.
// `↑/↓` move focus, `enter` drills into the focused daemon's log view.

import React from "react"
import { Box, Text, useInput } from "ink"

import type { DaemonStatus } from "../hooks/useDaemonProcess.ts"
import type { LogLine } from "../hooks/useRingBuffer.ts"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

export type DaemonRow = {
  descriptor: DaemonDescriptor
  status: DaemonStatus
  lines: LogLine[]
}

const STATUS_GLYPH: Record<DaemonStatus, string> = {
  idle: "○",
  starting: "◐",
  running: "●",
  exiting: "◐",
  exited: "○",
  crashed: "✗",
}

const STATUS_COLOR: Record<DaemonStatus, string> = {
  idle: "gray",
  starting: "yellow",
  running: "green",
  exiting: "yellow",
  exited: "gray",
  crashed: "red",
}

interface ServerListProps {
  rows: DaemonRow[]
  focusedIdx: number
  onFocusChange: (idx: number) => void
  onSelect: (idx: number) => void
}

export function ServerList({
  rows,
  focusedIdx,
  onFocusChange,
  onSelect,
}: ServerListProps): React.ReactElement {
  const rawModeSupported = process.stdin.isTTY === true
  useInput(
    (_input, key) => {
      if (rows.length === 0) return
      if (key.upArrow) {
        onFocusChange((focusedIdx - 1 + rows.length) % rows.length)
      } else if (key.downArrow) {
        onFocusChange((focusedIdx + 1) % rows.length)
      } else if (key.return) {
        onSelect(focusedIdx)
      }
    },
    { isActive: rawModeSupported },
  )

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Daemons</Text>
      </Box>
      {rows.map((row, i) => {
        const focused = i === focusedIdx
        const last = row.lines[row.lines.length - 1]
        const lastText = last ? truncate(last.text, 60) : ""
        return (
          <Box key={row.descriptor.key}>
            <Text color={focused ? "cyan" : undefined}>
              {focused ? "› " : "  "}
            </Text>
            <Text color={STATUS_COLOR[row.status]}>{STATUS_GLYPH[row.status]}</Text>
            <Text> {row.descriptor.label.padEnd(12)}</Text>
            <Text dimColor>{row.status.padEnd(10)}</Text>
            <Text dimColor>{lastText}</Text>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ focus  enter drill in  q quit</Text>
      </Box>
    </Box>
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + "…"
}
