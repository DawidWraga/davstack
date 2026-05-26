import { spawn } from "node:child_process"

import type { JobRecord } from "@davstack/open-agents/core/jobs"

// Render the diff for a job's filesChanged list by shelling out to git.
// Async + non-blocking so the render thread isn't stalled while git
// runs (Ink can otherwise leave the previous pane's frame on screen
// for hundreds of ms). Uses `git diff HEAD -- <files>` so unstaged +
// staged changes both show. Empty stdout means the agent's edits were
// already committed — callers should fall back to the file list.
export function readAgentDiff(job: JobRecord): Promise<{ diff: string; files: string[] }> {
  const files = job.filesChanged ?? []
  if (files.length === 0) return Promise.resolve({ diff: "", files: [] })
  return new Promise((resolve) => {
    const proc = spawn("git", ["diff", "--no-color", "HEAD", "--", ...files], {
      cwd: job.repoPath,
      windowsHide: true,
    })
    const chunks: Buffer[] = []
    proc.stdout?.on("data", (b: Buffer) => chunks.push(b))
    proc.once("error", () => resolve({ diff: "", files }))
    proc.once("close", () => {
      const diff = Buffer.concat(chunks).toString("utf8")
      resolve({ diff, files })
    })
  })
}
