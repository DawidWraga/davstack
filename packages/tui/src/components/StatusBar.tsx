// Bottom status bar — horizontal list of daemon pills. Colors follow the
// project-wide convention: green ● running, gray ○ idle/exited, red ✗
// crashed, yellow ⚠ blocked.

import React from "react"
import { Box, Text } from "ink"

import { useNoColor, colorOrUndef } from "../hooks/useNoColor.ts"

export type DaemonStatus = "not-running" | "running" | "crashed" | "blocked"

export interface DaemonPill {
  // Visible hotkey shown to the user — typically "1", "2", "3".
  key: string
  // Daemon registry key, used to match against `focusedKey`.
  daemonKey: string
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
  "not-running": "gray",
  running: "green",
  crashed: "red",
  blocked: "yellow",
}

interface StatusBarProps {
  daemons: DaemonPill[]
  // Daemon key currently being viewed (log view). The matching pill is
  // rendered bold + inverse so users can see which one they're in.
  focusedKey?: string
}

// Exported for unit tests — avoids depending on ANSI escape detection
// in the rendered frame (ink-testing-library strips them in debug mode).
export function isPillFocused(pill: DaemonPill, focusedKey: string | undefined): boolean {
  return focusedKey !== undefined && pill.daemonKey === focusedKey
}

export function StatusBar({ daemons, focusedKey }: StatusBarProps): React.ReactElement {
  const noColor = useNoColor()
  return (
    <Box flexDirection="row">
      {daemons.map((d, i) => {
        const focused = isPillFocused(d, focusedKey)
        return (
          <Box key={d.key} marginRight={i === daemons.length - 1 ? 0 : 2}>
            <Text inverse={focused} bold={focused}>
              {d.key} {d.label}{" "}
              <Text color={colorOrUndef(STATUS_COLOR[d.status], noColor)}>
                {STATUS_GLYPH[d.status]}
              </Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
