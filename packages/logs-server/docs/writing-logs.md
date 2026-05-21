# Writing logs

Once your transmitter is wired up ([setup.md](./setup.md)), the question is *what to log* and *how*. Patterns below are starting points — every project layers its own conventions on top.

## The shape that makes logs queryable

```ts
logger.debug("panel-ctx.joinCleanup.no-joins-path", {
  anchorEntityId,
  validRelationshipIdsCount: validRelationshipIds.size,
  query,
})
```

Two rules:

1. **The message string is a structured name** — kebab + dot, like a routing path: `<area>.<seam>.<event>`. Predictable, greppable, stable enough to copy into commit messages.
2. **All data lives in the object, not the string.** Strings can't be `json_extract`-ed; objects can. Prefer `logger.debug("fetch.start", { url, method })` over `logger.debug(\`fetch.start url=${url}\`)`.

Cheap to write, fast to query later (`json_extract(data, '$.url')` in [reading-logs.md](./reading-logs.md)).

## What you DON'T put in each call

- **`run_id`** — already stamped globally by your `Sentry.init`'s `beforeSendLog` ([setup.md §2](./setup.md#js%2Fts)). One per page-load / process.
- **`trace_id`** — propagated automatically by `httpIntegration` / `browserTracingIntegration` via Sentry's `sentry-trace` + `baggage` headers.
- **`service`** — stamped once on `initialScope.tags` at init time.

If you're tempted to thread these manually, the init's misconfigured. Fix the init, not every call site.

## Hypothesis-driven logging (the diagnose-skill flow)

When debugging, the receiver gives you a fast loop:

1. **State the hypothesis in writing** before adding any log.
   > H3: the joinCleanup effect's stale closure emits a query snapshot from before the click landed.

2. **Plant probes at the discriminating boundary** — just before + just after the suspected event. Tag each with the hypothesis id (use an array so one probe can carry multiple tags — e.g. `["H3","joinCleanup"]`):

   ```ts
   logger.debug("panel-ctx.joinCleanup.effect-fire", {
     tags: ["H3"],
     done: joinCleanupDoneRef.current,
     relationshipsLoading,
     anchorEntityId,
     query,
   })

   logger.debug("panel-ctx.joinCleanup.no-joins-path", {
     tags: ["H3", "joinCleanup"],
     query,
   })
   ```

3. **Reproduce, then slice:**

   ```bash
   logs-server query filter --grep '"H3"' --run <id>
   ```

   The timeline shows the actual ordering and payloads — not the assumed ones.

4. **Strip the probes** once the root cause is known. (Or leave them at `debug` and rely on prune.)

The skill's value is forcing step 1 before step 2 — without a written hypothesis, you tend to dump logs everywhere and re-read noise.

## Fat objects are fine — but query carefully

It's fine to log entire state trees, query ASTs, GraphQL responses, etc. Storage is local and cheap; serialization runs in dev only. Don't pre-summarize "just in case."

**The trade-off comes at query time**, not write time. When you later run:

```bash
logs-server query filter --grep "panel-ctx.update" --json | jq '.[].data.next'
```

…you'll be staring at a 2KB object per row. A few habits keep this manageable:

- **Lead with `--grep` on the message name first**, then narrow on payload fields with `jq` / `json_extract`. Filtering on the indexed string first cuts the row set 10–100×.
- **Prefer `json_extract(data, '$.next.entity')`** over dumping the whole `data` blob to terminal. The SQL recipes in [reading-logs.md](./reading-logs.md) show the shape.
- **If one specific payload field keeps being the focus** of debugging, lift it to a top-level attribute (`tags`, `hypothesis`, etc.) so `--grep '"H3"'` works without a `jq` pass.

## What NOT to log

- **PII.** No scrubbing layer; local dev only.
- **Stack traces as separate `error` items.** Sentry's `event` envelope already carries them at `exception.values[].stacktrace`; emitting a parallel `logger.error("…", { stack })` produces duplicate rows.

## Project conventions

How you scope `service`, structure the message-string namespaces (`<area>.<seam>.<event>`), and bucket levels is project-specific. Set them once in your repo's CLAUDE.md / contributing doc — the daemon doesn't care, and tight uniformity matters less than disciplined names + object payloads.
