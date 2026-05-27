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

## Spec files

You can now write normal Playwright specs — full TypeScript, module-level
imports + helpers, multiple `test()` blocks, `test.describe`,
`test.beforeEach` / `afterEach`, and `test.use({ storageState })`. The
daemon loads the file as a real ES module and intercepts the
`@playwright/test` registration calls, running each captured test against
the warm browser sequentially.

```ts
// e2e/smoke.spec.ts — runs end-to-end against the warm daemon
import { test, expect } from "@playwright/test"

function isLoggedIn(page) { return page.locator("[data-testid=user]").isVisible() }

test.describe("smoke", () => {
  test.beforeEach(async ({ page }) => { await page.goto("/") })

  test("dashboard loads", async ({ page }) => {
    expect(await isLoggedIn(page)).toBe(true)
  })

  test("nav to settings", async ({ page }) => {
    await page.getByRole("link", { name: "Settings" }).click()
    await expect(page).toHaveURL(/\/settings/)
  })
})
```

### Limitations

- **Custom `test.extend(...)` fixtures are not supported yet.** If the
  daemon encounters a spec using `test.extend`, it fails fast with a
  pointer to this limitation. Workarounds: use `test.beforeEach` for
  shared setup, or call module-level helper functions. Support is
  planned.
- **Single warm browser context, run sequentially.** All tests share the
  same page (it's reset between tests). Tests that require isolation
  beyond a page reset (separate storage state, separate context) are
  best run via vanilla `playwright test`.
- **Requires Node >= 22.6** for native TypeScript loading
  (`--experimental-strip-types`, default in Node 24). On older Node,
  set `legacyExtract: true` in `playwright-server.config.ts` to use the
  single-test source-extractor (codegen-style specs).

### Legacy mode

The original regex-based extractor is still available — set
`legacyExtract: true` in `playwright-server.config.ts`. Useful for
codegen-style specs where you want minimal evaluation overhead.

## Docs

- [docs/setup.md](./docs/setup.md) — config file, defaults, peer-dep, sanity check
- [docs/usage.md](./docs/usage.md) — CLI verbs, HTTP API, agent-loop pattern
- [docs/auth.md](./docs/auth.md) — `refreshAuth` seam + `storageStatePath` lifecycle
- [docs/troubleshooting.md](./docs/troubleshooting.md) — port conflicts, missing chromium, stale auth, extractor restrictions
