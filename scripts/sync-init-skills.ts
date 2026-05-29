// Generate init's shipped skill files from the canonical root skills.
//
// init ships `src/skills/<name>.md` as a hand-frozen DUPLICATE of the
// canonical `skills/<name>/SKILL.md`. That fork drifts and has shipped
// removed APIs to users. This script makes those files a GENERATED
// artifact: read each canonical skill, rewrite its relative repo doc
// links to point at the consumer's locally-installed package
// (node_modules/@davstack/<pkg>/...), prepend a generated-file header,
// and write to packages/init/src/skills/<name>.md.
//
// init has no build step (ships src/** raw, runs via tsx) and at the
// consumer machine can only read its own shipped files, so the canonical
// content MUST be baked into init's committed files.
//
// Run: pnpm gen:init-skills  (idempotent — running twice = no git diff)

import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "..")

const CANONICAL_DIR = path.join(repoRoot, "skills")
const INIT_SKILL_DIR = path.join(repoRoot, "packages", "init", "src", "skills")

// The 6 canonical skills init ships. Canonical lives at
// skills/<name>/SKILL.md; init's generated copy at src/skills/<name>.md.
const SKILLS = [
  "diagnose",
  "explore",
  "fast-edit",
  "logs-server",
  "playwright-server",
  "vitest-server",
]

// Rewrite canonical repo-relative doc links to the consumer's installed
// package. Canonical links look like `../../packages/<pkg>/docs/<file>.md`
// or `../../packages/<pkg>/README.md`; on the consumer machine the
// matching files live under node_modules/@davstack/<pkg>/..., so the
// installed skill's links resolve locally/offline and version-matched.
// Reports whether any link was rewritten so we can append the
// project-root hint (below) only to skills that actually carry such links.
function rewriteLinks(content: string): { text: string; changed: boolean } {
  let changed = false
  const text = content.replace(
    /\.\.\/\.\.\/packages\/([^/)\s]+)\//g,
    (_m, pkg: string) => {
      changed = true
      return `node_modules/@davstack/${pkg}/`
    },
  )
  return { text, changed }
}

// Split a leading YAML frontmatter block (`--- … ---`) from the body.
// The generated header comment + hint MUST go AFTER the frontmatter:
// skill loaders only recognize frontmatter when it is the very first
// bytes of the file, so prepending an HTML comment would break `name`/
// `description` parsing. Content is already LF-normalized here.
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  const m = content.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/)
  if (m) return { frontmatter: m[1], body: m[2] }
  return { frontmatter: "", body: content }
}

const GEN_COMMENT = (name: string) =>
  `<!-- GENERATED from skills/${name}/SKILL.md by scripts/sync-init-skills.ts — DO NOT EDIT BY HAND -->`

// Installed skills live at ~/.claude/skills/<name>/SKILL.md, but their doc
// links are bare node_modules/@davstack/... paths — i.e. relative to the
// consumer's PROJECT ROOT (where node_modules lives), not to this file.
// Spell that out so the link target is unambiguous to the reader.
const PROJECT_ROOT_HINT =
  "> Doc links in this skill are written relative to your project root (where `node_modules/` lives), not to this file."

async function main() {
  for (const name of SKILLS) {
    const src = path.join(CANONICAL_DIR, name, "SKILL.md")
    const dest = path.join(INIT_SKILL_DIR, `${name}.md`)
    const canonical = await readFile(src, "utf8")
    // Normalize to LF so the generated artifact is deterministic
    // regardless of the canonical file's on-disk line endings.
    const normalized = canonical.replace(/\r\n/g, "\n")
    const { frontmatter, body } = splitFrontmatter(normalized)
    const { text: rewrittenBody, changed } = rewriteLinks(body)

    // Note block goes after frontmatter: generated marker, plus the
    // project-root hint when this skill carries rewritten doc links.
    const note = changed
      ? `${GEN_COMMENT(name)}\n\n${PROJECT_ROOT_HINT}\n`
      : `${GEN_COMMENT(name)}\n`
    const cleanBody = rewrittenBody.replace(/^\n+/, "")
    const out = frontmatter
      ? `${frontmatter}\n${note}\n${cleanBody}`
      : `${note}\n${cleanBody}`

    await writeFile(dest, out, "utf8")
    console.log(`generated ${path.relative(repoRoot, dest)} from ${path.relative(repoRoot, src)}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
