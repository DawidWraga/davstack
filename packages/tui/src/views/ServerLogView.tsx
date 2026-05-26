// Drill-in log view: renders the tail of a daemon's ring buffer to fill
// the visible terminal height. `esc` returns to the list.

import React from "react"
import { Box, Text, useInput, useStdout } from "ink"

import type { LogLine } from "../hooks/useRingBuffer.ts"
import type { DaemonStatus } from "../hooks/useDaemonProcess.ts"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

interface ServerLogViewProps {
  descriptor: DaemonDescriptor
  status: DaemonStatus
  lines: LogLine[]
  exitCode?: number | null
  onBack: () => void
}

export function ServerLogView({
  descriptor,
  status,
  lines,
  exitCode,
  onBack,
}: ServerLogViewProps): React.ReactElement {
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24
  // Reserve a couple of lines for header + footer.
  const visible = Math.max(5, rows - 4)
  const tail = lines.slice(-visible)

  const rawModeSupported = process.stdin.isTTY === true
  useInput(
    (_input, key) => {
      if (key.escape) onBack()
    },
    { isActive: rawModeSupported },
  )

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>{descriptor.label}</Text>
        <Text dimColor> ({status}) — port {descriptor.port}</Text>
      </Box>
      {status === "crashed" ? (
        <Box marginTop={1}>
          <Text color="red">
            daemon exited with code {exitCode ?? "?"} — last logs preserved
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="column" marginTop={1}>
        {tail.length === 0 ? (
          <Text dimColor>(no output yet)</Text>
        ) : (
          tail.map((l, i) => (
            <Text key={i} color={l.stream === "err" ? "red" : undefined}>
              {l.text}
            </Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>esc back  q quit</Text>
      </Box>
    </Box>
  )
}
