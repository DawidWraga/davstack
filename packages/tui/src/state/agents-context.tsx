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

export type AgentPopoverKind = "result" | "spec"

interface AgentsContextValue {
  jobs: JobRecord[]
  agentPopover: AgentPopoverKind | null
  setAgentPopover: (kind: AgentPopoverKind | null) => void
  registerTimelineClear: (fn: (() => void) | null) => void
  clearAgentTimeline: () => void
}

const AgentsContext = createContext<AgentsContextValue | undefined>(undefined)

export function AgentsProvider({ children }: { children: ReactNode }): React.ReactElement {
  const repoPath = getRepoRootSafe()
  const { jobs } = useAgentJobs(repoPath)
  const clearRef = useRef<(() => void) | null>(null)
  const [agentPopover, setAgentPopover] = useState<AgentPopoverKind | null>(null)

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
        agentPopover,
        setAgentPopover,
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
