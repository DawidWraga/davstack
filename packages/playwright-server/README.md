# @davstack/playwright-server

Long-lived warm-browser Playwright daemon. Spec iteration drops from ~15–25s cold to ~1–3s warm.

> **Recommended**: run this daemon via `pnpm dlx @davstack/tui start` —
> the TUI supervises all configured davstack daemons together and cleans
> them up on quit. The standalone CLI below still works if you want to
> run this daemon in isolation.

## Why

- **Warm chromium context.** Reuse warm browser across tabs for super fast agentic feedback loops.
- **Agent-optimized CLI.** Structured JSON + exit codes; fast loops, lean on tokens.

## Install

```bash
pnpm add -D @davstack/playwright-server @playwright/test
pnpm exec playwright install chromium

# in a long-lived shell:
pnpm exec playwright-server serve
```

## Usage Example

```bash
playwright-server run e2e/smoke.spec.ts
{"ok":true,"durationMs":842,"setupMs":120,"file":"e2e/smoke.spec.ts"}
```

## Docs

- [docs/setup.md](./docs/setup.md) — config file, defaults, peer-dep, sanity check
- [docs/usage.md](./docs/usage.md) — CLI verbs, HTTP API, agent-loop pattern
- [docs/auth.md](./docs/auth.md) — `refreshAuth` seam + `storageStatePath` lifecycle
- [docs/troubleshooting.md](./docs/troubleshooting.md) — port conflicts, missing chromium, stale auth, extractor restrictions
