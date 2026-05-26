// Confirm-on-quit overlay. Rendered when QuitContext.confirming is true.
// Key handling lives in useHotkeys / GlobalHotkeys — this component is
// presentational only.

import React from "react"
import { Box, Text } from "ink"

import { useNoColor, colorOrUndef } from "../hooks/useNoColor.ts"

export function QuitConfirm(): React.ReactElement {
  const noColor = useNoColor()
  return (
    <Box marginTop={1} flexDirection="column">
      <Text bold color={colorOrUndef("yellow", noColor)}>
        Quit and stop all daemons? [y/n]
      </Text>
      <Text dimColor>y confirm  n / esc cancel</Text>
    </Box>
  )
}
