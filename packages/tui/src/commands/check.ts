// `davstack check` — probe every configured daemon and report status.
//
// Pure (no Ink, no spawning, no stdin). Designed to be safe to run in CI,
// piped, or as a one-liner at the top of any agent workflow. The TUI's
// `start` is the only spawner; `check` only reports.
//
// Exit codes:
//   0 — all configured daemons are reachable
//   1 — at least one configured daemon is not reachable
//   2 — no davstack configs found in this repo

import { discoverEnabledDaemons, findConfigRoot } from "../lib/config-discovery.ts"
import {
  daemonRegistry,
  type DaemonDescriptor,
  type DaemonKey,
} from "../lib/daemon-registry.ts"
import { probePort } from "../lib/port-probe.ts"
import { findRepoRoot } from "../lib/repo-root.ts"

const PROBE_TIMEOUT_MS = 300
const DEFAULT_PROBE_HOST = "127.0.0.1"

export type CheckRow = { descriptor: DaemonDescriptor; running: boolean }

export type CheckResult =
  | { kind: "no-config"; repoRoot: string }
  | { kind: "checked"; repoRoot: string; rows: CheckRow[] }

export type CheckDeps = {
  repoRoot?: string
  probe?: (host: string, port: number) => Promise<boolean>
  registry?: DaemonDescriptor[]
  // Test-only override of the discovery step (default reads filesystem).
  discover?: (repoRoot: string) => Promise<Set<DaemonKey>>
}

export async function runCheck(deps: CheckDeps = {}): Promise<CheckResult> {
  const cwd = process.cwd()
  const repoRoot = deps.repoRoot ?? findConfigRoot(cwd) ?? findRepoRoot(cwd)
  const discover = deps.discover ?? discoverEnabledDaemons
  const probe = deps.probe ?? ((h, p) => probePort(h, p, PROBE_TIMEOUT_MS))
  const registry = deps.registry ?? daemonRegistry

  const enabled = await discover(repoRoot)
  if (enabled.size === 0) return { kind: "no-config", repoRoot }

  const descriptors = registry.filter((d) => enabled.has(d.key))
  const rows = await Promise.all(
    descriptors.map(async (descriptor) => {
      const host = descriptor.host ?? DEFAULT_PROBE_HOST
      const running = await probe(host, descriptor.port)
      return { descriptor, running }
    }),
  )
  return { kind: "checked", repoRoot, rows }
}

function green(s: string, useColor: boolean): string {
  return useColor ? `\x1b[32m${s}\x1b[0m` : s
}

function red(s: string, useColor: boolean): string {
  return useColor ? `\x1b[31m${s}\x1b[0m` : s
}

const START_HINT = [
  "To start the missing daemons, run this in a separate terminal:",
  "",
  "  pnpm dlx @davstack/tui start",
  "",
  "The TUI supervises every configured daemon together; closing it",
  "cleans them up. Re-run `davstack check` to confirm.",
].join("\n")

export function formatResult(result: CheckResult, useColor: boolean): string {
  const header = `davstack check (cwd: ${result.repoRoot})`

  if (result.kind === "no-config") {
    return [header, "", "No davstack configs found. Run: pnpm dlx @davstack/init"].join("\n")
  }

  const labelWidth = Math.max(...result.rows.map((r) => r.descriptor.label.length), 1)
  const portWidth = Math.max(...result.rows.map((r) => `:${r.descriptor.port}`.length), 1)

  const lines: string[] = [header, ""]
  let missing = 0
  for (const row of result.rows) {
    const marker = row.running ? green("●", useColor) : red("✗", useColor)
    const label = row.descriptor.label.padEnd(labelWidth)
    const port = `:${row.descriptor.port}`.padEnd(portWidth)
    const status = row.running ? "running" : "not running"
    lines.push(`  ${marker} ${label}  ${port}  ${status}`)
    if (!row.running) missing += 1
  }
  lines.push("")

  if (missing === 0) {
    lines.push("All configured daemons running.")
  } else {
    lines.push(`${missing} daemon(s) not running.`)
    lines.push("")
    lines.push(START_HINT)
  }

  return lines.join("\n")
}

export function exitCodeFor(result: CheckResult): number {
  if (result.kind === "no-config") return 2
  return result.rows.every((r) => r.running) ? 0 : 1
}
