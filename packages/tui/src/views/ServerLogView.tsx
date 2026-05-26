// Drill-in log view: renders the tail of a daemon's ring buffer to fill
// the visible terminal height. `esc` (handled by GlobalHotkeys) returns
// to the list; `c` clears the ring buffer.

import React from "react"
import { Box, Text, useStdout } from "ink"

import type { LogLine } from "../hooks/useRingBuffer.ts"
import type { DaemonStatus } from "../hooks/useDaemonProcess.ts"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"
import { useNoColor, colorOrUndef } from "../hooks/useNoColor.ts"

interface ServerLogViewProps {
  descriptor: DaemonDescriptor
  status: DaemonStatus
  lines: LogLine[]
  exitCode?: number | null
}

// Same scheme as ServerList — keep these two tables aligned by hand
// rather than sharing a module, since their domain types differ.
const STATUS_COLOR: Record<DaemonStatus, string> = {
  idle: "gray",
  starting: "yellow",
  running: "green",
  exiting: "yellow",
  exited: "gray",
  crashed: "red",
  blocked: "yellow",
}

export function ServerLogView({
  descriptor,
  status,
  lines,
  exitCode,
}: ServerLogViewProps): React.ReactElement {
  const noColor = useNoColor()
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24
  // Reserve a couple of lines for header + footer.
  const visible = Math.max(5, rows - 4)
  const tail = lines.slice(-visible)

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{descriptor.label}</Text>
        <Text> </Text>
        <Text color={colorOrUndef(STATUS_COLOR[status], noColor)}>({status})</Text>
        <Text dimColor> — port {descriptor.port}</Text>
      </Box>
      {status === "crashed" ? (
        <Box marginTop={1}>
          <Text color={colorOrUndef("red", noColor)}>
            daemon exited with code {exitCode ?? "?"} — last logs preserved
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {tail.length === 0 ? (
          <Text dimColor>(no output yet)</Text>
        ) : (
          tail.map((l, i) => (
            // Per-line color intentionally left default. stderr is used
            // by most daemons as a diagnostic channel (info/warn lines
            // routed there to keep stdout clean), so painting it red
            // misrepresents normal output. The status pill above is the
            // signal for daemon-level health.
            <Text key={i}>{l.text}</Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>esc back · c clear · q quit</Text>
      </Box>
    </Box>
  )
}
