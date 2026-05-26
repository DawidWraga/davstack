// Thin component that mounts ink's useInput and delegates to the
// useHotkeys dispatcher. Keeping the ink-specific gating here lets the
// hotkey logic stay testable on its own.

import { useInput } from "ink"

import { useHotkeys } from "../hooks/useHotkeys.ts"

interface GlobalHotkeysProps {
  onQuit: () => void
}

export function GlobalHotkeys({ onQuit }: GlobalHotkeysProps): null {
  const { handle } = useHotkeys(onQuit)
  const rawModeSupported = process.stdin.isTTY === true
  useInput(
    (input, key) => {
      handle(input, { ctrl: key.ctrl, escape: key.escape })
    },
    { isActive: rawModeSupported },
  )
  return null
}
