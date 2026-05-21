# Auth

Every spec re-logging in is the slow, brittle path. The daemon avoids it by booting chromium with a pre-seeded `StorageState` (cookies + per-origin localStorage) so the warm page starts authenticated and stays that way across `run` / `goto` calls.

The **daemon stays auth-agnostic** — it doesn't know how to mint a session for your app. The consumer wires that in via a `refreshAuth` hook in the config.

## The two pieces

| Piece | Owner | Purpose |
|-------|-------|---------|
| `storageStatePath` (file) | daemon writes, chromium reads | The seed. Playwright `StorageState` JSON: `{ cookies, origins[].localStorage }`. |
| `refreshAuth` (function) | **you** | Mints a fresh `StorageState`. Called on boot (if storage doesn't exist or is stale) and via the `refresh-auth` verb. |

## Lifecycle

On `serve`:

1. Daemon loads the config.
2. If `refreshAuth` is configured, daemon calls it. The returned `StorageState` (or `null` for failure) is written to `storageStatePath`.
3. Daemon reads `storageStatePath`. If present, chromium boots with `newContext({ storageState })` + an init-script that re-applies the localStorage entries on every navigation (belt-and-braces vs auth-providers that clear state on superseded JWTs).
4. If no seed and no `refreshAuth`, chromium falls back to `launchPersistentContext(profilePath)` — the user logs in once interactively; cookies persist in `.playwright-profile/`.

On `playwright-server refresh-auth`:

- Re-runs the same `refreshAuth` → write → reseed flow, then replays localStorage into the live page if the page's URL is already on the seeded origin. No browser restart.

If `refreshAuth` is unset:

```
[playwright-server] no refreshAuth in config — using existing storageStatePath as-is
```

The daemon will use whatever is on disk. You're responsible for keeping it fresh (re-run your login script, then `playwright-server refresh-auth` to reseed the live context — though without `refreshAuth` configured, `refresh-auth` will fail with `refreshAuthState failed`).

## `refreshAuth` shape

From `src/auth.ts`:

```ts
type StorageStateOrigin = {
  origin: string
  localStorage: { name: string; value: string }[]
}

type StorageState = {
  cookies: unknown[]
  origins: StorageStateOrigin[]
}

type ServerConfig = {
  baseUrl: string
  storageStatePath: string
  profilePath: string
  refreshAuth?: () => Promise<StorageState | null>
}
```

Return `null` to signal a failed login — the daemon logs it and falls through to the persistent-profile path.

## Example shapes

How you mint the state is project-specific. Three common patterns:

**A. Dev backdoor route** — easiest. App exposes `POST /api/dev-login` in dev that returns a JWT; refresh writes it as localStorage under your origin:

```ts
refreshAuth: async () => {
  const res = await fetch("http://localhost:3000/api/dev-login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "dev@example.com" }),
  })
  if (!res.ok) return null
  const { token } = await res.json()
  return {
    cookies: [],
    origins: [
      {
        origin: "http://localhost:3001",
        localStorage: [{ name: "auth_token", value: token }],
      },
    ],
  }
}
```

**B. Real login API** — call your prod login endpoint with a dev user, copy `Set-Cookie` into the StorageState `cookies` array. See [Playwright `StorageState` docs](https://playwright.dev/docs/api/class-browsercontext#browser-context-storage-state) for the exact cookie shape Playwright expects.

**C. UI login via a separate chromium** — spawn your own `chromium.launch()` inside `refreshAuth`, fill the login form, then `context.storageState()` to snapshot. Heaviest, but works for OAuth / SSO flows.

## File hygiene

Both files contain secrets and machine-local cache. Gitignore them:

```
# .gitignore
.playwright-profile/
e2e/.auth/
```

`davstack-init --tools=playwright-server` appends these for you. `storageStatePath` defaults to `e2e/.auth/user.json`; if you change the location, update the ignore.
