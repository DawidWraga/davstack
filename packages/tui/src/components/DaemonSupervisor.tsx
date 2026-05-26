// One <DaemonSupervisor> per descriptor. Wraps useDaemonProcess and
// publishes its state + controls into the daemons context. Renders
// nothing — it's purely a behavioural component.

import { useEffect, useRef } from "react"

import { useDaemonProcess } from "../hooks/useDaemonProcess.ts"
import { useDaemons } from "../state/daemons-context.tsx"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

interface DaemonSupervisorProps {
  descriptor: DaemonDescriptor
  autoStart: boolean
}

export function DaemonSupervisor({
  descriptor,
  autoStart,
}: DaemonSupervisorProps): null {
  const proc = useDaemonProcess(descriptor)
  const { registerRow, registerControls } = useDaemons()
  const startedRef = useRef(false)

  useEffect(() => {
    registerControls(descriptor.key, {
      start: proc.start,
      stop: proc.stop,
      takeover: proc.takeover,
      clear: proc.clear,
    })
  }, [descriptor.key, proc.start, proc.stop, proc.takeover, proc.clear, registerControls])

  useEffect(() => {
    if (autoStart && !startedRef.current) {
      startedRef.current = true
      proc.start()
    }
  }, [autoStart, proc])

  useEffect(() => {
    registerRow({
      descriptor,
      status: proc.status,
      lines: proc.lines,
      exitCode: proc.exitCode,
    })
  }, [descriptor, proc.status, proc.lines, proc.exitCode, registerRow])

  return null
}
