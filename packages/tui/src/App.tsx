// Ink root component for `davstack start`. Owns the daemon supervisors,
// view router, and the global quit flow. The daemon registry is injected
// (defaulting to the real one) so tests can substitute fakes.

import React, { useEffect, useRef, useState } from "react"
import { Box, Text, useApp, useInput } from "ink"

import { daemonRegistry, type DaemonDescriptor, type DaemonKey } from "./lib/daemon-registry.ts"
import { useDaemonProcess } from "./hooks/useDaemonProcess.ts"
import { ServerList, type DaemonRow } from "./views/ServerList.tsx"
import { ServerLogView } from "./views/ServerLogView.tsx"
import { StatusBar, type DaemonPill, type DaemonStatus as PillStatus } from "./components/StatusBar.tsx"

type View = { kind: "list" } | { kind: "log"; key: DaemonKey }

interface AppProps {
  registry?: DaemonDescriptor[]
  // When true, daemons are NOT auto-started on mount. Tests use this.
  autoStart?: boolean
}

// Per-daemon supervisor wrapper. One instance per descriptor so the hook's
// rules-of-hooks invariants stay satisfied across the dynamic registry.
function DaemonSupervisor({
  descriptor,
  autoStart,
  onUpdate,
}: {
  descriptor: DaemonDescriptor
  autoStart: boolean
  onUpdate: (row: DaemonRow, stop: () => void) => void
}): null {
  const proc = useDaemonProcess(descriptor)
  const startedRef = useRef(false)

  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true
      proc.start()
    }
  }, [autoStart, proc])

  useEffect(() => {
    onUpdate(
      { descriptor, status: proc.status, lines: proc.lines },
      proc.stop,
    )
  }, [descriptor, proc.status, proc.lines, proc.stop, onUpdate])

  return null
}

function statusToPill(s: DaemonRow["status"]): PillStatus {
  if (s === "running") return "running"
  if (s === "crashed") return "crashed"
  return "not-running"
}

export function App({ registry = daemonRegistry, autoStart = true }: AppProps): React.ReactElement {
  const { exit } = useApp()
  const [view, setView] = useState<View>({ kind: "list" })
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [rows, setRows] = useState<DaemonRow[]>(() =>
    registry.map((d) => ({ descriptor: d, status: "idle" as const, lines: [] })),
  )
  const stopFnsRef = useRef<Map<DaemonKey, () => void>>(new Map())
  const [quitting, setQuitting] = useState(false)
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  const updateRow = React.useCallback((row: DaemonRow, stop: () => void) => {
    stopFnsRef.current.set(row.descriptor.key, stop)
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.descriptor.key === row.descriptor.key)
      if (idx === -1) return prev
      // Avoid no-op re-renders.
      const cur = prev[idx]
      if (cur.status === row.status && cur.lines === row.lines) return prev
      const next = prev.slice()
      next[idx] = row
      return next
    })
  }, [])

  const triggerQuit = React.useCallback(() => {
    if (quitting) return
    setQuitting(true)
    for (const stop of stopFnsRef.current.values()) {
      stop()
    }
    // Hard cap: 2.5s. After that, exit regardless — useDaemonProcess will
    // have escalated SIGTERM -> SIGKILL by 2.0s.
    const allExited = () =>
      rowsRef.current.every(
        (r) => r.status === "idle" || r.status === "exited" || r.status === "crashed",
      )
    const start = Date.now()
    const poll = (): void => {
      if (allExited() || Date.now() - start > 2_500) {
        exit()
        return
      }
      setTimeout(poll, 100)
    }
    poll()
  }, [quitting, exit])

  // Gate useInput on raw-mode support — when stdin is piped (CI, smoke
  // tests) Ink throws on raw-mode setup. In that case the user can still
  // SIGINT to quit; ServerList's input hook will also no-op.
  const rawModeSupported = process.stdin.isTTY === true
  useInput(
    (input) => {
      if (input === "q") triggerQuit()
    },
    { isActive: rawModeSupported },
  )

  useEffect(() => {
    const onSig = (): void => triggerQuit()
    process.on("SIGINT", onSig)
    process.on("SIGTERM", onSig)
    return () => {
      process.off("SIGINT", onSig)
      process.off("SIGTERM", onSig)
    }
  }, [triggerQuit])

  const pills: DaemonPill[] = rows.map((r, i) => ({
    key: String(i + 1),
    label: r.descriptor.label,
    status: statusToPill(r.status),
  }))

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold>davstack</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {registry.map((d) => (
          <DaemonSupervisor
            key={d.key}
            descriptor={d}
            autoStart={autoStart}
            onUpdate={updateRow}
          />
        ))}
        {view.kind === "list" ? (
          <ServerList
            rows={rows}
            focusedIdx={focusedIdx}
            onFocusChange={setFocusedIdx}
            onSelect={(i) => setView({ kind: "log", key: rows[i].descriptor.key })}
          />
        ) : (
          (() => {
            const row = rows.find((r) => r.descriptor.key === view.key)
            if (!row) return <Text>missing daemon: {view.key}</Text>
            return (
              <ServerLogView
                descriptor={row.descriptor}
                status={row.status}
                lines={row.lines}
                onBack={() => setView({ kind: "list" })}
              />
            )
          })()
        )}
      </Box>
      <Box marginTop={1}>
        <StatusBar daemons={pills} />
      </Box>
      {quitting ? (
        <Box marginTop={1}>
          <Text dimColor>shutting down daemons…</Text>
        </Box>
      ) : null}
    </Box>
  )
}
