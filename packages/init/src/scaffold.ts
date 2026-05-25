// Scaffolding for @davstack/init.
//
// Writes .davstack/config/<tool>.config.ts files from templates and
// appends the two gitignore lines that keep runtime files out of git
// while keeping the committed config dir. Also installs the matching
// SKILL.md files into ~/.claude/skills/<name>/ so Claude Code picks
// them up globally.

import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type Tool = "logs-server" | "vitest-server" | "playwright-server" | "open-agents"

export const ALL_TOOLS: Tool[] = [
  "logs-server",
  "vitest-server",
  "playwright-server",
  "open-agents",
]

// Which skills belong to which selected tool. `diagnose` is the
// orchestrator skill — always installed regardless of selection.
const TOOL_SKILLS: Record<Tool, string[]> = {
  "logs-server": ["logs-server"],
  "vitest-server": ["vitest-server"],
  "playwright-server": ["playwright-server"],
  "open-agents": ["explore", "fast-edit"],
}

const ALWAYS_SKILLS = ["diagnose"]

const here = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = path.join(here, "templates")
const SKILL_DIR = path.join(here, "skills")

export const GITIGNORE_LINES = [".davstack/*", "!.davstack/config/"]

export interface ScaffoldResult {
  written: string[]
  skipped: string[]
  gitignoreUpdated: boolean
  skillsInstalled: string[]
}

async function loadTemplate(tool: Tool): Promise<string> {
  const file = path.join(TEMPLATE_DIR, `${tool}.config.ts.template`)
  return readFile(file, "utf8")
}

export async function scaffold(root: string, tools: Tool[]): Promise<ScaffoldResult> {
  const configDir = path.join(root, ".davstack", "config")
  await mkdir(configDir, { recursive: true })

  const written: string[] = []
  const skipped: string[] = []

  for (const tool of tools) {
    const target = path.join(configDir, `${tool}.config.ts`)
    if (existsSync(target)) {
      skipped.push(target)
      continue
    }
    const content = await loadTemplate(tool)
    await writeFile(target, content, "utf8")
    written.push(target)
  }

  const gitignoreUpdated = await ensureGitignore(root)
  const skillsInstalled = await installSkills(tools)

  return { written, skipped, gitignoreUpdated, skillsInstalled }
}

export async function ensureGitignore(root: string): Promise<boolean> {
  const file = path.join(root, ".gitignore")
  let current = ""
  if (existsSync(file)) {
    current = await readFile(file, "utf8")
  }

  const lines = current.split(/\r?\n/)
  const missing = GITIGNORE_LINES.filter((line) => !lines.includes(line))
  if (missing.length === 0) return false

  let next = current
  if (next.length > 0 && !next.endsWith("\n")) next += "\n"
  next += missing.join("\n") + "\n"

  await writeFile(file, next, "utf8")
  return true
}

// Install SKILL.md for each selected tool's skills, plus the always-on
// orchestrator skills. Always overwrites so re-running init bumps users
// to the latest skill content shipped with the installed init version.
export async function installSkills(tools: Tool[]): Promise<string[]> {
  const skills = new Set<string>(ALWAYS_SKILLS)
  for (const tool of tools) {
    for (const s of TOOL_SKILLS[tool]) skills.add(s)
  }

  const root = path.join(homedir(), ".claude", "skills")
  const installed: string[] = []
  for (const skill of skills) {
    const src = path.join(SKILL_DIR, `${skill}.md`)
    if (!existsSync(src)) continue
    const dir = path.join(root, skill)
    await mkdir(dir, { recursive: true })
    const target = path.join(dir, "SKILL.md")
    const content = await readFile(src, "utf8")
    await writeFile(target, content, "utf8")
    installed.push(target)
  }
  return installed
}
