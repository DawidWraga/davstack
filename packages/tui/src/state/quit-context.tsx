// Tracks the "confirm-before-quit" overlay state. Kept separate from
// QuitController so the dispatcher (useHotkeys) can read `confirming`
// without depending on the cascade-shutdown wiring.

import React, { createContext, useCallback, useContext, useState, type ReactNode } from "react"

function useQuitInner() {
  const [confirming, setConfirming] = useState(false)

  const requestConfirm = useCallback(() => setConfirming(true), [])
  const cancelConfirm = useCallback(() => setConfirming(false), [])

  return { confirming, requestConfirm, cancelConfirm }
}

type QuitContextValue = ReturnType<typeof useQuitInner>
const QuitContext = createContext<QuitContextValue | undefined>(undefined)

export function QuitProvider({ children }: { children: ReactNode }) {
  return <QuitContext.Provider value={useQuitInner()}>{children}</QuitContext.Provider>
}

export function useQuit(): QuitContextValue {
  const value = useContext(QuitContext)
  if (!value) throw new Error("useQuit must be used within a QuitProvider")
  return value
}
