// @davstack/init — interactive bootstrap CLI.
//
// Picks a repo root, prompts (or accepts flags) for which daemons to
// wire up, installs them with the detected package manager, scaffolds
// .davstack/config/*.config.ts, and patches .gitignore.

import { spawnSync } from "node:child_process"
import { Command } from "commander"
import { checkbox } from "@inquirer/prompts"

import { detectPackageManager, detectRepoRoot, isPnpmWorkspaceRoot } from "./detect.ts"
import type { PackageManager } from "./detect.ts"
import { ALL_TOOLS, scaffold } from "./scaffold.ts"
import type { Tool } from "./scaffold.ts"

interface CliOptions {
  all?: boolean
  tools?: string
  skipInstall?: boolean
  noScaffold?: boolean
  scaffold?: boolean
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

function installCommand(
  manager: PackageManager,
  tools: Tool[],
  workspaceRoot: boolean,
): { cmd: string; args: string[] } {
  const packages = tools.map((t) => `@davstack/${t}`)
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

function runInstall(root: string, manager: PackageManager, tools: Tool[]): void {
  const workspaceRoot = manager === "pnpm" && isPnpmWorkspaceRoot(root)
  const { cmd, args } = installCommand(manager, tools, workspaceRoot)
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

function printNextSteps(tools: Tool[]): void {
  console.log("")
  console.log("Done. Next:")
  if (tools.includes("logs-server")) console.log("  npx logs-server serve &")
  if (tools.includes("vitest-server")) console.log("  npx vitest-server check")
  if (tools.includes("playwright-server")) console.log("  npx playwright-server check")
  if (tools.includes("open-agents")) {
    console.log("  npx explore check                 # verifies cursor-agent install")
    console.log("  npx explore   submit '<goal>…</goal> <scope>…</scope>'")
    console.log("  npx fast-edit submit --file <spec>.md")
    console.log("")
    console.log("  open-agents needs the `cursor-agent` binary on PATH (or vendored")
    console.log("  on Windows). If `npx explore check` flags it as missing, install")
    console.log("  from https://cursor.com/cli.")
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
      "Interactive bootstrap for @davstack/{logs,vitest,playwright}-server " +
        "and @davstack/open-agents. Detects repo root, installs tools, " +
        "scaffolds .davstack/ config + gitignore.",
    )
    .option("--all", "select all tools without prompting")
    .option(
      "--tools <list>",
      "comma-separated tools to install (logs-server,vitest-server,playwright-server,open-agents)",
    )
    .option("--skip-install", "skip the package manager install step")
    .option("--no-scaffold", "skip writing .davstack/ and .gitignore")
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
    const result = await scaffold(repo.root, tools)
    for (const f of result.written) console.log(`  wrote   ${f}`)
    for (const f of result.skipped) console.log(`  skipped ${f} (already exists)`)
    if (result.gitignoreUpdated) console.log("  updated .gitignore")
    else console.log("  .gitignore already has davstack lines")
  } else {
    console.log("Skipping scaffold (--no-scaffold).")
  }

  printNextSteps(tools)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
