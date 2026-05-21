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

Boot once per session, then rerun cheaply.

    vitest-server check                # verifies daemon liveness + config
    vitest-server serve &              # boot if check fails (heavy ~50s first time)
    vitest-server run <file>           # warm rerun (~3-15s); JSON RunResult on stdout

Exit `0` = pass, `1` = fail. The full `RunResult` shape (per-test entries,
error stacks, run-level errors) is on stdout — pipe to `jq` if you only
want failing tests.

If `check` reports the daemon isn't running, `serve` it once and wait for
the listening line before invoking `run`. Don't restart `serve` between
runs — the warm pool is the entire point.

If results look wrong (`(0 test)`, suite errors, post-config-edit weirdness), the failure is usually in the daemon, not your code — check `troubleshooting.md` before iterating, or fall back to `vitest run`.

## Reference

- [`README.md`](../../packages/vitest-server/README.md) — overview, install, why
- [`docs/setup.md`](../../packages/vitest-server/docs/setup.md) — config file, runtime matrix, `primeFile` semantics
- [`docs/usage.md`](../../packages/vitest-server/docs/usage.md) — CLI verbs, HTTP API, `RunResult` shape, agent TDD loop
- [`docs/troubleshooting.md`](../../packages/vitest-server/docs/troubleshooting.md) — the daemon-vs-code triage tree
