# open-agents — the delegation primitive

The **canonical source** of the collaboration primitive — the `open-agents`
core + the `explore`/`fast-edit` skills that let the orchestrator delegate
scoped jobs to `cursor-agent -p` and self-wait on them.

- `explore/skill/SKILL.md`, `fast-edit/skill/SKILL.md` — the skill definitions
  Claude Code loads (explore = read-only quote-extractor; fast-edit = one-pass
  mutator); each ships a bundled `scripts/<name>.ts`
- `open-agents/src/` — `cli.ts` + `core/` · `profiles/` · `adapters/` ·
  `entrypoints/` (the self-waiting job runner, Bun) — the shared, editable
  source the skill scripts are built from
- `npx skills add` installs the skills into `~/.claude/skills`
- `experiments/` — strategy-arm runs; per-skill `feedback/` — lived-use
  friction logs; `notes/` — the explore/mechanical-edit doctrine

Usage in one line (see `explore/skill/SKILL.md` for the full contract):
write a scoped `spec.md`, then

```
bun ~/.claude/skills/explore/scripts/explore.ts submit --file spec.md
```

it blocks, writes each job's clean deliverable to its own file, and you verify
the load-bearing fact yourself.

## Install model

`npx skills add DawidWraga/skills` installs the three skills into
`~/.claude/skills/{explore,fast-edit,diagnose}` (install identity is the
SKILL.md `name:` frontmatter, not the folder name). Each skill ships a
self-contained, dependency-free `scripts/<name>.ts` built from
`open-agents/src/` via `bun run build` — no shim, no junctions, no
post-install build hook.

> `open-agents/` has no `SKILL.md`, so it is never installed as a skill — it
> is the shared, editable source the committed skill scripts are generated
> from. Edit `open-agents/`, run `bun run build`, never hand-edit `scripts/`.

The measurement scripts the experiments use live in
`open-agents/observability/` (Bun+TS, single runtime), shared across all
skills in this repo.
