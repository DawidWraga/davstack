// Tracks which view is rendered (daemon list vs a single daemon's logs)
// and which row in the list has focus. Pattern: useViewInner -> Provider
// -> useView, see docs/react/client-state-management.mdx for rationale.

import React, { createContext, useCallback, useContext, useState, type ReactNode } from "react"

import type { DaemonKey } from "../lib/daemon-registry.ts"

export type View =
  | { kind: "list" }
  | { kind: "log"; key: DaemonKey }
  | { kind: "agents" }
  | { kind: "agent"; id: string }

function useViewInner() {
  const [view, setView] = useState<View>({ kind: "list" })
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [highlightedAgentId, setHighlightedAgentId] = useState<string | undefined>(undefined)

  const showList = useCallback(() => setView({ kind: "list" }), [])
  const showLog = useCallback((key: DaemonKey) => setView({ kind: "log", key }), [])
  const showAgents = useCallback(() => setView({ kind: "agents" }), [])
  const showAgent = useCallback((id: string) => setView({ kind: "agent", id }), [])

  return {
    view,
    focusedIdx,
    setFocusedIdx,
    highlightedAgentId,
    setHighlightedAgentId,
    showList,
    showLog,
    showAgents,
    showAgent,
  }
}

type ViewContextValue = ReturnType<typeof useViewInner>
const ViewContext = createContext<ViewContextValue | undefined>(undefined)

export function ViewProvider({ children }: { children: ReactNode }) {
  return <ViewContext.Provider value={useViewInner()}>{children}</ViewContext.Provider>
}

export function useView(): ViewContextValue {
  const value = useContext(ViewContext)
  if (!value) throw new Error("useView must be used within a ViewProvider")
  return value
}
