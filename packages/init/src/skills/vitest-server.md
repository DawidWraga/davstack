---
name: vitest-server
description: >-
  Rerun a vitest test or storybook story file against a warm long-lived
  daemon — story/unit reruns drop from ~50s cold to ~3-15s warm. Use when
  the user asks to run / rerun a specific `.test.ts` / `.stories.tsx` file,
  or you've just edited code and want a fast pass/fail cycle. Skip for
  cold one-off CI checks (`vitest run` is fine) or when configuring vitest
  itself (daemon caches go stale).
---

Boot once per session, then rerun cheaply. First run `davstack check` to
confirm the daemon is running.

> If `davstack check` reports a daemon down, ask the user to run `davstack start` in a **separate terminal** — this makes the whole session faster. Claude can't run it for you; it must live in its own terminal. Do not run `serve` yourself.

Once the daemon is up, drive it with the per-daemon CLI:

    vitest-server run <file>           # warm rerun (~3-15s); JSON RunResult on stdout

Exit `0` = pass, `1` = fail. The full `RunResult` shape (per-test entries,
error stacks, run-level errors) is on stdout — pipe to `jq` if you only
want failing tests.

Don't restart the daemon between runs — the warm pool is the entire point.

If results look wrong (`(0 test)`, suite errors, post-config-edit weirdness), the failure is usually in the daemon, not your code — check `troubleshooting.md` before iterating, or fall back to `vitest run`.

## Reference

- [`README.md`](../../packages/vitest-server/README.md) — overview, install, why
- [`docs/setup.md`](../../packages/vitest-server/docs/setup.md) — config file, runtime matrix, `primeFile` semantics
- [`docs/usage.md`](../../packages/vitest-server/docs/usage.md) — CLI verbs, HTTP API, `RunResult` shape, agent TDD loop
- [`docs/troubleshooting.md`](../../packages/vitest-server/docs/troubleshooting.md) — the daemon-vs-code triage tree
