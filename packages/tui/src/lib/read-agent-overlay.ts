import fs from "node:fs"
import { join } from "node:path"

import { jobsDir } from "@davstack/open-agents/core/paths"

export function readAgentSpecContent(opts: {
  repoPath: string
  jobId: string
}): string | null {
  const path = join(jobsDir(opts.repoPath), `${opts.jobId}.spec.md`)
  if (!fs.existsSync(path)) return null
  return fs.readFileSync(path, "utf8")
}
