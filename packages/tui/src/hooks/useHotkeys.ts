// Pure hotkey dispatcher. Takes a raw key/input shape and routes it
// through the view + daemons + quit contexts. Exposed as a hook so tests
// can invoke handlers directly without piping bytes through Ink's
// raw-mode machinery.

import { useCallback } from "react"

import { useView } from "../state/view-context.tsx"
import { useDaemons } from "../state/daemons-context.tsx"
import { useAgents } from "../state/agents-context.tsx"
import { useQuit } from "../state/quit-context.tsx"
export interface KeyEvent {
  ctrl?: boolean
  escape?: boolean
  leftArrow?: boolean
  rightArrow?: boolean
  tab?: boolean
  shift?: boolean
  meta?: boolean
}

export interface HotkeyHandlers {
  onQuit: () => void
  onNumberKey: (idx: number) => void
  onEscape: () => void
  // List-view-only: handle `s` toggle on the focused row.
  onToggleFocused: () => void
  // List-view-only: kill external port owner and re-spawn when blocked.
  onTakeoverFocused: () => void
  // Log-view-only: clear the currently-viewed daemon's ring buffer.
  onClearLog: () => void
  // Cycle the focused daemon by +1 / -1 with wrap-around. In log view this
  // also swaps the displayed daemon; in list view it just moves focus.
  onCycleFocus: (offset: 1 | -1) => void
  // Master dispatcher used by ink's useInput.
  handle: (input: string, key: KeyEvent) => void
}

// `quit` is the cascade-shutdown trigger from QuitController. We invoke
// it directly when no daemons are live; otherwise we route through the
// confirm overlay (requestConfirm).
export function useHotkeys(quit: () => void): HotkeyHandlers {
  const {
    showLog,
    showList,
    showAgents,
    setFocusedIdx,
    view,
    focusedIdx,
    highlightedAgentId,
    setHighlightedAgentId,
  } = useView()
  const { rowsRef, toggleByKey, clearByKey, takeoverByKey, anyLive } = useDaemons()
  const { jobs, agentPane, clearAgentTimeline } = useAgents()
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
    if (view.kind === "agent") {
      showAgents()
      return
    }
    if (view.kind === "log" || view.kind === "agents") {
      if (view.kind === "agents") setHighlightedAgentId(undefined)
      showList()
    }
  }, [view, showList, showAgents, setHighlightedAgentId])

  const onToggleFocused = useCallback(() => {
    const target = rowsRef.current[focusedIdx]
    if (!target) return
    toggleByKey(target.descriptor.key)
  }, [rowsRef, focusedIdx, toggleByKey])

  const onTakeoverFocused = useCallback(() => {
    const target = rowsRef.current[focusedIdx]
    if (!target) return
    takeoverByKey(target.descriptor.key)
  }, [rowsRef, focusedIdx, takeoverByKey])

  const onClearLog = useCallback(() => {
    if (view.kind !== "log") return
    clearByKey(view.key)
  }, [view, clearByKey])

  const onCycleFocus = useCallback(
    (offset: 1 | -1) => {
      const n = rowsRef.current.length
      if (n === 0) return
      const nextIdx = (focusedIdx + offset + n) % n
      setFocusedIdx(nextIdx)
      if (view.kind === "log") {
        const target = rowsRef.current[nextIdx]
        if (target) showLog(target.descriptor.key)
      }
    },
    [rowsRef, focusedIdx, setFocusedIdx, view, showLog],
  )

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
      if (input === "c") {
        if (view.kind === "log") {
          onClearLog()
          return
        }
        if (view.kind === "agent" && agentPane === "logs") {
          clearAgentTimeline()
          return
        }
      }
      if (input === "g") {
        if (view.kind !== "agents") {
          showAgents()
          if (highlightedAgentId) {
            const idx = jobs.findIndex((j) => j.id === highlightedAgentId)
            if (idx >= 0) setFocusedIdx(idx)
          }
          return
        }
        const safeFocus = jobs.length === 0 ? 0 : Math.min(focusedIdx, jobs.length - 1)
        const job = jobs[safeFocus]
        if (job?.status === "running") setHighlightedAgentId(job.id)
        showList()
        return
      }
      if (input === "k" && view.kind === "list") {
        onTakeoverFocused()
        return
      }
      if (/^[1-9]$/.test(input)) {
        if (view.kind === "agents") return
        onNumberKey(Number(input) - 1)
        return
      }
      if (key.leftArrow) {
        if (view.kind !== "agents") onCycleFocus(-1)
        return
      }
      if (key.rightArrow) {
        if (view.kind !== "agents") onCycleFocus(1)
        return
      }
      if (key.tab) {
        if (view.kind !== "agents") onCycleFocus(key.shift ? -1 : 1)
        return
      }
      if (key.escape) {
        onEscape()
        return
      }
    },
    [
      confirming,
      cancelConfirm,
      quit,
      onQuit,
      onNumberKey,
      onEscape,
      onClearLog,
      onTakeoverFocused,
      onCycleFocus,
      showAgents,
      showList,
      view,
      jobs,
      focusedIdx,
      highlightedAgentId,
      setHighlightedAgentId,
      setFocusedIdx,
      agentPane,
      clearAgentTimeline,
    ],
  )

  return {
    onQuit,
    onNumberKey,
    onEscape,
    onToggleFocused,
    onTakeoverFocused,
    onClearLog,
    onCycleFocus,
    handle,
  }
}
