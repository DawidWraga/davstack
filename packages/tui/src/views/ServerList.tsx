// Daemon list view. Reads rows + focus from context, owns the row-level
// hotkeys (`↑/↓`, `enter`, `s`). Global hotkeys (`1..9`, `esc`, `q`) live
// in <GlobalHotkeys>.

import React from "react"
import { Box, Text, useInput } from "ink"

import type { DaemonStatus } from "../hooks/useDaemonProcess.ts"
import { useView } from "../state/view-context.tsx"
import { useDaemons, type DaemonRow } from "../state/daemons-context.tsx"
import { useHotkeys } from "../hooks/useHotkeys.ts"
import { useNoColor, colorOrUndef } from "../hooks/useNoColor.ts"

const STATUS_GLYPH: Record<DaemonStatus, string> = {
  idle: "○",
  starting: "◐",
  running: "●",
  exiting: "◐",
  exited: "○",
  crashed: "✗",
  blocked: "⚠",
}

// Color scheme: green=running, gray=idle/exited, red=crashed, yellow=blocked.
// Transition states (starting, exiting) ride along on yellow.
const STATUS_COLOR: Record<DaemonStatus, string> = {
  idle: "gray",
  starting: "yellow",
  running: "green",
  exiting: "yellow",
  exited: "gray",
  crashed: "red",
  blocked: "yellow",
}

export function ServerList(): React.ReactElement {
  const { rows } = useDaemons()
  const { focusedIdx, setFocusedIdx, showLog } = useView()
  // Hotkeys hook gives us the toggle; quit isn't called here so we pass
  // a noop — the global useInput owns the q routing.
  const { onToggleFocused } = useHotkeys(() => {})

  const rawModeSupported = process.stdin.isTTY === true
  useInput(
    (input, key) => {
      if (rows.length === 0) return
      if (key.upArrow) {
        setFocusedIdx((focusedIdx - 1 + rows.length) % rows.length)
      } else if (key.downArrow) {
        setFocusedIdx((focusedIdx + 1) % rows.length)
      } else if (key.return) {
        const target = rows[focusedIdx]
        if (target) showLog(target.descriptor.key)
      } else if (input === "s") {
        onToggleFocused()
      }
    },
    { isActive: rawModeSupported },
  )

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Daemons</Text>
      </Box>
      {rows.map((row, i) => (
        <DaemonListRow key={row.descriptor.key} row={row} focused={i === focusedIdx} />
      ))}
      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ focus  enter drill in  s start/stop  k takeover  1-9 jump  q quit  ● running  ✗ crashed  ⚠ blocked
        </Text>
      </Box>
    </Box>
  )
}

function DaemonListRow({ row, focused }: { row: DaemonRow; focused: boolean }): React.ReactElement {
  const noColor = useNoColor()
  const last = row.lines[row.lines.length - 1]
  const lastText = last ? truncate(last.text, 60) : ""
  const statusLabel =
    row.status === "crashed" && typeof row.exitCode === "number"
      ? `crashed (exit ${row.exitCode})`
      : row.status === "blocked"
        ? `blocked :${row.descriptor.port}`
        : row.status
  const rowColor = row.status === "crashed" ? "red" : undefined
  return (
    <Box>
      <Text color={colorOrUndef(focused ? "cyan" : undefined, noColor)}>
        {focused ? "› " : "  "}
      </Text>
      <Text color={colorOrUndef(STATUS_COLOR[row.status], noColor)}>
        {STATUS_GLYPH[row.status]}
      </Text>
      <Text color={colorOrUndef(rowColor, noColor)}> {row.descriptor.label.padEnd(12)}</Text>
      <Text color={colorOrUndef(rowColor, noColor)} dimColor={!rowColor}>
        {statusLabel.padEnd(22)}
      </Text>
      <Text dimColor>{lastText}</Text>
    </Box>
  )
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + "…"
}
