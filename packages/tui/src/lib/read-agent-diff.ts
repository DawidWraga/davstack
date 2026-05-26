import { spawnSync } from "node:child_process"

import type { JobRecord } from "@davstack/open-agents/core/jobs"

// Render the diff for a job's filesChanged list by shelling out to git.
// Uses `git diff HEAD -- <files>` so unstaged + staged changes both show.
// If the agent's changes were already committed, the diff will be empty —
// callers should treat empty output as "no diff" and show the file list.
export function readAgentDiff(job: JobRecord): { diff: string; files: string[] } {
  const files = job.filesChanged ?? []
  if (files.length === 0) return { diff: "", files: [] }
  const res = spawnSync("git", ["diff", "--no-color", "HEAD", "--", ...files], {
    cwd: job.repoPath,
    encoding: "utf8",
    windowsHide: true,
  })
  if (res.error || res.status !== 0) {
    return { diff: "", files }
  }
  return { diff: res.stdout ?? "", files }
}
