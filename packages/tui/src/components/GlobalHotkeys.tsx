// Thin component that mounts ink's useInput and delegates to the
// useHotkeys dispatcher. Keeping the ink-specific gating here lets the
// hotkey logic stay testable on its own. alt+d is intercepted here to
// force a screen repaint via stdout — the dispatcher stays pure.

import { useCallback } from "react"
import { useInput, useStdout } from "ink"

import { useHotkeys } from "../hooks/useHotkeys.ts"

interface GlobalHotkeysProps {
  onQuit: () => void
}

export function GlobalHotkeys({ onQuit }: GlobalHotkeysProps): null {
  const { handle } = useHotkeys(onQuit)
  const { stdout } = useStdout()
  const rawModeSupported = process.stdin.isTTY === true

  const repaint = useCallback(() => {
    // Clear scrollback + screen and home the cursor. Ink will redraw on
    // its next render tick.
    stdout?.write("\x1b[2J\x1b[3J\x1b[H")
  }, [stdout])

  useInput(
    (input, key) => {
      if (key.meta && input === "d") {
        repaint()
        return
      }
      handle(input, {
        ctrl: key.ctrl,
        escape: key.escape,
        leftArrow: key.leftArrow,
        rightArrow: key.rightArrow,
        tab: key.tab,
        shift: key.shift,
        meta: key.meta,
      })
    },
    { isActive: rawModeSupported },
  )
  return null
}
