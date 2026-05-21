---
name: playwright-server
description: >-
  Run a Playwright spec or drive a live browser against a warm long-lived
  chromium daemon — spec iteration drops from ~15-25s cold to ~1-3s warm.
  Use when the user asks to run / rerun an e2e spec, click through a flow,
  reproduce a bug in-browser, or you've just edited a spec and want a
  fast pass/fail cycle. Auth persists across runs via `storageStatePath`.
  Skip for full-suite CI runs (use `playwright test` directly) or when
  configuring playwright itself.
---

Boot once per session, then drive cheaply.

    playwright-server check                  # daemon liveness + chromium + auth
    playwright-server serve &                # boot if check fails (~5-15s)
    playwright-server run <file>             # warm rerun (~1-3s); JSON RunResult
    playwright-server goto <url>             # navigate live page (returns { url })
    playwright-server refresh-auth           # mint a fresh session, reseed context

Exit `0` = pass, `1` = fail. Spec extractor runs **only the first top-level
`test('...', async ({ page, ... }) => { ... })`** — no `describe`, no
hooks, no custom fixtures. Wrap codegen output in that exact shape;
otherwise see [`usage.md`](../../packages/playwright-server/docs/usage.md).

If results look wrong (blank window, cold-boot crash, `no test() block found`, 401 redirects, daemon exit 1), the failure is usually in the daemon, not your code — check `troubleshooting.md` before iterating, or fall back to `playwright test`.

## Reference

- [`README.md`](../../packages/playwright-server/README.md) — overview, install, why
- [`docs/setup.md`](../../packages/playwright-server/docs/setup.md) — config file, defaults, peer-dep, sanity check
- [`docs/usage.md`](../../packages/playwright-server/docs/usage.md) — CLI verbs, HTTP API, codegen-paste workflow, agent-loop pattern
- [`docs/auth.md`](../../packages/playwright-server/docs/auth.md) — `refreshAuth` seam + `storageStatePath` lifecycle
- [`docs/troubleshooting.md`](../../packages/playwright-server/docs/troubleshooting.md) — the daemon-vs-code triage tree
