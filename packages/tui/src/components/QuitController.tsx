// Owns the cascade-shutdown flow. SIGINT / SIGTERM / `q` / Ctrl-C all
// converge on `quit()` (re-entry is a no-op). Children get `quitting`
// to render a status indicator and `quit` to trigger shutdown.

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useApp } from "ink"

import { useDaemons, type DaemonRow } from "../state/daemons-context.tsx"

function isSettled(s: DaemonRow["status"]): boolean {
  return s === "idle" || s === "exited" || s === "crashed" || s === "blocked"
}

interface QuitControllerProps {
  children: (api: { quit: () => void; quitting: boolean }) => ReactNode
}

export function QuitController({ children }: QuitControllerProps) {
  const { exit } = useApp()
  const { rowsRef, stopAll } = useDaemons()
  const [quitting, setQuitting] = useState(false)
  const quittingRef = useRef(false)

  const quit = useCallback(() => {
    if (quittingRef.current) return
    quittingRef.current = true
    setQuitting(true)
    stopAll()

    // Hard cap: 2.5s. Beyond that, exit regardless — useDaemonProcess
    // escalates SIGTERM -> SIGKILL by 2.0s and global-teardown's
    // process.on('exit') is the safety net.
    const start = Date.now()
    const poll = (): void => {
      if (rowsRef.current.every((r) => isSettled(r.status)) || Date.now() - start > 2_500) {
        exit()
        return
      }
      setTimeout(poll, 100)
    }
    poll()
  }, [exit, rowsRef, stopAll])

  useEffect(() => {
    const onSig = (): void => quit()
    process.on("SIGINT", onSig)
    process.on("SIGTERM", onSig)
    return () => {
      process.off("SIGINT", onSig)
      process.off("SIGTERM", onSig)
    }
  }, [quit])

  // Non-TTY stdin fallback: piped stdin can't go through useInput so we
  // listen for a bare `q` byte for external test drivers / CI.
  useEffect(() => {
    const rawModeSupported = process.stdin.isTTY === true
    if (rawModeSupported) return
    const onData = (chunk: Buffer): void => {
      if (chunk.includes(0x71)) quit() // 'q'
    }
    process.stdin.on("data", onData)
    return () => {
      process.stdin.off("data", onData)
    }
  }, [quit])

  return <>{children({ quit, quitting })}</>
}
