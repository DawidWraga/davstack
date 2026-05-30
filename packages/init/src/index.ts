// @davstack/init — interactive bootstrap CLI.
//
// Picks a repo root, prompts (or accepts flags) for which daemons to
// wire up, installs them with the detected package manager, scaffolds
// .davstack/config/*.config.ts, and patches .gitignore.

import { spawnSync } from "node:child_process"
import { Command } from "commander"
import { checkbox } from "@inquirer/prompts"

import { detectPackageManager, detectRepoRoot, isPnpmWorkspaceRoot } from "./detect.js"
import type { PackageManager } from "./detect.js"
import { ALL_TOOLS, scaffold } from "./scaffold.js"
import type { Tool } from "./scaffold.js"

interface CliOptions {
  all?: boolean
  tools?: string
  skipInstall?: boolean
  noScaffold?: boolean
  scaffold?: boolean
  allSkills?: boolean
}

function parseToolsFlag(value: string): Tool[] {
  const requested = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Tool[]
  const invalid = requested.filter((t) => !ALL_TOOLS.includes(t))
  if (invalid.length > 0) {
    throw new Error(
      `Unknown tool(s): ${invalid.join(", ")}. Valid: ${ALL_TOOLS.join(", ")}`,
    )
  }
  return requested
}

async function pickTools(opts: CliOptions): Promise<Tool[]> {
  if (opts.tools) return parseToolsFlag(opts.tools)
  if (opts.all) return [...ALL_TOOLS]

  const picked = await checkbox<Tool>({
    message: "Which davstack daemons do you want to set up?",
    choices: ALL_TOOLS.map((t) => ({ name: t, value: t, checked: true })),
  })
  return picked
}

// Tools whose bins must be on PATH regardless of cwd — install globally so
// `explore` / `fast-edit` resolve everywhere and `npx explore` never falls
// back to the unrelated public `explore` package on the npm registry.
// (open-agents reads per-repo .davstack/config/open-agents.config.ts via
// findRepoRoot(cwd), so global install doesn't lose per-repo settings.)
const GLOBAL_TOOLS: Tool[] = ["open-agents"]

// Always-global packages installed on every init run, independent of which
// daemons were selected. `@davstack/tui` provides the `davstack` bin
// (`davstack start` / `davstack check`) — the orchestrator that spawns and
// owns the configured daemons together. It's not a selectable daemon, so it
// lives outside the Tool union / ALL_TOOLS and ships globally so `davstack`
// resolves from any repo (matching the GLOBAL_TOOLS rationale above).
const ALWAYS_GLOBAL_PACKAGES = ["@davstack/tui"]

function installCommand(
  manager: PackageManager,
  packages: string[],
  workspaceRoot: boolean,
  global: boolean,
): { cmd: string; args: string[] } {
  if (global) {
    switch (manager) {
      case "pnpm":
        return { cmd: "pnpm", args: ["add", "-g", ...packages] }
      case "yarn":
        return { cmd: "yarn", args: ["global", "add", ...packages] }
      case "bun":
        return { cmd: "bun", args: ["add", "-g", ...packages] }
      case "npm":
      default:
        return { cmd: "npm", args: ["install", "-g", ...packages] }
    }
  }
  switch (manager) {
    case "pnpm":
      return {
        cmd: "pnpm",
        args: ["add", "-D", ...(workspaceRoot ? ["-w"] : []), ...packages],
      }
    case "yarn":
      return { cmd: "yarn", args: ["add", "-D", ...packages] }
    case "bun":
      return { cmd: "bun", args: ["add", "-d", ...packages] }
    case "npm":
    default:
      return { cmd: "npm", args: ["install", "-D", ...packages] }
  }
}

function runInstallGroup(
  root: string,
  manager: PackageManager,
  packages: string[],
  global: boolean,
): void {
  const workspaceRoot = manager === "pnpm" && isPnpmWorkspaceRoot(root)
  const { cmd, args } = installCommand(manager, packages, workspaceRoot, global)
  console.log(`\n> ${cmd} ${args.join(" ")}`)
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  })
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with exit code ${result.status}`)
  }
}

function runInstall(root: string, manager: PackageManager, tools: Tool[]): void {
  const local = tools.filter((t) => !GLOBAL_TOOLS.includes(t)).map((t) => `@davstack/${t}`)
  const global = tools.filter((t) => GLOBAL_TOOLS.includes(t)).map((t) => `@davstack/${t}`)
  if (local.length > 0) runInstallGroup(root, manager, local, false)
  // The davstack TUI ships globally on every run, regardless of selection.
  if (global.length > 0) runInstallGroup(root, manager, [...global, ...ALWAYS_GLOBAL_PACKAGES], true)
  else runInstallGroup(root, manager, ALWAYS_GLOBAL_PACKAGES, true)
}

function printNextSteps(tools: Tool[]): void {
  const daemons = tools.filter((t) => t !== "open-agents")
  console.log("")
  console.log("Done. Next:")
  if (daemons.length > 0) {
    console.log("  davstack start    # in a SEPARATE terminal — launches all configured daemons")
    console.log("  davstack check    # confirm the daemons are up")
    console.log("")
    console.log("  `davstack` is installed globally (the davstack TUI). Run `davstack start`")
    console.log("  in its own long-running terminal; Claude can't run it for you. Once it's")
    console.log("  up, `davstack check` reports each daemon's health.")
    console.log("")
  }
  if (tools.includes("open-agents")) {
    console.log("  explore check                 # verifies cursor-agent install")
    console.log("  explore   submit '<goal>…</goal> <scope>…</scope>'")
    console.log("  fast-edit submit --file <spec>.md")
    console.log("")
    console.log("  open-agents is installed globally so `explore` / `fast-edit` are")
    console.log("  on PATH from any repo. It still needs the `cursor-agent` binary")
    console.log("  on PATH (or vendored on Windows). If `explore check` flags it as")
    console.log("  missing, install from https://cursor.com/cli.")
  }
  console.log("")
  console.log("Config files are in .davstack/config/ (committed).")
  console.log("Runtime files live in .davstack/{logs.db, port, cache/} (gitignored).")
}

async function main(): Promise<void> {
  const program = new Command()
  program
    .name("davstack-init")
    .description(
      "Interactive bootstrap for @davstack/{logs,vitest}-server " +
        "and @davstack/open-agents. Detects repo root, installs tools, " +
        "scaffolds .davstack/ config + gitignore.",
    )
    .option("--all", "select all tools without prompting")
    .option(
      "--tools <list>",
      "comma-separated tools to install (logs-server,vitest-server,open-agents)",
    )
    .option("--skip-install", "skip the package manager install step")
    .option("--no-scaffold", "skip writing .davstack/ and .gitignore")
    .option("--all-skills", "install every bundled SKILL.md regardless of selected tools")
    .helpOption("-h, --help", "display help for command")
    .parse(process.argv)

  const opts = program.opts<CliOptions>()

  const repo = detectRepoRoot()
  console.log(`Repo root: ${repo.root} (detected via ${repo.source})`)

  const pm = detectPackageManager(repo.root)
  console.log(
    `Package manager: ${pm.manager}` +
      (pm.source === "lockfile" ? ` (from ${pm.lockfile})` : " (default)"),
  )

  const tools = await pickTools(opts)
  if (tools.length === 0) {
    console.log("No tools selected. Nothing to do.")
    return
  }
  console.log(`Selected: ${tools.join(", ")}`)

  const skipInstall = opts.skipInstall || process.env.DAVSTACK_INIT_SKIP_INSTALL === "1"
  if (skipInstall) {
    console.log("Skipping install (--skip-install or DAVSTACK_INIT_SKIP_INSTALL=1).")
  } else {
    runInstall(repo.root, pm.manager, tools)
  }

  // commander's --no-scaffold sets opts.scaffold = false
  const doScaffold = opts.scaffold !== false
  if (doScaffold) {
    const result = await scaffold(repo.root, tools, { allSkills: !!opts.allSkills })
    for (const f of result.written) console.log(`  wrote   ${f}`)
    for (const f of result.skipped) console.log(`  skipped ${f} (already exists)`)
    if (result.gitignoreUpdated) console.log("  updated .gitignore")
    else console.log("  .gitignore already has davstack lines")
    for (const f of result.projectSkills) console.log(`  skill   ${f} (project)`)
    for (const f of result.globalSkills) console.log(`  skill   ${f} (global)`)
    for (const f of result.removedGlobal) console.log(`  removed ${f} (stale global copy — now project-local)`)
  } else {
    console.log("Skipping scaffold (--no-scaffold).")
  }

  printNextSteps(tools)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
