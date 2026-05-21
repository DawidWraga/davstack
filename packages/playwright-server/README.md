# @davstack/playwright-server

Warm chromium daemon. Boots a single chromium context with your auth state once and keeps it hot; spec reruns and `goto`/`refresh-auth` verbs execute against the live window in 1-3 seconds instead of paying ~15-25s of cold-boot per iteration. Designed for the agent feedback loop — fast enough that the agent can drive UI exploration interactively.

## Quick Start

Install in the consumer project (peer dep is `@playwright/test`):

```bash
npm i -D @davstack/playwright-server @playwright/test
```

Boot the daemon in the background, then drive it with cheap (~50 ms) client verbs:

```bash
# 1. start the warm browser (long-lived)
npx playwright-server serve &

# 2. navigate the live page
npx playwright-server goto /dashboard

# 3. run a spec against the warm window
npx playwright-server run e2e/spec.ts

# 4. when finished
npx playwright-server shutdown
```

Other verbs: `refresh-auth` (mint a fresh session and reseed the live context) and `health` (liveness check).

## Configuration

Drop a `.davstack/config/playwright-server.config.ts` (or `playwright-server.config.ts` at project root) describing how the daemon should mint sessions and where to persist them:

```ts
// playwright-server.config.ts
import type { ServerConfig } from '@davstack/playwright-server'

const config: ServerConfig = {
  baseUrl: 'http://localhost:3001',
  storageStatePath: 'e2e/.auth/user.json',
  profilePath: '.playwright-profile',
  refreshAuth: async () => {
    // return a Playwright StorageState (cookies + origins[].localStorage)
    // or null if login failed. Called on boot and via `refresh-auth`.
    return null
  },
}

export default config
```

Fields:

- `baseUrl` — origin the warm context navigates against
- `storageStatePath` — where the seeded storageState JSON lives (cookies + localStorage)
- `profilePath` — fallback persistent-profile dir when no seed is present
- `refreshAuth` — optional async hook that returns a fresh `StorageState`; the daemon writes it to `storageStatePath` and reseeds the live context

The skill never knows the consumer's auth shape — `refreshAuth` is where you wire your login flow.

## Flags

`serve` accepts:

- `--port` (default `5180`, env `PLAYWRIGHT_SERVER_PORT`)
- `--host` (default `127.0.0.1`, env `PLAYWRIGHT_SERVER_HOST`)
- `--cwd` (default `process.cwd()`) — consumer project root where the config lives

All client verbs accept `--port` / `--host` to point at a non-default daemon.
