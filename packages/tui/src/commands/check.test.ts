// Unit tests for `davstack check`. Pure: no real network, no real daemons.
// Uses fake DaemonDescriptors + a spy `probe` so we can assert which
// ports got hit and what the formatter does with the result.

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { runCheck, formatResult, exitCodeFor } from "./check.ts"
import type { DaemonDescriptor, DaemonKey } from "../lib/daemon-registry.ts"

function fakeDescriptor(key: DaemonKey, label: string, port: number): DaemonDescriptor {
  return {
    key,
    label,
    port,
    host: "127.0.0.1",
    readyRegex: /listening on http:\/\//i,
    spawn: () => {
      throw new Error("check must never call spawn")
    },
  }
}

const FAKE_REGISTRY: DaemonDescriptor[] = [
  fakeDescriptor("logs", "logs", 7077),
  fakeDescriptor("vitest", "vitest", 5179),
  fakeDescriptor("playwright", "playwright", 5180),
]

let tmpRoot = ""

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "davstack-tui-check-"))
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

async function writeConfig(name: string): Promise<void> {
  const dir = path.join(tmpRoot, ".davstack", "config")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, name), "export default {}\n", "utf8")
}

describe("runCheck", () => {
  test("returns no-config when .davstack/config is missing", async () => {
    const result = await runCheck({
      repoRoot: tmpRoot,
      probe: vi.fn(),
      registry: FAKE_REGISTRY,
    })
    expect(result.kind).toBe("no-config")
    if (result.kind === "no-config") {
      expect(result.repoRoot).toBe(tmpRoot)
    }
  })

  test("probes only configured daemons", async () => {
    await writeConfig("logs-server.config.ts")
    await writeConfig("vitest-server.config.ts")
    const probe = vi.fn().mockResolvedValue(true)
    const result = await runCheck({
      repoRoot: tmpRoot,
      probe,
      registry: FAKE_REGISTRY,
    })
    expect(probe).toHaveBeenCalledTimes(2)
    const probedPorts = probe.mock.calls.map((c) => c[1]).sort()
    expect(probedPorts).toEqual([5179, 7077])
    expect(result.kind).toBe("checked")
  })

  test("exit 1 when any daemon's probe returns false", async () => {
    await writeConfig("logs-server.config.ts")
    await writeConfig("vitest-server.config.ts")
    const probe = vi.fn(async (_h: string, port: number) => port === 7077)
    const result = await runCheck({
      repoRoot: tmpRoot,
      probe,
      registry: FAKE_REGISTRY,
    })
    expect(exitCodeFor(result)).toBe(1)
  })

  test("exit 0 when all probes return true", async () => {
    await writeConfig("logs-server.config.ts")
    const probe = vi.fn().mockResolvedValue(true)
    const result = await runCheck({
      repoRoot: tmpRoot,
      probe,
      registry: FAKE_REGISTRY,
    })
    expect(exitCodeFor(result)).toBe(0)
  })

  test("exit 2 for no-config", async () => {
    const result = await runCheck({
      repoRoot: tmpRoot,
      probe: vi.fn(),
      registry: FAKE_REGISTRY,
    })
    expect(exitCodeFor(result)).toBe(2)
  })
})

describe("formatResult", () => {
  test("renders the no-config message with the init command", () => {
    const out = formatResult({ kind: "no-config", repoRoot: "/repo" }, false)
    expect(out).toContain("No davstack configs found")
    expect(out).toContain("pnpm dlx @davstack/init")
    expect(out).toContain("/repo")
  })

  test("all-running output omits the start hint", () => {
    const out = formatResult(
      {
        kind: "checked",
        repoRoot: "/repo",
        rows: [
          { descriptor: FAKE_REGISTRY[0]!, running: true },
          { descriptor: FAKE_REGISTRY[1]!, running: true },
        ],
      },
      false,
    )
    expect(out).toContain("All configured daemons running.")
    expect(out).not.toContain("pnpm dlx @davstack/tui start")
  })

  test("some-missing output includes the start hint", () => {
    const out = formatResult(
      {
        kind: "checked",
        repoRoot: "/repo",
        rows: [
          { descriptor: FAKE_REGISTRY[0]!, running: true },
          { descriptor: FAKE_REGISTRY[1]!, running: false },
        ],
      },
      false,
    )
    expect(out).toContain("1 daemon(s) not running.")
    expect(out).toContain("pnpm dlx @davstack/tui start")
  })

  test("color=true emits ANSI escapes; color=false does not", () => {
    const rows = [
      { descriptor: FAKE_REGISTRY[0]!, running: true },
      { descriptor: FAKE_REGISTRY[1]!, running: false },
    ]
    const colored = formatResult({ kind: "checked", repoRoot: "/r", rows }, true)
    const plain = formatResult({ kind: "checked", repoRoot: "/r", rows }, false)
    expect(colored).toContain("\x1b[")
    expect(plain).not.toContain("\x1b[")
  })
})

