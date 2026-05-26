// Tracks which view is rendered (daemon list vs a single daemon's logs)
// and which row in the list has focus. Pattern: useViewInner -> Provider
// -> useView, see docs/react/client-state-management.mdx for rationale.

import React, { createContext, useCallback, useContext, useState, type ReactNode } from "react"

import type { DaemonKey } from "../lib/daemon-registry.ts"

export type View = { kind: "list" } | { kind: "log"; key: DaemonKey } | { kind: "agents" }

function useViewInner() {
  const [view, setView] = useState<View>({ kind: "list" })
  const [focusedIdx, setFocusedIdx] = useState(0)

  const showList = useCallback(() => setView({ kind: "list" }), [])
  const showLog = useCallback((key: DaemonKey) => setView({ kind: "log", key }), [])
  const showAgents = useCallback(() => setView({ kind: "agents" }), [])

  return { view, focusedIdx, setFocusedIdx, showList, showLog, showAgents }
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
