# Davstack

Local-first dev tooling for AI-coding-agent workflows. Long-lived daemons, structured-JSON CLIs, and a shared `.davstack/` config convention — so agents can run tests, drive browsers, query logs, and dispatch subagents without paying cold-start cost every turn.

## Packages

| Package | What it is | Docs |
|---|---|---|
| [@davstack/init](./packages/init) | Bootstrap CLI — scaffolds `.davstack/config/*.config.ts` for every tool you opt into, updates `.gitignore`. | [README](./packages/init/README.md) |
| [@davstack/tui](./packages/tui) | Terminal UI supervisor — `davstack start` spawns, surfaces, and tears down all configured daemons from a single attached terminal. | [README](./packages/tui/README.md) |
| [@davstack/logs-server](./packages/logs-server) | Local Sentry-shaped log sink. Ingests envelopes over HTTP, writes to per-repo SQLite, queries by `trace_id` / `run_id` / `level`. | [README](./packages/logs-server/README.md) · [setup](./packages/logs-server/docs/setup.md) · [writing](./packages/logs-server/docs/writing-logs.md) · [reading](./packages/logs-server/docs/reading-logs.md) |
| [@davstack/vitest-server](./packages/vitest-server) | Long-lived Vitest daemon. Story/unit reruns drop from ~50s cold to ~3–15s warm. | [README](./packages/vitest-server/README.md) · [setup](./packages/vitest-server/docs/setup.md) · [usage](./packages/vitest-server/docs/usage.md) · [troubleshooting](./packages/vitest-server/docs/troubleshooting.md) |
| [@davstack/open-agents](./packages/open-agents) | One-shot agent runner (cursor-agent et al) with structured deliverables — explore, fast-edit, etc. | [README](./packages/open-agents/README.md) · [cursor-jobs overview](./packages/open-agents/docs/cursor-jobs-overview.md) |
| [@davstack/cli-utils](./packages/cli-utils) | Internal: `defineCli` + shared config-resolver (`findRepoRoot`, `findToolConfig`). | [README](./packages/cli-utils/README.md) |

## Skills

Agent-facing skill files live in [`skills/`](./skills) — one subdir per skill, each with `SKILL.md`. Loaded via the `npx skills add` installer, which handles `.agents/` registration and Claude symlinks.

Current skills: `explore`, `fast-edit`, `logs-server`, `vitest-server`.

## Quick start

```bash
# Scaffold configs for everything in one shot:
pnpm dlx @davstack/init --all

# Or pick the tools you want:
pnpm dlx @davstack/init --tools=logs-server,vitest-server
```

Then run all configured daemons together via the TUI (recommended):

```bash
# In a dedicated terminal — supervises every configured daemon
# and cleans them up on quit.
pnpm dlx @davstack/tui start
```

The TUI is the easy mode. Each daemon still ships its own CLI
(`pnpm exec vitest-server serve`, etc.) if you'd rather run them
individually. See each package's README + `docs/` for install,
config, usage, and troubleshooting.

## Archive

Older packages (`@davstack/store`, `service`, `sound`, `ui`) plus prior `apps/` and `examples/` live under [`archive/`](./archive) — not actively maintained, retained for reference and revertability.

---

Davstack is created and maintained by [Dawid Wraga](https://github.com/DawidWraga).
