import fs from "node:fs"
import { join } from "node:path"

import { readDeliverable } from "@davstack/open-agents/core/deliverable"
import type { JobRecord } from "@davstack/open-agents/core/jobs"
import { jobsDir } from "@davstack/open-agents/core/paths"
import type { AgentAdapter } from "@davstack/open-agents/adapters/types"

export function readAgentSpecContent(opts: {
  repoPath: string
  jobId: string
}): string | null {
  const path = join(jobsDir(opts.repoPath), `${opts.jobId}.spec.md`)
  if (!fs.existsSync(path)) return null
  return fs.readFileSync(path, "utf8")
}

export function readAgentResultContent(opts: {
  adapter: AgentAdapter
  job: JobRecord
}): string {
  return readDeliverable(opts.adapter, opts.job)
}
