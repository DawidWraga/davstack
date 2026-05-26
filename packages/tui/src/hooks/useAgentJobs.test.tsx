// Hook test for useAgentJobs: fixture jobs dir under tmp OPEN_AGENTS_HOME,
// ink-testing-library probe, mtime poll refresh.

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import React from "react"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { render } from "ink-testing-library"
import { Text } from "ink"

import type { JobRecord } from "@davstack/open-agents/core/jobs"
import { jobsDir } from "@davstack/open-agents/core/paths"

import { useAgentJobs, type UseAgentJobsResult } from "./useAgentJobs.ts"

const origHome = process.env.OPEN_AGENTS_HOME
let tmpRoot = ""
let repoPath = ""

beforeEach(async () => {
  vi.useFakeTimers()
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "davstack-tui-jobs-"))
  process.env.OPEN_AGENTS_HOME = tmpRoot
  repoPath = path.join(tmpRoot, "repo")
  await fs.mkdir(repoPath, { recursive: true })
})

afterEach(async () => {
  vi.useRealTimers()
  if (origHome === undefined) delete process.env.OPEN_AGENTS_HOME
  else process.env.OPEN_AGENTS_HOME = origHome
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

async function writeJob(opts: {
  id: string
  status?: JobRecord["status"]
  startedAt?: string
  model?: string
}): Promise<void> {
  const dir = jobsDir(repoPath)
  await fs.mkdir(dir, { recursive: true })
  const record: JobRecord = {
    id: opts.id,
    repoPath,
    prompt: "fixture prompt",
    model: opts.model ?? "composer-2.5",
    status: opts.status ?? "done",
    startedAt: opts.startedAt ?? new Date().toISOString(),
    rawLogPath: path.join(dir, "logs", `${opts.id}.ndjson`),
  }
  await fs.writeFile(path.join(dir, `${opts.id}.json`), JSON.stringify(record, null, 2))
}

function Probe({
  onRender,
}: {
  onRender: (r: UseAgentJobsResult) => void
}): React.ReactElement {
  const r = useAgentJobs(repoPath)
  onRender(r)
  return React.createElement(Text, null, `n=${r.jobs.length}`)
}

let active: ReturnType<typeof render> | null = null
afterEach(() => {
  active?.unmount()
  active = null
})

async function flush(): Promise<void> {
  await Promise.resolve()
  await vi.runOnlyPendingTimersAsync()
  await Promise.resolve()
}

test("lists fixture jobs from tmp OPEN_AGENTS_HOME jobs dir", async () => {
  await writeJob({ id: "job-a", status: "done", startedAt: "2026-05-26T10:00:00.000Z" })
  await writeJob({ id: "job-b", status: "running", startedAt: "2026-05-26T11:00:00.000Z" })

  let captured: UseAgentJobsResult | null = null
  active = render(
    React.createElement(Probe, {
      onRender: (r) => {
        captured = r
      },
    }),
  )
  await flush()

  expect(captured!.jobs.map((j) => j.id)).toEqual(["job-b", "job-a"])
})

test("returns empty list when jobs dir does not exist yet", async () => {
  let captured: UseAgentJobsResult | null = null
  active = render(
    React.createElement(Probe, {
      onRender: (r) => {
        captured = r
      },
    }),
  )
  await flush()
  expect(captured!.jobs).toEqual([])
})

test("mtime poll picks up a newly written job", async () => {
  await writeJob({ id: "job-1" })
  let captured: UseAgentJobsResult | null = null
  active = render(
    React.createElement(Probe, {
      onRender: (r) => {
        captured = r
      },
    }),
  )
  await flush()
  expect(captured!.jobs).toHaveLength(1)

  await writeJob({ id: "job-2", status: "running" })
  const dir = jobsDir(repoPath)
  const now = new Date()
  await fs.utimes(dir, now, now)

  await vi.advanceTimersByTimeAsync(500)
  await flush()

  expect(captured!.jobs.map((j) => j.id).sort()).toEqual(["job-1", "job-2"])
})

test("ignores non-job json files in the jobs dir", async () => {
  const dir = jobsDir(repoPath)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, "README.json"), '{"nope":true}', "utf8")
  await writeJob({ id: "job-only" })

  let captured: UseAgentJobsResult | null = null
  active = render(
    React.createElement(Probe, {
      onRender: (r) => {
        captured = r
      },
    }),
  )
  await flush()

  expect(captured!.jobs.map((j) => j.id)).toEqual(["job-only"])
})
