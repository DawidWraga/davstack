// Composition root for `davstack start`. Wires up providers, supervisors
// and view components — keeps no logic of its own beyond glue.

import React, { useEffect } from "react"
import { Box, Text } from "ink"

import { daemonRegistry, type DaemonDescriptor } from "./lib/daemon-registry.ts"
import { installGlobalTeardown } from "./lib/global-teardown.ts"

import { ViewProvider } from "./state/view-context.tsx"
import { DaemonsProvider } from "./state/daemons-context.tsx"

import { DaemonSupervisor } from "./components/DaemonSupervisor.tsx"
import { DescriptorSync } from "./components/DescriptorSync.tsx"
import { GlobalHotkeys } from "./components/GlobalHotkeys.tsx"
import { QuitController } from "./components/QuitController.tsx"
import { MainView } from "./components/MainView.tsx"
import { BottomBar } from "./components/BottomBar.tsx"

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
      <DaemonsProvider descriptors={filtered}>
        <DescriptorSync descriptors={filtered} />
        {filtered.map((d) => (
          <DaemonSupervisor key={d.key} descriptor={d} autoStart={autoStart} />
        ))}
        <QuitController>
          {({ quit, quitting }) => (
            <Box flexDirection="column">
              <GlobalHotkeys onQuit={quit} />
              <Box>
                <Text bold>davstack</Text>
              </Box>
              <Box marginTop={1} flexDirection="column">
                <MainView discoveryDone={done} hasAnyDaemon={filtered.length > 0} />
              </Box>
              <Box marginTop={1}>
                <BottomBar />
              </Box>
              {quitting ? (
                <Box marginTop={1}>
                  <Text dimColor>shutting down daemons…</Text>
                </Box>
              ) : null}
            </Box>
          )}
        </QuitController>
      </DaemonsProvider>
    </ViewProvider>
  )
}
