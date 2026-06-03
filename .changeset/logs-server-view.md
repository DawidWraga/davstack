---
"@davstack/logs-server": minor
---

Add a `view` CLI verb to render traces from the local sink.

The viewer encodes the sink's own schema (the `runtime` column, `measurement.*` root-span attrs, the `kind ∈ span|log|event` enum, `parent_span_id` resolution, the transaction→span shred), so it lives in the package and ships versioned with that schema instead of being copied into each consuming repo.

- `logs-server view <trace_id>` — genuinely nested waterfall (DFS span tree via `parent_span_id`; logs slot under their enclosing span, orphans float at root by timestamp), with a web-vitals + request header read off the root span.
- `logs-server view --list [--n N]` — N most-recent traces with row/span/runtime summary.
- `logs-server view --cross [--n N]` — scan recent traces for ones spanning >1 runtime; the browser↔server trace-propagation feedback-loop command.
- Writes Markdown to `.davstack/view.md` by default (trace tables are wide and wrap badly in a terminal); `--stdout` prints instead. Flags: `--db` (accepts a bare session name → `.davstack/logs/<name>.db`, or a path), `--ids`, `--limit`, `--out`.
