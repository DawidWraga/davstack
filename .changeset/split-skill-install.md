---
"@davstack/init": minor
---

Split skill installation by location so daemon-skill doc links always resolve.

Daemon skills (`logs-server`, `vitest-server`, `playwright-server`) reference
`node_modules/@davstack/<pkg>/docs/...`, which only resolves from a specific
project root. They now install **project-local** to `<root>/.claude/skills/`,
and their doc links are rewritten to `../../../node_modules/@davstack/<pkg>/...`
so they resolve directly from the installed file — locally, offline, and
version-matched to the project's installed package.

Orchestrator / open-agents skills (`diagnose`, `explore`, `fast-edit`) have no
project-relative links and continue to install **globally** to
`~/.claude/skills/`, available from every repo.

On install, init also removes any stale **global** copy of a now-project-local
daemon skill — but only the exact `SKILL.md` it previously generated (matched by
a generated marker), and only removes the containing directory if it is then
empty. Hand-authored skills and any other files are never touched.
