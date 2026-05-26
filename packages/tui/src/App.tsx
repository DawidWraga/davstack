// Composition root for `davstack start`. Wires up providers, supervisors
// and view components — keeps no logic of its own beyond glue.

import React, { useEffect } from "react"
import { Box, Text } from "ink"

import { daemonRegistry, type DaemonDescriptor } from "./lib/daemon-registry.ts"
import { installGlobalTeardown } from "./lib/global-teardown.ts"

import { ViewProvider } from "./state/view-context.tsx"
import { AgentsProvider } from "./state/agents-context.tsx"
import { DaemonsProvider } from "./state/daemons-context.tsx"
import { QuitProvider, useQuit } from "./state/quit-context.tsx"

import { DaemonSupervisor } from "./components/DaemonSupervisor.tsx"
import { DescriptorSync } from "./components/DescriptorSync.tsx"
import { GlobalHotkeys } from "./components/GlobalHotkeys.tsx"
import { QuitController } from "./components/QuitController.tsx"
import { MainView } from "./components/MainView.tsx"
import { BottomBar } from "./components/BottomBar.tsx"
import { QuitConfirm } from "./components/QuitConfirm.tsx"

import { useConfigDiscovery } from "./hooks/useConfigDiscovery.ts"

interface AppProps {
  registry?: DaemonDescriptor[]
  // When false, daemons are NOT auto-started on mount. Tests use this.
  autoStart?: boolean
  // When true, skip the .davstack/config discovery filter. Tests pass a
  // pre-filtered registry directly.
  skipConfigDiscovery?: boolean
}

export function App({
  registry = daemonRegistry,
  autoStart = true,
  skipConfigDiscovery = false,
}: AppProps): React.ReactElement {
  // Install the process-level emergency teardown once. Idempotent.
  useEffect(() => {
    installGlobalTeardown()
  }, [])

  const { done, filtered } = useConfigDiscovery(registry, skipConfigDiscovery)

  return (
    <ViewProvider>
      <AgentsProvider>
        <DaemonsProvider descriptors={filtered}>
        <QuitProvider>
          <DescriptorSync descriptors={filtered} />
          {filtered.map((d) => (
            <DaemonSupervisor key={d.key} descriptor={d} autoStart={autoStart} />
          ))}
          <QuitController>
            {({ quit, quitting }) => (
              <AppFrame
                quit={quit}
                quitting={quitting}
                done={done}
                hasAnyDaemon={filtered.length > 0}
              />
            )}
          </QuitController>
        </QuitProvider>
        </DaemonsProvider>
      </AgentsProvider>
    </ViewProvider>
  )
}

// Inner frame — pulled out so it can `useQuit()` (which requires being
// inside QuitProvider). Renders the confirm overlay when active.
function AppFrame({
  quit,
  quitting,
  done,
  hasAnyDaemon,
}: {
  quit: () => void
  quitting: boolean
  done: boolean
  hasAnyDaemon: boolean
}): React.ReactElement {
  const { confirming } = useQuit()
  return (
    <Box flexDirection="column">
      <GlobalHotkeys onQuit={quit} />
      <Box>
        <Text bold>davstack</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <MainView discoveryDone={done} hasAnyDaemon={hasAnyDaemon} />
      </Box>
      <Box marginTop={1}>
        <BottomBar />
      </Box>
      {confirming ? <QuitConfirm /> : null}
      {quitting ? (
        <Box marginTop={1}>
          <Text dimColor>shutting down daemons…</Text>
        </Box>
      ) : null}
    </Box>
  )
}
