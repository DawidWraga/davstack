# Setup

## 1. Install

Recommended: scaffold with [davstack init](../../init/README.md) (from your project root):

```bash
pnpx @davstack/init
```

This installs `@davstack/playwright-server` + `@playwright/test` and writes the config in §2.

Then, regardless of how you installed, fetch chromium once per machine:

```bash
pnpm exec playwright install chromium
```

If chromium isn't installed the daemon throws on `chromium.launch`.

### Manual install (fallback)

`@playwright/test >=1.50` is a peer dep — the daemon resolves it from the consumer project's `node_modules` (not its own), so the consumer must install it:

```bash
pnpm add -D @davstack/playwright-server @playwright/test
pnpm exec playwright install chromium
```

## 2. Config file

`<repo-root>/.davstack/config/playwright-server.config.ts`:

```ts
import type { ServerConfig } from "@davstack/playwright-server"

const config: ServerConfig = {
  baseUrl: "http://localhost:3001",
  storageStatePath: "e2e/.auth/user.json",
  profilePath: ".playwright-profile",
  // refreshAuth: async () => { ... }   // see docs/auth.md
}

export default config
```

If you used `pnpx @davstack/init` in §1 the config + `.gitignore` entries (`.davstack/*` / `!.davstack/config/` + `.playwright-profile` + `e2e/.auth`) are already in place. To scaffold only the config without the full init flow: `pnpm exec davstack-init --tools=playwright-server`.

The daemon resolves the config via `findToolConfig` (walks up from `--cwd` looking for `.davstack/config/playwright-server.config.ts` or a project-root `playwright-server.config.ts`). When no config is found, the built-in `DEFAULT_CONFIG` is used.

### Defaults

| Key | Default | Purpose |
|-----|---------|---------|
| `baseUrl` | `http://localhost:3001` | Origin the warm context navigates against (used as Playwright `baseURL` so relative `goto` works). |
| `storageStatePath` | `e2e/.auth/user.json` | Where the seeded Playwright `StorageState` JSON lives. Cookies + per-origin localStorage. |
| `profilePath` | `.playwright-profile` | Fallback persistent-profile dir when no `storageState` seed exists. |
| `refreshAuth` | _unset_ | Async hook that mints a fresh `StorageState`. See [docs/auth.md](./auth.md). |

### Flags / env

`serve` flags:

| Flag | Env | Default |
|------|-----|---------|
| `--port` | `PLAYWRIGHT_SERVER_PORT` | `5180` |
| `--host` | `PLAYWRIGHT_SERVER_HOST` | `127.0.0.1` |
| `--cwd` | — | `process.cwd()` (consumer project root where the config lives) |

Client verbs (`run` / `goto` / `refresh-auth` / `health` / `shutdown`) accept `--port` / `--host` to point at a non-default daemon.

## 3. Runtime

The bin shim spawns **`node`** with `--experimental-transform-types` (no build step). Requires Node 24+ per `engines`. Bun is intentionally NOT used — chromium's debug-protocol pipe hangs under Bun today; Node is the supported launcher.

## 4. Sanity check

```bash
# in one shell
pnpm exec playwright-server serve

# in another shell
playwright-server health
# → {"ok":true,"pid":12345,"url":"about:blank"}

playwright-server goto https://example.com
# → {"url":"https://example.com/"}
```

If the chromium window opens, navigates, and `health` reports a live `pid`, you're wired up.
