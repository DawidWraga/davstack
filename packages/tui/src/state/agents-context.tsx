import React, { createContext, useContext, type ReactNode } from "react"

import type { JobRecord } from "@davstack/open-agents/core/jobs"
import { useAgentJobs } from "../hooks/useAgentJobs.ts"
import { getRepoRootSafe } from "../lib/package-info.ts"

interface AgentsContextValue {
  jobs: JobRecord[]
}

const AgentsContext = createContext<AgentsContextValue | undefined>(undefined)

export function AgentsProvider({ children }: { children: ReactNode }): React.ReactElement {
  const repoPath = getRepoRootSafe()
  const { jobs } = useAgentJobs(repoPath)
  return <AgentsContext.Provider value={{ jobs }}>{children}</AgentsContext.Provider>
}

export function useAgents(): AgentsContextValue {
  const value = useContext(AgentsContext)
  if (!value) throw new Error("useAgents must be used within an AgentsProvider")
  return value
}
