---
name: logs-server
description: >-
  Query a local Sentry-shaped log sink (per-repo `.davstack/logs.db`) for
  cross-service timelines, error windows, or `trace_id` / `run_id` slices.
  Use when the user references a failed request, agent run, or test
  invocation and you need the actual log timeline rather than guessing.
  Also use when planting hypothesis-driven probes during a `diagnose`
  loop. Skip for tail-following live stdout (use the dev server directly)
  or for prod logs (this is local-only).
---

First run `davstack check` to confirm the daemon is running. If it isn't,
the command prints the start instructions.

The query CLI reads `.davstack/logs.db` directly — it works even if the
ingest daemon isn't running. You only need `serve` running for the app to
write new envelopes.

    logs-server check                                  # verifies sink reachable + DB has rows
    logs-server query trace --trace <id>               # cross-service assembly for one trace
    logs-server query run   --run <id>                 # timeline for one invocation
    logs-server query errors --context 20              # errors + N surrounding rows
    logs-server query filter --grep "<msg>" --limit 50 # generic level/grep/run/trace cut

Default output is one-row-per-line, agent-readable. Add `--json` to pipe
into `jq`. Indexed columns: `project, run_id, trace_id, level, ts` —
filter on those first, then `--grep` for substring within the result set.

## Investigation pattern

1. Get a `trace_id` or `run_id` from the user (the chat message, the
   error stamp, or the URL hash that holds `__diagRunId`).
2. `query trace` / `query run` to see the full timeline.
3. If too noisy, narrow with `query errors` or `query filter --level error`.
4. For fat data payloads, use `--json | jq '.[] | .data.<field>'` rather
   than dumping the whole row.

For hypothesis-driven probe-then-slice debugging, see `writing-logs.md`.

If a query returns empty or hits the wrong DB, the failure is usually in the sink config or transmitter, not your search — `check` reports the resolved path and recent row count; see `setup.md` for transmitter wiring.

## Reference

- [`README.md`](../../packages/logs-server/README.md) — overview, install, why
- [`docs/setup.md`](../../packages/logs-server/docs/setup.md) — config file, transmitter setup, auto-instrumentation
- [`docs/writing-logs.md`](../../packages/logs-server/docs/writing-logs.md) — queryable shape, hypothesis-driven probes
- [`docs/reading-logs.md`](../../packages/logs-server/docs/reading-logs.md) — every query verb + raw sqlite recipes
