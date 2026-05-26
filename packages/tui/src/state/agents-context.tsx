import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react"

import type { JobRecord } from "@davstack/open-agents/core/jobs"
import { useAgentJobs } from "../hooks/useAgentJobs.ts"
import { getRepoRootSafe } from "../lib/package-info.ts"

export type AgentPane = "spec" | "logs" | "diff"

interface AgentsContextValue {
  jobs: JobRecord[]
  agentPane: AgentPane
  setAgentPane: (pane: AgentPane) => void
  registerTimelineClear: (fn: (() => void) | null) => void
  clearAgentTimeline: () => void
}

const AgentsContext = createContext<AgentsContextValue | undefined>(undefined)

export function AgentsProvider({ children }: { children: ReactNode }): React.ReactElement {
  const repoPath = getRepoRootSafe()
  const { jobs } = useAgentJobs(repoPath)
  const clearRef = useRef<(() => void) | null>(null)
  const [agentPane, setAgentPane] = useState<AgentPane>("spec")

  const registerTimelineClear = useCallback((fn: (() => void) | null) => {
    clearRef.current = fn
  }, [])

  const clearAgentTimeline = useCallback(() => {
    clearRef.current?.()
  }, [])

  return (
    <AgentsContext.Provider
      value={{
        jobs,
        agentPane,
        setAgentPane,
        registerTimelineClear,
        clearAgentTimeline,
      }}
    >
      {children}
    </AgentsContext.Provider>
  )
}

export function useAgents(): AgentsContextValue {
  const value = useContext(AgentsContext)
  if (!value) throw new Error("useAgents must be used within an AgentsProvider")
  return value
}
