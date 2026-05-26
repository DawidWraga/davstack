// ServerList now reads from view + daemons contexts. We wrap it in test
// providers to render. The `s` toggle dispatches through the daemons
// context's `toggleByKey`, so we assert at that seam via a controls
// registry spy plumbed through a hidden helper component.

import React, { useEffect } from "react"
import { afterEach, expect, test, vi } from "vitest"
import { render } from "ink-testing-library"

import { ServerList } from "./ServerList.tsx"
import { ViewProvider } from "../state/view-context.tsx"
import { DaemonsProvider, useDaemons, type DaemonRow } from "../state/daemons-context.tsx"
import { AgentsProvider } from "../state/agents-context.tsx"
import { QuitProvider } from "../state/quit-context.tsx"
import type { DaemonDescriptor } from "../lib/daemon-registry.ts"

function makeDescriptor(key: "logs" | "vitest" | "playwright"): DaemonDescriptor {
  return {
    key,
    label: key,
    port: 1000,
    readyRegex: /listening/i,
    spawn: () => {
      throw new Error("not spawned in this test")
    },
  }
}

// Helper that publishes seeded rows + controls into the context after
// mount, mimicking what DaemonSupervisor does in production.
function Seed({
  rows,
  startStop,
}: {
  rows: DaemonRow[]
  startStop?: Record<string, { start: () => void; stop: () => void }>
}): null {
  const { registerRow, registerControls } = useDaemons()
  useEffect(() => {
    for (const row of rows) {
      registerRow(row)
      if (startStop?.[row.descriptor.key]) {
        registerControls(row.descriptor.key, startStop[row.descriptor.key])
      }
    }
  }, [rows, startStop, registerRow, registerControls])
  return null
}

let active: ReturnType<typeof render> | null = null
afterEach(() => {
  active?.unmount()
  active = null
})

test("controls hint is collapsed by default", () => {
  const descriptors = [makeDescriptor("logs")]
  active = render(
    <ViewProvider>
      <AgentsProvider>
        <DaemonsProvider descriptors={descriptors}>
          <QuitProvider>
          <ServerList />
          </QuitProvider>
        </DaemonsProvider>
      </AgentsProvider>
    </ViewProvider>,
  )
  const frame = active.lastFrame() ?? ""
  expect(frame).toContain("c for controls")
  expect(frame).not.toContain("s start/stop")
})

test("renders a row per descriptor with the focus marker on idx 0", () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest")]
  active = render(
    <ViewProvider>
      <AgentsProvider>
        <DaemonsProvider descriptors={descriptors}>
          <QuitProvider>
          <ServerList />
          </QuitProvider>
        </DaemonsProvider>
      </AgentsProvider>
    </ViewProvider>,
  )
  const frame = active.lastFrame() ?? ""
  expect(frame).toContain("› ")
  expect(frame).toContain("logs")
  expect(frame).toContain("vitest")
})

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

test("toggleByKey dispatches stop() for a running daemon", async () => {
  const descriptors = [makeDescriptor("logs"), makeDescriptor("vitest")]
  const stopLogs = vi.fn()
  const startLogs = vi.fn()

  // Inline accessor to grab the daemons context value and invoke the
  // toggle the same way the `s` hotkey would. This sidesteps Ink's
  // raw-mode plumbing — we test the seam where the keystroke arrives.
  let toggle: ((key: string) => void) | null = null
  function Capture(): null {
    const { toggleByKey } = useDaemons()
    toggle = toggleByKey
    return null
  }

  active = render(
    <ViewProvider>
      <AgentsProvider>
        <DaemonsProvider descriptors={descriptors}>
          <QuitProvider>
          <Seed
            rows={[
              { descriptor: descriptors[0], status: "running", lines: [], exitCode: null },
              { descriptor: descriptors[1], status: "idle", lines: [], exitCode: null },
            ]}
            startStop={{ logs: { start: startLogs, stop: stopLogs } }}
          />
          <Capture />
          <ServerList />
          </QuitProvider>
        </DaemonsProvider>
      </AgentsProvider>
    </ViewProvider>,
  )
  await tick()

  expect(toggle).not.toBeNull()
  toggle!("logs")

  expect(stopLogs).toHaveBeenCalledTimes(1)
  expect(startLogs).not.toHaveBeenCalled()
})

test("toggleByKey dispatches start() for an idle daemon", async () => {
  const descriptors = [makeDescriptor("logs")]
  const stopLogs = vi.fn()
  const startLogs = vi.fn()

  let toggle: ((key: string) => void) | null = null
  function Capture(): null {
    const { toggleByKey } = useDaemons()
    toggle = toggleByKey
    return null
  }

  active = render(
    <ViewProvider>
      <AgentsProvider>
        <DaemonsProvider descriptors={descriptors}>
          <QuitProvider>
          <Seed
            rows={[
              { descriptor: descriptors[0], status: "idle", lines: [], exitCode: null },
            ]}
            startStop={{ logs: { start: startLogs, stop: stopLogs } }}
          />
          <Capture />
          <ServerList />
          </QuitProvider>
        </DaemonsProvider>
      </AgentsProvider>
    </ViewProvider>,
  )
  await tick()

  toggle!("logs")
  expect(startLogs).toHaveBeenCalledTimes(1)
  expect(stopLogs).not.toHaveBeenCalled()
})
