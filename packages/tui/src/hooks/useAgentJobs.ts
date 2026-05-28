import fs from "node:fs"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { listJobs, type JobRecord } from "@davstack/open-agents/core/jobs"
import { jobsDir } from "@davstack/open-agents/core/paths"

export interface UseAgentJobsResult {
  jobs: JobRecord[]
  refresh: () => void
}

function jobStableKey(j: JobRecord): string {
  return `${j.id}:${j.status}:${j.finishedAt ?? ""}`
}

export function useAgentJobs(repoPath: string): UseAgentJobsResult {
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [tick, setTick] = useState(0)
  const lastMtimeRef = useRef(0)
  const lastKeysRef = useRef("")

  useEffect(() => {
    const id = setInterval(() => {
      try {
        const st = fs.statSync(jobsDir(repoPath))
        const m = st.mtimeMs
        if (m === lastMtimeRef.current) return
        lastMtimeRef.current = m
        setTick((t) => t + 1)
      } catch {
        /* dir not yet created */
      }
    }, 500)
    return () => clearInterval(id)
  }, [repoPath])

  useEffect(() => {
    const next = listJobs(repoPath, { limit: 20 })
    const keys = next.map(jobStableKey).join("|")
    if (keys === lastKeysRef.current) return
    lastKeysRef.current = keys
    setJobs(next)
  }, [repoPath, tick])

  const refresh = useCallback(() => {
    // Force a re-read: invalidate the mtime + keys caches so the next
    // listJobs always runs even if the directory mtime is stale.
    lastMtimeRef.current = 0
    lastKeysRef.current = ""
    setTick((t) => t + 1)
  }, [])

  const sorted = useMemo(() => sortAgentJobs(jobs), [jobs])

  return { jobs: sorted, refresh }
}

function sortAgentJobs(jobs: JobRecord[]): JobRecord[] {
  const running = jobs.filter((j) => j.status === "running")
  const rest = jobs.filter((j) => j.status !== "running")
  return [...running, ...rest]
}
