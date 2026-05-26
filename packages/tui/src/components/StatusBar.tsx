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

export interface AgentPill {
  jobId: string
  label: string
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
  agents?: AgentPill[]
  // Daemon key currently being viewed (log view). The matching pill is
  // rendered bold + inverse so users can see which one they're in.
  focusedKey?: string
  focusedAgentId?: string
}

// Exported for unit tests — avoids depending on ANSI escape detection
// in the rendered frame (ink-testing-library strips them in debug mode).
export function isPillFocused(pill: DaemonPill, focusedKey: string | undefined): boolean {
  return focusedKey !== undefined && pill.daemonKey === focusedKey
}

export function isAgentPillFocused(pill: AgentPill, focusedAgentId: string | undefined): boolean {
  return focusedAgentId !== undefined && pill.jobId === focusedAgentId
}

export function StatusBar({
  daemons,
  agents = [],
  focusedKey,
  focusedAgentId,
}: StatusBarProps): React.ReactElement {
  const noColor = useNoColor()
  return (
    <Box flexDirection="row">
      {daemons.map((d, i) => {
        const focused = isPillFocused(d, focusedKey)
        const marginRight = i === daemons.length - 1 && agents.length === 0 ? 0 : 2
        return (
          <Box key={d.key} marginRight={marginRight}>
            <Text inverse={focused} bold={focused}>
              {d.key} {d.label}{" "}
              <Text color={colorOrUndef(STATUS_COLOR[d.status], noColor)}>
                {STATUS_GLYPH[d.status]}
              </Text>
            </Text>
          </Box>
        )
      })}
      {agents.length > 0 ? (
        <Box marginRight={2}>
          <Text dimColor>|</Text>
        </Box>
      ) : null}
      {agents.map((a, i) => {
        const focused = isAgentPillFocused(a, focusedAgentId)
        return (
          <Box key={a.jobId} marginRight={i === agents.length - 1 ? 0 : 2}>
            <Text inverse={focused} bold={focused}>
              <Text color={colorOrUndef("yellow", noColor)}>{a.label}</Text>
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}
