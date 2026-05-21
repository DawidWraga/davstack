# Davstack

Local-first dev tooling for AI-coding-agent workflows. Long-lived daemons, structured-JSON CLIs, and a shared `.davstack/` config convention — so agents can run tests, drive browsers, query logs, and dispatch subagents without paying cold-start cost every turn.

## Packages

| Package | What it is |
|---|---|
| [@davstack/init](./packages/init) | Bootstrap CLI — scaffolds `.davstack/config/*.config.ts` for every tool you opt into, updates `.gitignore`. |
| [@davstack/logs-server](./packages/logs-server) | Local Sentry-shaped log sink. Ingests envelopes over HTTP, writes to per-repo SQLite, queries by `trace_id` / `run_id` / `level`. |
| [@davstack/vitest-server](./packages/vitest-server) | Long-lived Vitest daemon. Story/unit reruns drop from ~50s cold to ~3–15s warm. |
| [@davstack/playwright-server](./packages/playwright-server) | Long-lived warm-browser Playwright daemon. Spec iteration drops from ~15–25s cold to ~1–3s warm. |
| [@davstack/open-agents](./packages/open-agents) | One-shot agent runner (cursor-agent et al) with structured deliverables — explore, fast-edit, etc. |
| [@davstack/cli-utils](./packages/cli-utils) | Internal: `defineCli` + shared config-resolver (`findRepoRoot`, `findToolConfig`). |

## Skills

Agent-facing skill files live in [`skills/`](./skills) — one subdir per skill, each with `SKILL.md`. Loaded via the `npx skills add` installer, which handles `.agents/` registration and Claude symlinks.

Current skills: `explore`, `fast-edit`, `logs-server`, `vitest-server`, `playwright-server`.

## Quick start

```bash
# Scaffold configs for everything in one shot:
pnpm dlx @davstack/init --all

# Or pick the tools you want:
pnpm dlx @davstack/init --tools=logs-server,vitest-server
```

Each package has its own README + `docs/` covering install, config, usage, and troubleshooting.

## Archive

Older packages (`@davstack/store`, `service`, `sound`, `ui`) plus prior `apps/` and `examples/` live under [`archive/`](./archive) — not actively maintained, retained for reference and revertability.

---

Davstack is created and maintained by [Dawid Wraga](https://github.com/DawidWraga).
