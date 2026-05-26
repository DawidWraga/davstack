// Collapsed-by-default keyboard hint row. Default shows `c for controls`;
// toggled state inlines the full hint string. Toggle is owned by the
// parent view via useInput so each view decides what `c` means.

import React from "react"
import { Box, Text } from "ink"

export interface ControlsHintProps {
  expanded: boolean
  controls: string
}

export function ControlsHint({ expanded, controls }: ControlsHintProps): React.ReactElement {
  return (
    <Box marginTop={1}>
      <Text dimColor>{expanded ? controls : "c for controls"}</Text>
    </Box>
  )
}
