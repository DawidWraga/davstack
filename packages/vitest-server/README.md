# @davstack/vitest-server

Long-lived Vitest daemon. Story/unit reruns drop from ~50s cold to ~3-15s warm.

## Why

- **Warm-boot speed.** Vite optimize + playwright launch + storybook preset only happen once; per-file reruns reuse the hot pool.
- **Agent-optimized CLI.** Structured JSON + exit codes; fast loops, lean on tokens.

## Install & setup (1 min)

Recommended: scaffold with [davstack init](../init/README.md)

```bash
pnpx @davstack/init
```

(cd to your project repo first - vitest-server is scoped to codebase)

(more info: [setup.md](./docs/setup.md))

## Usage Example

1. Start server

```bash
davstack start
```

(more info: [davstack tui](../tui/README.md))

2. Rerun a file against the warm daemon

```bash
vitest-server run src/feat/chart-views/LineChart/LineChartView.stories.tsx
```

Result:

```
{"ok":false, "durationMs":3120, "file":"…/LineChartView.stories.tsx", "errors":[...]}
```

Exit 0 on pass / 1 on fail.

(more info: [usage.md](./docs/usage.md))

## Docs

- [docs/setup.md](./docs/setup.md) — config file, runtime matrix, `primeFile` semantics
- [docs/usage.md](./docs/usage.md) — CLI verbs, HTTP API, agent TDD loop
- [docs/troubleshooting.md](./docs/troubleshooting.md) — `(0 test)`, version mismatch, Bun-on-Windows
