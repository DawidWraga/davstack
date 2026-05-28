# Setup

## 1. Config file

`<repo-root>/.davstack/config/vitest-server.config.ts`:

```ts
export default {
  port: 5179,
  host: "127.0.0.1",
  primeFile: "src/components/Button/Button.stories.tsx",      // see §2
}
```

Other options: `project` filters the daemon to a single vitest project (rarely needed — only when your repo has multiple vitest projects and one should stay warm).

Per-key precedence: **CLI flag (`--project` / `--prime` / `--port` / `--host`) > env var (`VITEST_SERVER_PORT` / `VITEST_SERVER_HOST` / `VITEST_SERVER_PRIME_FILE`) > config file > built-in default.**

Recommended: scaffold with `pnpx @davstack/init` (from your project root) — it installs the package and writes this config. To scaffold only the config without the full init flow: `pnpm exec davstack-init --tools=vitest-server`.

For monorepos, pass `--cwd <path/to/workspace>` on `serve` so the daemon resolves `vitest/node` from the right `node_modules` and runs `findFirstStoryFile` under the right tree. The config is discovered by walking up from `cwd` to the repo root.

Full config shape lives in `src/config.ts` (`ServerConfig`).

## 2. `primeFile` — why it matters

The storybook addon-vitest plugin only fully wires its per-story `transform` hook after seeing **one valid story file through the CLI path on boot**. A noop or empty filter half-initialises the plugin and every subsequent rerun silently yields `(0 test)`.

From `src/session.ts`:

> Pass a REAL story file as the boot cliFilter, not [] or a noop pattern. The storybook plugin only fully wires up its per-story `transform` hook after seeing one valid file through the CLI path; a no-op leaves the plugin half-initialised and subsequent reruns yield "(0 test)".

If `primeFile` is omitted the daemon walks `cwd` looking for the first `*.stories.{tsx,jsx,ts,js,mdx}` (skipping `node_modules` / `dist` / `build` / `.git` / dotfiles) and logs the auto-discovered path. Set it explicitly once you know which file is cheap to prime — the auto-discovery picks whatever it finds first.

For plain unit projects (no storybook addon), point `primeFile` at any real `*.test.{ts,tsx}` in the project.

## 3. Runtime matrix

| Runtime | Status | Notes |
|---------|--------|-------|
| **Node 24+ with `--experimental-transform-types`** | recommended | The bundled `bin/vitest-server.mjs` launcher sets this up. No build step. |
| Bun (Linux / macOS) | works | Pure `node:http` + `node:fs` — no `Bun.serve` / `bun:sqlite` dependency. |
| Bun (Windows) | **broken** | Storybook 10.3 produces malformed `file:/C:/…` URLs inside the vitest preset loader; the playwright-browser-mode worker then times out the connect. |
| tsx | **broken** | Its tsconfig-paths resolver misfires on `@vitest/mocker/node_modules/estree-walker` → `ERR_PACKAGE_PATH_NOT_EXPORTED`. |

The HTTP adapter uses `node:http` (not `Bun.serve`) and the session uses pure Node APIs — both runtimes work without code branches.

## 4. Peer dependencies

- `vitest` >= 4 (required)
- `@vitest/browser` >= 4 (optional — required for browser-mode projects)
- `@storybook/addon-vitest` >= 10 (optional — required if you host stories)

The daemon `createRequire`s `vitest/node` from the consumer `cwd`, not from its own package dir. Install peers in the project under test, not in the package containing `@davstack/vitest-server`.

## 5. Sanity check

```bash
pnpm exec vitest-server serve &
pnpm exec vitest-server health
# → { "ok": true, "pid": 12345 }
```

If you get a `connect ECONNREFUSED` the daemon either crashed on boot (check the `serve` log — usually a missing peer or a bad `primeFile`) or is listening on a different port (check `VITEST_SERVER_PORT`).
