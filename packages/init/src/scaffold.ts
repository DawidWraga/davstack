// Scaffolding for @davstack/init.
//
// Writes .davstack/config/<tool>.config.ts files from templates and
// appends the two gitignore lines that keep runtime files out of git
// while keeping the committed config dir.

import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type Tool = "logs-server" | "vitest-server" | "playwright-server" | "open-agents"

export const ALL_TOOLS: Tool[] = [
  "logs-server",
  "vitest-server",
  "playwright-server",
  "open-agents",
]

const here = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = path.join(here, "templates")

export const GITIGNORE_LINES = [".davstack/*", "!.davstack/config/"]

export interface ScaffoldResult {
  written: string[]
  skipped: string[]
  gitignoreUpdated: boolean
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

  return { written, skipped, gitignoreUpdated }
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
