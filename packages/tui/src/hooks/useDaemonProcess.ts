// Owns one supervised ChildProcess for one DaemonDescriptor.
//
// Lifecycle:
//   idle -> starting -> running   (after stdout matches readyRegex)
//   running -> exiting -> exited  (after stop() resolves cleanly)
//   * -> crashed                  (exit code non-zero / signal != SIGTERM)
//
// Cleanup: on unmount, stop() is invoked.

import { useCallback, useEffect, useRef, useState } from "react"
import type { ChildProcess } from "node:child_process"

import { useRingBuffer, type LogLine } from "./useRingBuffer.ts"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

export type DaemonStatus =
  | "idle"
  | "starting"
  | "running"
  | "exiting"
  | "exited"
  | "crashed"

export type UseDaemonProcessResult = {
  status: DaemonStatus
  lines: LogLine[]
  start: () => void
  stop: () => void
  exitCode: number | null
}

const KILL_GRACE_MS = 2_000

// Split incoming chunk into complete lines, buffering the trailing partial
// line for the next chunk. Returns [completeLines, newBuffer].
function splitLines(prev: string, chunk: string): [string[], string] {
  const combined = prev + chunk
  const parts = combined.split(/\r?\n/)
  const trailing = parts.pop() ?? ""
  return [parts, trailing]
}

export function useDaemonProcess(descriptor: DaemonDescriptor): UseDaemonProcessResult {
  const { lines, push } = useRingBuffer(10_000)
  const [status, setStatus] = useState<DaemonStatus>("idle")
  const [exitCode, setExitCode] = useState<number | null>(null)
  const childRef = useRef<ChildProcess | null>(null)
  const killTimerRef = useRef<NodeJS.Timeout | null>(null)
  const readyRef = useRef(false)
  const stoppingRef = useRef(false)

  const clearKillTimer = useCallback(() => {
    if (killTimerRef.current) {
      clearTimeout(killTimerRef.current)
      killTimerRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    if (childRef.current) return
    readyRef.current = false
    stoppingRef.current = false
    setExitCode(null)
    setStatus("starting")

    const child = descriptor.spawn()
    childRef.current = child

    let outBuf = ""
    let errBuf = ""

    const handleLine = (stream: "out" | "err", text: string) => {
      push({ ts: Date.now(), stream, text })
      if (!readyRef.current && descriptor.readyRegex.test(text)) {
        readyRef.current = true
        setStatus("running")
      }
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const [done, rest] = splitLines(outBuf, chunk.toString("utf8"))
      outBuf = rest
      for (const ln of done) handleLine("out", ln)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      const [done, rest] = splitLines(errBuf, chunk.toString("utf8"))
      errBuf = rest
      for (const ln of done) handleLine("err", ln)
    })

    child.on("error", (err) => {
      push({ ts: Date.now(), stream: "err", text: `[spawn error] ${err.message}` })
      setStatus("crashed")
      childRef.current = null
      clearKillTimer()
    })

    child.on("exit", (code, signal) => {
      // Flush any trailing buffered output.
      if (outBuf.length > 0) handleLine("out", outBuf)
      if (errBuf.length > 0) handleLine("err", errBuf)
      outBuf = ""
      errBuf = ""

      setExitCode(code)
      childRef.current = null
      clearKillTimer()

      const stopping = stoppingRef.current
      const clean = code === 0 || (stopping && (signal === "SIGTERM" || signal === "SIGKILL"))
      setStatus(clean ? "exited" : "crashed")
    })
  }, [descriptor, push, clearKillTimer])

  const stop = useCallback(() => {
    const child = childRef.current
    if (!child) return
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStatus("exiting")
    try {
      child.kill("SIGTERM")
    } catch {
      // Already gone — exit handler will clean up.
    }
    killTimerRef.current = setTimeout(() => {
      const c = childRef.current
      if (c) {
        try {
          c.kill("SIGKILL")
        } catch {
          // Already exited between the check and the call.
        }
      }
    }, KILL_GRACE_MS)
  }, [])

  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return { status, lines, start, stop, exitCode }
}
