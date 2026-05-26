// Pure hotkey dispatcher. Takes a raw key/input shape and routes it
// through the view + daemons contexts. Exposed as a hook so tests can
// invoke handlers directly without piping bytes through Ink's raw-mode
// machinery.

import { useCallback } from "react"

import { useView } from "../state/view-context.tsx"
import { useDaemons } from "../state/daemons-context.tsx"

export interface KeyEvent {
  ctrl?: boolean
  escape?: boolean
}

export interface HotkeyHandlers {
  onQuit: () => void
  onNumberKey: (idx: number) => void
  onEscape: () => void
  // List-view-only: handle `s` toggle on the focused row.
  onToggleFocused: () => void
  // Master dispatcher used by ink's useInput.
  handle: (input: string, key: KeyEvent) => void
}

export function useHotkeys(quit: () => void): HotkeyHandlers {
  const { showLog, showList, setFocusedIdx, view, focusedIdx } = useView()
  const { rowsRef, toggleByKey } = useDaemons()

  const onQuit = useCallback(() => quit(), [quit])

  const onNumberKey = useCallback(
    (idx: number) => {
      const target = rowsRef.current[idx]
      if (!target) return
      setFocusedIdx(idx)
      showLog(target.descriptor.key)
    },
    [rowsRef, setFocusedIdx, showLog],
  )

  const onEscape = useCallback(() => {
    if (view.kind === "log") showList()
  }, [view, showList])

  const onToggleFocused = useCallback(() => {
    const target = rowsRef.current[focusedIdx]
    if (!target) return
    toggleByKey(target.descriptor.key)
  }, [rowsRef, focusedIdx, toggleByKey])

  const handle = useCallback(
    (input: string, key: KeyEvent) => {
      if (input === "q") {
        onQuit()
        return
      }
      if (key.ctrl && input === "c") {
        onQuit()
        return
      }
      if (/^[1-9]$/.test(input)) {
        onNumberKey(Number(input) - 1)
        return
      }
      if (key.escape) {
        onEscape()
        return
      }
    },
    [onQuit, onNumberKey, onEscape],
  )

  return { onQuit, onNumberKey, onEscape, onToggleFocused, handle }
}
