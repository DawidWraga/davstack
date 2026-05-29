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

<!-- GENERATED from skills/vitest-server/SKILL.md by scripts/sync-init-skills.ts — DO NOT EDIT BY HAND -->

Boot once per session, then rerun cheaply. First run `davstack check` to
confirm the daemon is running.

Once the daemon is up, drive it with the per-daemon CLI:

    vitest-server run <file>           # warm rerun (~3-15s); JSON RunResult on stdout

Exit `0` = pass, `1` = fail. The full `RunResult` shape (per-test entries,
error stacks, run-level errors) is on stdout — pipe to `jq` if you only
want failing tests.

Don't restart the daemon between runs — the warm pool is the entire point.

If results look wrong (`(0 test)`, suite errors, post-config-edit weirdness), the failure is usually in the daemon, not your code — check `troubleshooting.md` before iterating, or fall back to `vitest run`.

## Reference

- [`README.md`](../../../node_modules/@davstack/vitest-server/README.md) — overview, install, why
- [`docs/setup.md`](../../../node_modules/@davstack/vitest-server/docs/setup.md) — config file, runtime matrix, `primeFile` semantics
- [`docs/usage.md`](../../../node_modules/@davstack/vitest-server/docs/usage.md) — CLI verbs, HTTP API, `RunResult` shape, agent TDD loop
- [`docs/troubleshooting.md`](../../../node_modules/@davstack/vitest-server/docs/troubleshooting.md) — the daemon-vs-code triage tree

## CLI reference

<!-- BEGIN cli-reference (generated — do not edit by hand) -->

`vitest-server` — Long-lived Vitest daemon + CLI client for fast story/unit reruns.

- `vitest-server serve` — Boot the long-lived Vitest daemon
- `vitest-server run <file>` — Rerun a file against the running daemon
- `vitest-server refresh` — Flush vitest transform cache + vite-node module cache and re-read config without restarting (keeps the warm vitest instance alive). Pass --hard for a full shutdown + detached re-serve when soft refresh is insufficient.
- `vitest-server health` — Daemon liveness check
- `vitest-server shutdown` — Stop the running daemon
- `vitest-server doctor` — Validate local install (node, peer dep, config, daemon liveness)

Run `vitest-server <command> --help` for the full flags and options of any command.

<!-- END cli-reference -->
