# @davstack/vitest-server

Warm vitest daemon. Boots vitest once with your storybook addon + browser-mode config and keeps it hot in the background; per-file reruns hit the running daemon over HTTP instead of paying ~50s of cold-start each time. The agent feedback loop becomes ~3-15s/iter, fast enough for TDD-driven iteration.

## Why this exists

A cold `vitest run path/to/foo.stories.tsx` against a storybook-addon-vitest + playwright-browser-mode project takes ~50 seconds: Vite optimize, playwright browser launch, storybook preset load, story compile. Run it five times in a TDD loop and you've spent four minutes waiting on identical setup. `vitest-server` boots that pipeline once and keeps it warm in the background; subsequent reruns reuse the running pool and finish in 3-15s.

## Quick start

```bash
# Boot the daemon (heavy — ~50s cold).
npx vitest-server serve &

# Rerun a file against the warm daemon (~3-15s).
npx vitest-server run path/to/spec.test.tsx

# Filter to a single test by name.
npx vitest-server run path/to/spec.test.tsx --grep "renders empty state"

# Health check.
npx vitest-server health

# Stop it.
npx vitest-server shutdown
```

The CLI talks to the daemon over HTTP (default `127.0.0.1:5179`). Override with `--host` / `--port` or `VITEST_SERVER_HOST` / `VITEST_SERVER_PORT`.

## Configuration

Drop a `vitest-server.config.ts` (or `.davstack/config/vitest-server.config.ts`) at your project root:

```ts
export default {
  // Vitest project filter — usually a dedicated browser-mode project
  // wired up by @storybook/addon-vitest.
  project: 'storybook',
  // A REAL story/test file used to prime the storybook plugin's per-story
  // transform hook on boot. Must exist; a noop pattern leaves the plugin
  // half-initialised and subsequent reruns yield "(0 test)".
  primeFile: 'src/components/Button/Button.stories.tsx',
}
```

Or pass `--project` / `--prime` on the `serve` command. If `primeFile` is omitted the daemon auto-discovers the first `*.stories.{tsx,jsx,ts,js,mdx}` it finds under cwd.

## Peer dependencies

- `vitest` >=4 (required)
- `@vitest/browser` >=4 (optional — required if you use browser-mode)
- `@storybook/addon-vitest` >=10 (optional — required if you host storybook stories)

The daemon resolves these from the consumer project's `node_modules`, not its own — install them in the project you're testing.

## Runtime notes

Recommended runtime is Node 24+ with `--experimental-transform-types` (the bundled `bin/vitest-server.mjs` launcher sets this up for you). Bun works on Linux/macOS but breaks on Windows due to malformed `file:/C:/…` URLs in the storybook 10.3 preset loader. `tsx` fails on an estree-walker resolver issue. See `src/session.ts` for the full matrix.
