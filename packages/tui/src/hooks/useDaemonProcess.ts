// Owns one supervised ChildProcess for one DaemonDescriptor.
//
// Lifecycle:
//   idle -> starting -> running   (after stdout matches readyRegex)
//   running -> exiting -> exited  (after stop() resolves cleanly)
//   idle   -> blocked             (port-probe found external listener)
//   * -> crashed                  (exit code non-zero / signal != SIGTERM)
//
// Cleanup: on unmount, stop() is invoked. The killTree module handles
// Windows process-tree teardown so we don't orphan bun grandchildren.

import { useCallback, useEffect, useRef, useState } from "react"
import type { ChildProcess } from "node:child_process"

import { useRingBuffer, type LogLine } from "./useRingBuffer.ts"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"
import { killTree as defaultKillTree } from "../lib/kill-tree.ts"
import { probePort as defaultProbePort } from "../lib/port-probe.ts"
import {
  registerChild as defaultRegisterChild,
  unregisterChild as defaultUnregisterChild,
} from "../lib/global-teardown.ts"

export type DaemonStatus =
  | "idle"
  | "starting"
  | "running"
  | "exiting"
  | "exited"
  | "crashed"
  | "blocked"

export type UseDaemonProcessResult = {
  status: DaemonStatus
  lines: LogLine[]
  start: () => void
  stop: () => void
  exitCode: number | null
}

// Injection seam — tests override these so they don't actually shell out
// or open sockets.
export type UseDaemonProcessDeps = {
  killTree?: (pid: number, signal: "SIGTERM" | "SIGKILL") => Promise<void>
  probePort?: (host: string, port: number, timeoutMs?: number) => Promise<boolean>
  registerChild?: (pid: number) => void
  unregisterChild?: (pid: number) => void
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

export function useDaemonProcess(
  descriptor: DaemonDescriptor,
  deps: UseDaemonProcessDeps = {},
): UseDaemonProcessResult {
  const killTree = deps.killTree ?? defaultKillTree
  const probePort = deps.probePort ?? defaultProbePort
  const registerChild = deps.registerChild ?? defaultRegisterChild
  const unregisterChild = deps.unregisterChild ?? defaultUnregisterChild

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

    const host = descriptor.host ?? "127.0.0.1"

    const doSpawn = (): void => {
      const child = descriptor.spawn()
      childRef.current = child
      if (typeof child.pid === "number") registerChild(child.pid)

      let outBuf = ""
      let errBuf = ""

      const handleLine = (stream: "out" | "err", text: string): void => {
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
        if (typeof child.pid === "number") unregisterChild(child.pid)
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
        if (typeof child.pid === "number") unregisterChild(child.pid)
        childRef.current = null
        clearKillTimer()

        const stopping = stoppingRef.current
        // On Windows, taskkill /F sets code != 0 and signal === null even
        // though we asked for the kill — treat any exit during stop() as
        // intentional ("exited"), only mark "crashed" for unprompted death.
        const clean = code === 0 || stopping
        setStatus(clean ? "exited" : "crashed")
      })
    }

    // Port preflight — refuse to spawn if something else is listening.
    void (async (): Promise<void> => {
      const inUse = await probePort(host, descriptor.port)
      if (inUse) {
        push({
          ts: Date.now(),
          stream: "err",
          text: `port ${descriptor.port} already in use — refusing to spawn`,
        })
        setStatus("blocked")
        return
      }
      doSpawn()
    })()
  }, [descriptor, push, clearKillTimer, probePort, registerChild, unregisterChild])

  const stop = useCallback(() => {
    const child = childRef.current
    if (!child) return
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStatus("exiting")
    const pid = child.pid
    if (typeof pid === "number") {
      void killTree(pid, "SIGTERM")
    }
    killTimerRef.current = setTimeout(() => {
      const c = childRef.current
      if (c && typeof c.pid === "number") {
        void killTree(c.pid, "SIGKILL")
      }
    }, KILL_GRACE_MS)
  }, [killTree])

  useEffect(() => {
    return () => {
      stop()
    }
  }, [stop])

  return { status, lines, start, stop, exitCode }
}
