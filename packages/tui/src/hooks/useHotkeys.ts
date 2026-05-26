// Pure hotkey dispatcher. Takes a raw key/input shape and routes it
// through the view + daemons + quit contexts. Exposed as a hook so tests
// can invoke handlers directly without piping bytes through Ink's
// raw-mode machinery.

import { useCallback } from "react"

import { useView } from "../state/view-context.tsx"
import { useDaemons } from "../state/daemons-context.tsx"
import { useQuit } from "../state/quit-context.tsx"

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
  // Log-view-only: clear the currently-viewed daemon's ring buffer.
  onClearLog: () => void
  // Master dispatcher used by ink's useInput.
  handle: (input: string, key: KeyEvent) => void
}

// `quit` is the cascade-shutdown trigger from QuitController. We invoke
// it directly when no daemons are live; otherwise we route through the
// confirm overlay (requestConfirm).
export function useHotkeys(quit: () => void): HotkeyHandlers {
  const { showLog, showList, setFocusedIdx, view, focusedIdx } = useView()
  const { rowsRef, toggleByKey, clearByKey, anyLive } = useDaemons()
  const { confirming, requestConfirm, cancelConfirm } = useQuit()

  const onQuit = useCallback(() => {
    if (anyLive()) {
      requestConfirm()
    } else {
      quit()
    }
  }, [quit, anyLive, requestConfirm])

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

  const onClearLog = useCallback(() => {
    if (view.kind !== "log") return
    clearByKey(view.key)
  }, [view, clearByKey])

  const handle = useCallback(
    (input: string, key: KeyEvent) => {
      // Confirm overlay swallows everything except y / n / esc.
      if (confirming) {
        if (input === "y") {
          cancelConfirm()
          quit()
          return
        }
        if (input === "n" || key.escape) {
          cancelConfirm()
          return
        }
        return
      }
      if (input === "q") {
        onQuit()
        return
      }
      if (key.ctrl && input === "c") {
        onQuit()
        return
      }
      if (input === "c" && view.kind === "log") {
        onClearLog()
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
    [confirming, cancelConfirm, quit, onQuit, onNumberKey, onEscape, onClearLog, view],
  )

  return { onQuit, onNumberKey, onEscape, onToggleFocused, onClearLog, handle }
}
