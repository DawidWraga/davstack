// Keyboard hint row. Always renders the controls string so the
// available shortcuts are discoverable without a hidden binding.

import React from "react"
import { Box, Text } from "ink"

export interface ControlsHintProps {
  controls: string
}

export function ControlsHint({ controls }: ControlsHintProps): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text dimColor>{controls}</Text>
    </Box>
  )
}
