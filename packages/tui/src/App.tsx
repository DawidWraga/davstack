// Ink root component for `davstack start`. P1 ships a hardcoded shell:
// a title row, a placeholder body, and a bottom StatusBar with three
// pills. Pressing `q` quits. Real daemon wiring lands in P2.

import React from "react"
import { Box, Text, useApp, useInput } from "ink"

import { StatusBar, type DaemonPill } from "./components/StatusBar.tsx"

const PLACEHOLDER_DAEMONS: DaemonPill[] = [
  { key: "1", label: "vitest", status: "not-running" },
  { key: "2", label: "playwright", status: "not-running" },
  { key: "3", label: "logs", status: "not-running" },
]

export function App(): React.ReactElement {
  const { exit } = useApp()

  useInput((input) => {
    if (input === "q") exit()
  })

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>davstack</Text>
      </Box>
      <Box marginTop={1}>
        <Text>Hello TUI — daemon list lands in P2</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press q to quit.</Text>
      </Box>
      <Box marginTop={1}>
        <StatusBar daemons={PLACEHOLDER_DAEMONS} />
      </Box>
    </Box>
  )
}
