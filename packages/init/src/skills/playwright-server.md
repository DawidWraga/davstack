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

<!-- GENERATED from skills/playwright-server/SKILL.md by scripts/sync-init-skills.ts — DO NOT EDIT BY HAND -->

> Doc links in this skill are written relative to your project root (where `node_modules/` lives), not to this file.

Boot once per session, then drive cheaply. First run `davstack check` to
confirm the daemon is running.

> If `davstack check` reports a daemon down, ask the user to run `davstack start` in a **separate terminal** — this makes the whole session faster. Claude can't run it for you; it must live in its own terminal. Do not run `serve` yourself.

Once the daemon is up, drive it with the per-daemon CLI:

    playwright-server run <file>             # warm rerun (~1-3s); JSON RunResult
    playwright-server goto <url>             # navigate live page (returns { url })
    playwright-server refresh-auth           # mint a fresh session, reseed context

Exit `0` = pass, `1` = fail. Specs are loaded as real ES modules — full
TypeScript, multiple `test()` blocks, `test.describe`, `beforeEach` /
`afterEach`, and `test.use({ storageState })` all work. Custom
`test.extend(...)` fixtures are the one current gap. See
[`usage.md`](node_modules/@davstack/playwright-server/docs/usage.md) for details.

If results look wrong (blank window, cold-boot crash, `no test() block found`, 401 redirects, daemon exit 1), the failure is usually in the daemon, not your code — check `troubleshooting.md` before iterating, or fall back to `playwright test`.

## Reference

- [`README.md`](node_modules/@davstack/playwright-server/README.md) — overview, install, why
- [`docs/setup.md`](node_modules/@davstack/playwright-server/docs/setup.md) — config file, defaults, peer-dep, sanity check
- [`docs/usage.md`](node_modules/@davstack/playwright-server/docs/usage.md) — CLI verbs, HTTP API, codegen-paste workflow, agent-loop pattern
- [`docs/auth.md`](node_modules/@davstack/playwright-server/docs/auth.md) — `refreshAuth` seam + `storageStatePath` lifecycle
- [`docs/troubleshooting.md`](node_modules/@davstack/playwright-server/docs/troubleshooting.md) — the daemon-vs-code triage tree
