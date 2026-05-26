import type { JobRecord } from "@davstack/open-agents/core/jobs"
import type { AgentAdapter } from "@davstack/open-agents/adapters/types"
import { cursorAdapter } from "@davstack/open-agents/adapters/cursor"
import { geminiAdapter } from "@davstack/open-agents/adapters/gemini"

export function adapterForJob(job: Pick<JobRecord, "model">): AgentAdapter {
  const m = job.model.toLowerCase()
  if (m.startsWith("gemini-")) return geminiAdapter
  return cursorAdapter
}
