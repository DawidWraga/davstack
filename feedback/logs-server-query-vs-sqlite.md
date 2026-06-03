Reflections from a real diagnosis session using `logs-server` end-to-end (planting structured probes, running an e2e repro under `playwright-server`, querying the sink, fixing two React state bugs, iterating). I started using the `query` verb, hit limits, switched to raw sqlite at the user's suggestion and finished the diagnosis in half the time. Sharing concrete pain points + what worked extraordinarily well.

## Where `query` fell short

1. **Output shape hid the payload.** `query filter --grep "<probe-tag>"` returned `msg` + level + ts but my diagnostic attributes (the actual structured fields I planted) lived in `data.attributes.<key>.value` — invisible without `--json`. So the verb that *should* be perfect for probe inspection actually withheld the probe's point.

2. **`--json` was unreliable as a pipe source.** Every invocation prefixed with `(node:NNNN) DeprecationWarning: ...` + `[logs-server] loaded config from ...` on stdout. Both `python json.load` and `jq` choke. I had to `tail -n +N` past the preamble each time — fragile and load-bearing on a count that could change.

3. **`--limit` returns ascending by ts when grep matches many.** "Show me the last run" — natural query — required parsing all 500 and sorting client-side. With sqlite: `ORDER BY ts DESC LIMIT 20`. Done.

4. **No compound predicates / aggregation.** I needed `ts > X AND seam NOT IN (...) ORDER BY ts` and a `GROUP BY seam` histogram (sanity-check for infinite loops post-fix). Impossible via verb. Trivial in sqlite.

5. **Did the work twice.** First with `query`, hit limits, switched to sqlite. The verb is overhead when the destination is always sqlite.

## Where sqlite shone

One-liner:

```sql
SELECT ts,
       json_extract(data, '$.body') AS msg,
       json_extract(data, '$.attributes.seam.value') AS seam,
       json_extract(data, '$.attributes.<myField>.value') AS myField
FROM logs
WHERE ts > <baseline> AND seam IS NOT NULL
ORDER BY ts;
```

Picked exactly the projection I needed, filtered cleanly, surfaced the structured attributes. The whole diagnostic timeline I needed in one query.

## Recommendation

- **Keep `check`** — daemon-liveness with row count and DB path is genuinely useful and not replicable in one sqlite line.
- **Drop or refocus `query`.** If kept, make it `query timeline --since 5m --seam X` that pretty-prints `data.attributes.*` flattened. Currently it's an awkward middle ground — fancy enough to feel like a tool, limited enough that you reach past it.
- **Send the preamble to stderr.** If keeping `query --json`, the deprecation warning + config-loaded banner MUST not pollute stdout. This is a 2-line fix and unlocks `| jq`.
- **Ship sqlite recipes in `reading-logs.md`.** The `json_extract(data, '$.attributes.<key>.value')` pattern is the unlock — not obvious from the schema alone. A 5-recipe cheat-sheet (timeline, errors-with-context, seam histogram, run slice, trace slice) would let me skip the `query` verb entirely.

## Broader debug-workflow reflections

What worked extraordinarily well:

- **Structured probes with a `seam` field.** Every entry self-identifies its source — made the SQL trivial and made "which probe is THIS line from" never a question. Convention worth promoting in `writing-logs.md`.
- **Probe-plant → repro → query loop.** Sub-30s iteration. The `playwright-server` warm daemon (~10-20s per run) + sqlite query (~50ms) made hypothesis testing essentially free. Two iterations to pinpoint the first bug (a stale-closure-on-multi-setter React race), one more for the second (TanStack column-state pinning).
- **Logs survive across runs.** Multiple repro runs accumulated in the same DB — I could compare pre-fix and post-fix probe shapes side-by-side. Try doing that with stdout-only Sentry.

What I'd change:

- **Add a "probe expiry" affordance.** Old probe entries from sessions ago kept polluting grep results. A `--since` flag (or a project-default of "last 10 min") would help, but better: when iterating, I want a one-shot `mark a baseline ts, query relative-to-baseline`. Workaround today is just `WHERE ts > <number I copied from MAX(ts)>`.
- **The decimal-second timestamps are annoying.** `1779889134.27` is unreadable. A `--ts-format human` column projection would save brain cycles.
- **Probe lifecycle is unsolved.** Keeping probes until validation is the right policy but means probes accumulate. `git grep <probe-tag>` cleanup at PR-prep works, but a `probe(...)` macro that compiles out in production (or strips on a build flag) would be neat.

Net: the workflow itself (probe → warm repro → SQL → fix → re-probe) is excellent. The `query` verb is the weakest link, and sqlite directly is strictly better once you know the JSON path pattern.
