// Tests for discoverEnabledDaemons — fixture-driven, using a temp dir.

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import { discoverEnabledDaemons } from "./config-discovery.ts"

let tmpRoot = ""

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "davstack-tui-cfg-"))
})

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true })
})

async function writeConfig(name: string): Promise<void> {
  const dir = path.join(tmpRoot, ".davstack", "config")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, name), "export default {}\n", "utf8")
}

describe("discoverEnabledDaemons", () => {
  test("returns all three keys when all configs present", async () => {
    await writeConfig("logs-server.config.ts")
    await writeConfig("vitest-server.config.ts")
    await writeConfig("playwright-server.config.ts")
    const set = await discoverEnabledDaemons(tmpRoot)
    expect(set).toEqual(new Set(["logs", "vitest", "playwright"]))
  })

  test("returns only the subset that exists", async () => {
    await writeConfig("logs-server.config.ts")
    await writeConfig("vitest-server.config.ts")
    const set = await discoverEnabledDaemons(tmpRoot)
    expect(set).toEqual(new Set(["logs", "vitest"]))
  })

  test("returns empty set when .davstack/config is missing entirely", async () => {
    const set = await discoverEnabledDaemons(tmpRoot)
    expect(set.size).toBe(0)
  })

  test("ignores unrecognized files in the config dir", async () => {
    await writeConfig("logs-server.config.ts")
    await writeConfig("README.md")
    await writeConfig("open-agents.config.ts")
    const set = await discoverEnabledDaemons(tmpRoot)
    expect(set).toEqual(new Set(["logs"]))
  })
})
