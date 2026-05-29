// Scaffolding for @davstack/init.
//
// Writes .davstack/config/<tool>.config.ts files from templates and
// appends the two gitignore lines that keep runtime files out of git
// while keeping the committed config dir. Also installs the matching
// SKILL.md files so Claude Code picks them up.
//
// Skills install to one of two roots depending on whether they reference
// the project's installed packages:
//   • Daemon skills (logs-server, vitest-server, playwright-server) link to
//     node_modules/@davstack/<pkg>/docs/... — those paths only resolve from
//     a specific project root, so these install PROJECT-LOCAL to
//     <root>/.claude/skills/<name>/. (Their links are rewritten to
//     ../../../node_modules/... by scripts/sync-init-skills.ts, resolving to
//     <root>/node_modules from the installed file's location.)
//   • Orchestrator / open-agents skills (diagnose, explore, fast-edit) have
//     no project-relative links, so they install GLOBALLY to
//     ~/.claude/skills/<name>/ and are available from every repo.

import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises"
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

// Skills that link to node_modules/@davstack/<pkg>/docs/... — those links
// only resolve from a specific project root, so these install PROJECT-LOCAL.
// (Matches exactly the skills sync-init-skills.ts rewrites doc links in.)
// Everything else installs globally.
const PROJECT_LOCAL_SKILLS = new Set([
  "logs-server",
  "vitest-server",
  "playwright-server",
])

const here = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE_DIR = path.join(here, "templates")
const SKILL_DIR = path.join(here, "skills")

export const GITIGNORE_LINES = [".davstack/*", "!.davstack/config/"]

export interface ScaffoldResult {
  written: string[]
  skipped: string[]
  gitignoreUpdated: boolean
  // Absolute SKILL.md paths, split by install location.
  globalSkills: string[]
  projectSkills: string[]
  // Stale global daemon-skill dirs removed (migrated to project-local).
  removedGlobal: string[]
}

async function loadTemplate(tool: Tool): Promise<string> {
  const file = path.join(TEMPLATE_DIR, `${tool}.config.ts.template`)
  return readFile(file, "utf8")
}

export interface ScaffoldOptions {
  // Install every bundled SKILL.md regardless of selected tools (--all-skills).
  allSkills?: boolean
}

export async function scaffold(
  root: string,
  tools: Tool[],
  opts: ScaffoldOptions = {},
): Promise<ScaffoldResult> {
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
  const { globalSkills, projectSkills, removedGlobal } = await installSkills(
    root,
    tools,
    opts.allSkills,
  )

  return { written, skipped, gitignoreUpdated, globalSkills, projectSkills, removedGlobal }
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

export interface InstalledSkills {
  globalSkills: string[]
  projectSkills: string[]
  // Stale global copies of now-project-local daemon skills that were removed.
  removedGlobal: string[]
}

// Marker that scripts/sync-init-skills.ts stamps into every generated skill.
// We only ever delete a global SKILL.md that carries this marker, so a user's
// hand-authored skill of the same name is never touched.
const GENERATED_MARKER = "GENERATED from skills/"

// Earlier init versions installed daemon skills GLOBALLY. Now they're
// project-local, so a stale global copy would shadow/duplicate the project
// one. Clean it up — but VERY conservatively, since this deletes from the
// user's home dir:
//   1. only the three known daemon-skill names (callers pass those),
//   2. only when ~/.claude/skills/<skill>/SKILL.md actually exists,
//   3. only when that file carries our generated marker (never a hand-edited
//      or unrelated skill), and
//   4. we delete only that one SKILL.md file — then remove the dir solely if
//      it is now empty, so any extra files the user dropped there survive.
async function removeStaleGlobalSkill(skill: string): Promise<string | null> {
  const dir = path.join(homedir(), ".claude", "skills", skill)
  const file = path.join(dir, "SKILL.md")
  if (!existsSync(file)) return null
  const content = await readFile(file, "utf8")
  if (!content.includes(GENERATED_MARKER)) return null

  await rm(file, { force: true })
  // Drop the now-orphaned dir only if empty; leave it (and report nothing
  // extra) if the user keeps other files alongside it.
  try {
    const rest = await readdir(dir)
    if (rest.length === 0) await rmdir(dir)
  } catch {
    // readdir/rmdir race or perms — harmless; the SKILL.md is already gone.
  }
  return file
}

// Install SKILL.md for each selected tool's skills, plus the always-on
// orchestrator skills. Pass `all=true` to install every bundled skill
// regardless of selected tools (--all-skills). Always overwrites so
// re-running init bumps users to the latest skill content shipped with
// the installed init version.
//
// Each skill lands in one of two roots (see file header): PROJECT_LOCAL_SKILLS
// go to <root>/.claude/skills/<name>/ so their node_modules doc links resolve
// against this project; the rest go to ~/.claude/skills/<name>/ globally.
export async function installSkills(
  root: string,
  tools: Tool[],
  all = false,
): Promise<InstalledSkills> {
  const skills = new Set<string>(ALWAYS_SKILLS)
  if (all) {
    for (const list of Object.values(TOOL_SKILLS)) for (const s of list) skills.add(s)
  } else {
    for (const tool of tools) for (const s of TOOL_SKILLS[tool]) skills.add(s)
  }

  const globalRoot = path.join(homedir(), ".claude", "skills")
  const projectRoot = path.join(root, ".claude", "skills")
  // If the project root is the home dir, project-local and global resolve to
  // the same path — skip the stale-copy cleanup so we never delete the skill
  // we just wrote there.
  const projectIsGlobal = path.resolve(projectRoot) === path.resolve(globalRoot)

  const globalSkills: string[] = []
  const projectSkills: string[] = []
  const removedGlobal: string[] = []
  for (const skill of skills) {
    const src = path.join(SKILL_DIR, `${skill}.md`)
    if (!existsSync(src)) continue
    const isProjectLocal = PROJECT_LOCAL_SKILLS.has(skill)
    const dir = path.join(isProjectLocal ? projectRoot : globalRoot, skill)
    await mkdir(dir, { recursive: true })
    const target = path.join(dir, "SKILL.md")
    const content = await readFile(src, "utf8")
    await writeFile(target, content, "utf8")
    ;(isProjectLocal ? projectSkills : globalSkills).push(target)
    // For each daemon skill we just placed project-local, sweep away the
    // stale global copy an older init may have left behind.
    if (isProjectLocal && !projectIsGlobal) {
      const removed = await removeStaleGlobalSkill(skill)
      if (removed) removedGlobal.push(removed)
    }
  }
  return { globalSkills, projectSkills, removedGlobal }
}
