import React, { useMemo } from "react"
import { Box, Text, useStdout } from "ink"

export interface AgentFilePopoverProps {
  title: string
  body: string | null
  emptyLabel: string
}

export function AgentFilePopover(props: AgentFilePopoverProps): React.ReactElement {
  const { title, body, emptyLabel } = props
  const { stdout } = useStdout()
  const rows = stdout?.rows ?? 24
  const visible = Math.max(5, rows - 8)

  const lines = useMemo(() => {
    if (!body?.trim()) return []
    return body.replace(/\r\n/g, "\n").split("\n")
  }, [body])

  const tail = lines.slice(-visible)

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      <Text bold>{title}</Text>
      <Box flexDirection="column" marginTop={1}>
        {tail.length === 0 ? (
          <Text dimColor>{emptyLabel}</Text>
        ) : (
          tail.map((line, i) => (
            <Text key={i} wrap="truncate">
              {line}
            </Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>esc close · r result · s spec</Text>
      </Box>
    </Box>
  )
}
