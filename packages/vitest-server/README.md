# @davstack/vitest-server

Long-lived Vitest daemon. Story/unit reruns drop from ~50s cold to ~3-15s warm.

> **Recommended**: run this daemon via `pnpm dlx @davstack/tui start` —
> the TUI supervises all configured davstack daemons together and cleans
> them up on quit. The standalone CLI below still works if you want to
> run this daemon in isolation.

## Why

- **Warm-boot speed.** Vite optimize + playwright launch + storybook preset only happen once; per-file reruns reuse the hot pool.
- **Agent-optimized CLI.** Structured JSON + exit codes; fast loops, lean on tokens.

## Install

```bash
pnpm add -D @davstack/vitest-server
pnpm exec vitest-server serve     # boots daemon on 127.0.0.1:5179
```

## Usage Example

```bash
# Terminal A — boot once (heavy: ~50s cold).
pnpm exec vitest-server serve

# Terminal B — rerun a file against the warm daemon (~3-15s).
pnpm exec vitest-server run src/feat/chart-views/LineChart/LineChartView.stories.tsx
# → JSON RunResult on stdout, exit 0 on pass / 1 on fail
```

## Docs

- [docs/setup.md](./docs/setup.md) — config file, runtime matrix, `primeFile` semantics
- [docs/usage.md](./docs/usage.md) — CLI verbs, HTTP API, agent TDD loop
- [docs/troubleshooting.md](./docs/troubleshooting.md) — `(0 test)`, version mismatch, Bun-on-Windows
