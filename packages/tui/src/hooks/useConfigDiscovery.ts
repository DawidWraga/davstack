// One-shot config discovery: scans the repo's .davstack/config dir to
// determine which daemons are enabled, returns the filtered registry.
// `skip` is a test-only escape hatch — when true, every descriptor in
// the registry is considered enabled and discovery is bypassed.

import { useEffect, useMemo, useState } from "react"

import { findRepoRoot } from "../lib/repo-root.ts"
import { discoverEnabledDaemons } from "../lib/config-discovery.ts"
import type { DaemonDescriptor, DaemonKey } from "../lib/daemon-registry.ts"

export interface ConfigDiscoveryResult {
  // true = discovery finished (even if 0 enabled). false = still loading.
  done: boolean
  filtered: DaemonDescriptor[]
}

export function useConfigDiscovery(
  registry: DaemonDescriptor[],
  skip: boolean,
): ConfigDiscoveryResult {
  const [enabledKeys, setEnabledKeys] = useState<Set<DaemonKey> | null>(
    skip ? new Set(registry.map((d) => d.key)) : null,
  )

  useEffect(() => {
    if (skip) return
    let cancelled = false
    void (async (): Promise<void> => {
      try {
        const repoRoot = findRepoRoot(process.cwd())
        const enabled = await discoverEnabledDaemons(repoRoot)
        if (!cancelled) setEnabledKeys(enabled)
      } catch {
        // findRepoRoot can throw outside a davstack repo. Treat as "no
        // daemons configured" — App renders the empty state.
        if (!cancelled) setEnabledKeys(new Set())
      }
    })()
    return () => {
      cancelled = true
    }
  }, [skip])

  const filtered = useMemo(
    () => (enabledKeys ? registry.filter((d) => enabledKeys.has(d.key)) : []),
    [registry, enabledKeys],
  )

  return { done: enabledKeys !== null, filtered }
}
