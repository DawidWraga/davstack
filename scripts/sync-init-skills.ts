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
  "vitest-server",
]

// Rewrite canonical repo-relative doc links to the consumer's installed
// package. Canonical links look like `../../packages/<pkg>/docs/<file>.md`
// or `../../packages/<pkg>/README.md`; on the consumer machine the matching
// files live under <project>/node_modules/@davstack/<pkg>/....
//
// Skills carrying these links install PROJECT-LOCAL at
// <root>/.claude/skills/<name>/SKILL.md (see packages/init scaffold.ts), so
// from the installed file `../../../` climbs back to the project root and
// `../../../node_modules/@davstack/<pkg>/...` resolves to the project's
// installed package — locally, offline, and version-matched. The `../../../`
// depth is bound to that install location; keep the two in sync.
const PROJECT_ROOT_PREFIX = "../../../"

function rewriteLinks(content: string): { text: string; changed: boolean } {
  let changed = false
  const text = content.replace(
    /\.\.\/\.\.\/packages\/([^/)\s]+)\//g,
    (_m, pkg: string) => {
      changed = true
      return `${PROJECT_ROOT_PREFIX}node_modules/@davstack/${pkg}/`
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

async function main() {
  for (const name of SKILLS) {
    const src = path.join(CANONICAL_DIR, name, "SKILL.md")
    const dest = path.join(INIT_SKILL_DIR, `${name}.md`)
    const canonical = await readFile(src, "utf8")
    // Normalize to LF so the generated artifact is deterministic
    // regardless of the canonical file's on-disk line endings.
    const normalized = canonical.replace(/\r\n/g, "\n")
    const { frontmatter, body } = splitFrontmatter(normalized)
    const { text: rewrittenBody } = rewriteLinks(body)

    // Note block goes after frontmatter: just the generated marker. The
    // rewritten doc links are project-root-relative (../../../node_modules/…)
    // and resolve directly from the installed file, so no extra hint is needed.
    const note = `${GEN_COMMENT(name)}\n`
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
