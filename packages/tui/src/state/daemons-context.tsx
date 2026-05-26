// Holds the live row state (status, lines, exit code) for every daemon
// plus a controls registry that maps DaemonKey -> {start, stop}.
//
// Why not just useDaemonProcess inside this provider?
// Each daemon needs its own hook call. Rules-of-hooks forbid calling
// `useDaemonProcess(d)` in a loop where `d` may vary. We keep one
// <DaemonSupervisor descriptor={d} /> child per descriptor and have it
// publish state up via `registerRow` / `registerControls`.

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type { LogLine } from "../hooks/useRingBuffer.ts"
import type { DaemonStatus } from "../hooks/useDaemonProcess.ts"
import type { DaemonDescriptor, DaemonKey } from "../lib/daemon-registry.ts"

export type DaemonRow = {
  descriptor: DaemonDescriptor
  status: DaemonStatus
  lines: LogLine[]
  exitCode?: number | null
}

export type DaemonControls = {
  start: () => void
  stop: () => void
  takeover?: () => void
  clear?: () => void
}

function makeInitialRow(descriptor: DaemonDescriptor): DaemonRow {
  return { descriptor, status: "idle", lines: [], exitCode: null }
}

function useDaemonsInner(descriptors: DaemonDescriptor[]) {
  const [rows, setRows] = useState<DaemonRow[]>(() => descriptors.map(makeInitialRow))
  const controlsRef = useRef<Map<DaemonKey, DaemonControls>>(new Map())
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  // Keep rows aligned with descriptors when discovery resolves later.
  // We do this in a layout-ish callback (the parent invokes it after the
  // discovery effect resolves) rather than auto-syncing here, to keep the
  // provider passive — easier to reason about in tests.
  const syncDescriptors = useCallback((next: DaemonDescriptor[]) => {
    setRows((prev) => {
      const byKey = new Map(prev.map((r) => [r.descriptor.key, r] as const))
      return next.map((d) => byKey.get(d.key) ?? makeInitialRow(d))
    })
  }, [])

  const registerRow = useCallback((row: DaemonRow) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.descriptor.key === row.descriptor.key)
      if (idx === -1) return prev
      const cur = prev[idx]
      // Skip no-op updates to avoid React rerender churn.
      if (
        cur.status === row.status &&
        cur.lines === row.lines &&
        cur.exitCode === row.exitCode
      ) {
        return prev
      }
      const next = prev.slice()
      next[idx] = row
      return next
    })
  }, [])

  const registerControls = useCallback((key: DaemonKey, controls: DaemonControls) => {
    controlsRef.current.set(key, controls)
  }, [])

  const toggleByKey = useCallback((key: DaemonKey) => {
    const row = rowsRef.current.find((r) => r.descriptor.key === key)
    if (!row) return
    const controls = controlsRef.current.get(key)
    if (!controls) return
    if (row.status === "running" || row.status === "starting") controls.stop()
    else controls.start()
  }, [])

  const stopAll = useCallback(() => {
    for (const controls of controlsRef.current.values()) controls.stop()
  }, [])

  const clearByKey = useCallback((key: DaemonKey) => {
    const controls = controlsRef.current.get(key)
    controls?.clear?.()
  }, [])

  const takeoverByKey = useCallback((key: DaemonKey) => {
    const row = rowsRef.current.find((r) => r.descriptor.key === key)
    if (!row || row.status !== "blocked") return
    const controls = controlsRef.current.get(key)
    controls?.takeover?.()
  }, [])

  const anyLive = useCallback(() => {
    return rowsRef.current.some((r) => r.status === "running" || r.status === "starting")
  }, [])

  return useMemo(
    () => ({
      rows,
      rowsRef,
      syncDescriptors,
      registerRow,
      registerControls,
      toggleByKey,
      stopAll,
      clearByKey,
      takeoverByKey,
      anyLive,
    }),
    [rows, syncDescriptors, registerRow, registerControls, toggleByKey, stopAll, clearByKey, takeoverByKey, anyLive],
  )
}

type DaemonsContextValue = ReturnType<typeof useDaemonsInner>
const DaemonsContext = createContext<DaemonsContextValue | undefined>(undefined)

export function DaemonsProvider({
  descriptors,
  children,
}: {
  descriptors: DaemonDescriptor[]
  children: ReactNode
}) {
  return (
    <DaemonsContext.Provider value={useDaemonsInner(descriptors)}>
      {children}
    </DaemonsContext.Provider>
  )
}

export function useDaemons(): DaemonsContextValue {
  const value = useContext(DaemonsContext)
  if (!value) throw new Error("useDaemons must be used within a DaemonsProvider")
  return value
}
