import type { JobRecord } from "@davstack/open-agents/core/jobs"

export function inferAdapter(model: string): string {
  const m = model.toLowerCase()
  if (m.startsWith("gemini-")) return "gemini"
  if (m.startsWith("composer-") || m.startsWith("cursor-")) return "cursor"
  return "cursor"
}

export function jobIdSuffix(id: string): string {
  const parts = id.split("-")
  return parts[parts.length - 1] ?? id
}

export function formatAgentPillLabel(job: JobRecord): string {
  const tag = job.edit ? "edit" : "explore"
  return `${tag}:${jobIdSuffix(job.id)}`
}

export function getRunningPillJobs(jobs: JobRecord[], limit = 5): JobRecord[] {
  return jobs
    .filter((j) => j.status === "running")
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, limit)
}
