# Multi-DB log routing — implementation plan

**Status**: design locked, ready to file as issue + start Phase 1.
**Target version**: `@davstack/logs-server@2.0.0` for Phase 1 (breaking: default path move).
**Related**: closes / supersedes the design portion of #51 (session scoping). Builds on #52 (`logs_v` view, shipped in 1.4.0).

## Motivation

Today every log emitted by a project lands in `.davstack/logs.db`. Concurrent debug sessions (or just multiple bugs worked in the same repo) pile their logs into one file. Symptoms:

- Probe-tag greps find hits from earlier unrelated sessions ("cross-session noise" — the user-facing problem in #51).
- The cognitive cost of `WHERE ts > :baseline` scoping every query.
- Eval runs that should keep their log output co-located with their test artifacts can't — logs go to a fixed global location.

Each of these collapses if logs from a given context land in their own DB file. The DB file becomes the session boundary.

A second benefit, equally load-bearing: **per-DB views**. With per-session DBs, agents and humans can `CREATE VIEW probe AS …` in the session DB with a probe vocabulary tailored to THAT bug — and cleanup is `rm` the file. This is the "temp views with auto-cleanup" idea, achieved by making the DB itself the session boundary instead of trying to scope views within a shared DB.

## Out of scope (v1)

**Cross-service routing.** When `--db=reorder-bug` is set, only logs from the frontend (which reads the value at boot) land in `reorder-bug.db`. Backend logs continue to route to `default.db`. The user's stack today is frontend-emission-only, so this isn't a felt loss. If/when cross-stack tracing becomes a concrete pain, design a v2.X to add it — likely either an explicit `X-Davstack-Db` header that backends propagate, or a daemon-side `trace_id → db` correlation cache. Both were considered for v1 and deferred: the header approach asks meaningful work of every backend service; the correlation cache is implicit-state magic that's hard to debug when it misbehaves. Wait for real cases.

**Listing / cleanup tooling.** `ls .davstack/logs/` + `rm` are fine. No `logs-server db list / drop` verbs in v1. Revisit if friction shows up.

**Sentry integration sub-package.** Not shipping `@davstack/logs-server/sentry`. The consumer wiring is small (3 lines in their `sentry.ts`); a package wrapper adds peer-dep / version-compat maintenance for marginal ergonomic gain. Document the snippet instead.

## What we're building (high level)

```
[browser tab w/ frontend transmitter]
    │ Sentry envelope POST (existing DSN, no transport changes)
    │ each log envelope carries attributes['davstack-logs.db'].value if set
    ↓
[logs-server daemon @ :5181]
    │ reads attributes['davstack-logs.db'].value from each log
    │ validates + resolves to a path
    │ getOrOpenDb(<resolved>) → cached Database handle
    │ strips the routing attribute from data before persisting
    │ first open: CREATE TABLE + idx + logs_v view (existing openDb)
    ↓
[.davstack/logs/<name>.db]   or escaped to e.g. <repo-root>/my-evals/run-1/logs.db
```

Persisted `data` is byte-for-byte the envelope's log record **minus the one daemon-managed routing key**. The DB filename IS the session indicator; nothing inside the row records which bucket it landed in.

## File layout (post-2.0)

```
<repo-root>/
  .davstack/
    logs/
      default.db          ← un-tagged emissions (no attribute set)
      reorder-bug.db      ← runs with --db=reorder-bug
      hotfix-7c.db
      column-sync.db
    config/               ← existing, untouched
      logs-server.config.ts
```

Plus, when the `..` escape is used for eval co-location:

```
<repo-root>/
  my-evals/
    runs/
      1779889134/
        test-results.json
        logs.db           ← --db=../../my-evals/runs/1779889134/logs
  .davstack/
    logs/
      default.db          ← still here for un-tagged work
```

## Wire shape: a Sentry log attribute

**Routing channel**: the Sentry log envelope attribute `davstack-logs.db` (value = the `--db` string).

Why an attribute, not a header / URL param / DSN tweak:
- The consumer (in their `sentry.ts`) already stamps attributes inside `beforeSendLog` for `diag.project` / `diag.run_id`. Adding one more line is the minimum-friction surface for them — no transport rewrite, no DSN change, no Sentry-SDK-internal customization.
- Existing CORS / proxy / Sentry-SDK behavior unchanged — the wire shape is identical to what's already crossing it.
- Value is an opaque string in the consumer's transmitter — `..` for the eval escape case just rides through as plain text. No URL encoding, no path-normalization surprises.

The daemon does its own validation + resolution server-side; the consumer never needs to know the file-path semantics.

Why `davstack-logs.db` and not `diag.db`: `diag.*` is a name-holdover from when the package was `diag` / `log-sink`. New attribute keys should use the current `@davstack/logs-server` identity. Existing `diag.project` / `diag.run_id` stay untouched (real consumers depend on those names).

## `--db` value: validation pipeline

The daemon receives one string. Pipeline:

1. **Per-segment charset**: split on `/`, each segment must match `^[a-z0-9][a-z0-9_-]*$` (lowercase alnum, hyphen, underscore; no leading separator char). Segments `.` and `..` are allowed as path-traversal tokens (validated in step 4, not 1).
2. **No absolute paths**: reject if value starts with `/` or matches `[A-Za-z]:` (Windows drive prefix).
3. **Resolve to absolute**: `path.resolve(repoRoot, '.davstack/logs', value)`. `repoRoot` discovered by walking up for `pnpm-workspace.yaml` / `turbo.json` / `package.json#workspaces` / `.git`, capped at 8 levels — the same walker `loadConfig` already uses.
4. **Containment check**: resolved path MUST start with `<repoRoot>/`. Anything resolving above `repoRoot` is rejected as "escapes repo."
5. **Auto-append `.db`** if value doesn't already end in `.db`.
6. **On reject**: log a single-line stderr warning (`[logs-server] invalid db "<value>": <reason>; routing to default.db`) and dispatch to `default.db` rather than failing. Warn-once per unique invalid value to avoid spam.

### Examples

| Input | Resolves to | Status |
|---|---|---|
| `reorder-bug` | `.davstack/logs/reorder-bug.db` | ✓ |
| `feat/reorder` | `.davstack/logs/feat/reorder.db` | ✓ subdirs ok |
| `../sandbox/x` | `.davstack/sandbox/x.db` | ✓ in repo |
| `../../my-evals/run-1/logs` | `<repoRoot>/my-evals/run-1/logs.db` | ✓ in repo |
| `../../../escaped` | `<above repoRoot>/escaped.db` | ✗ escapes repo |
| `/etc/passwd` | absolute | ✗ |
| `C:\evil` | abs (win) | ✗ |
| `Reorder-Bug` | uppercase | ✗ |
| `reorder bug` | space | ✗ |
| `reorder-bug.db` | `.davstack/logs/reorder-bug.db` | ✓ (.db pre-supplied) |

## Daemon implementation

**In `envelope.ts` (or wherever the parser lives)**: after parsing each log item, extract the routing attribute and strip it from the persisted record.

```ts
// pseudocode in toRow()
const routeKey = "davstack-logs.db"
const dbName = rec.attributes?.[routeKey]?.value as string | undefined
if (rec.attributes && routeKey in rec.attributes) {
  delete rec.attributes[routeKey]   // strip before JSON.stringify(rec)
}
return {
  ...,
  data: JSON.stringify(rec),
  _route_db: dbName,   // internal-only field, drives dispatch, not persisted
}
```

**In `ingest.ts`**: group rows by `_route_db`, dispatch each group to the appropriate `Database` handle.

```ts
// pseudocode
const groups = new Map<string | undefined, LogRow[]>()
for (const r of stamped) {
  const k = r._route_db
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k)!.push(r)
}
let accepted = 0
for (const [rawDbName, batch] of groups) {
  const resolved = rawDbName ? resolveDbPath(rawDbName, ctx.repoRoot) : ctx.defaultDbPath
  const db = ctx.handleCache.getOrOpen(resolved)
  accepted += insertLogs(db, batch)
}
```

**In `db.ts`** (or a new `db-cache.ts`): a `DbHandleCache` mapping `absolutePath → Database`.

```ts
// pseudocode
class DbHandleCache {
  private handles = new Map<string, { db: Database; lastUsed: number }>()
  private idleCloseMs = 30 * 60 * 1000  // 30 min

  getOrOpen(path: string): Database {
    const cached = this.handles.get(path)
    if (cached) {
      cached.lastUsed = Date.now()
      return cached.db
    }
    ensureParent(path)
    const db = openDb(path)  // existing — runs CREATE TABLE + idx + logs_v view
    this.handles.set(path, { db, lastUsed: Date.now() })
    return db
  }

  startIdleSweeper() {
    setInterval(() => {
      const cutoff = Date.now() - this.idleCloseMs
      for (const [p, entry] of this.handles) {
        if (entry.lastUsed < cutoff) {
          entry.db.close()
          this.handles.delete(p)
        }
      }
    }, 5 * 60 * 1000).unref()
  }
}
```

Schema-boot happens automatically via existing `openDb()` — every new DB file gets `CREATE TABLE logs`, the correlation index, and the `logs_v` view (from #52). No special-case code.

**Default DB path**: `path.resolve(repoRoot, '.davstack/logs/default.db')`. Used when the attribute is absent or invalid.

## Emission surfaces — how the value reaches the consumer

### Browser (the only surface in v1)

The runner sets a global before the app boots. The app reads it at `initSentry()` time and stamps it onto every log via the existing `beforeSendLog`.

**Runner side (`playwright-server --db=<value>`):**

```ts
// pseudocode in playwright-server's spec-runner
if (cliFlags.db) {
  await page.addInitScript((dbName) => {
    ;(window as any).__davstack_db = dbName
  }, cliFlags.db)
}
await page.goto(spec.baseUrl)
```

`addInitScript` runs before any page script — so by the time the app's bundle starts and `initSentry()` runs, `window.__davstack_db` is already populated.

**Consumer side (in their `sentry.ts`):**

Three lines added next to the existing `diagRunId` setup:

```ts
// near the top, after diagRunId is captured
const davstackDb = (window as { __davstack_db?: string }).__davstack_db ?? null

// inside the existing beforeSendLog, alongside diag.project / diag.run_id
log.attributes = {
  ...log.attributes,
  "diag.project": DIAG_PROJECT,
  "diag.run_id": diagRunId,
  ...(davstackDb && { "davstack-logs.db": davstackDb }),
}
```

No transport rewrite. No DSN change. No URL param. No integration package import. Existing Sentry init unchanged otherwise.

### Node (deferred — not in v1)

Currently no node-side emitters in the user's stack. The same shape would apply if added later: `vitest-server --db=<value>` sets `process.env.DAVSTACK_DB` on the spawned child; the test process reads it at boot and stamps the attribute in its own `beforeSendLog`. No daemon changes needed — the wire is identical.

## Phased landing

### Phase 1 — daemon-side dispatch (logs-server 2.0.0)

Self-contained, ships without touching any runner or transmitter.

**Scope:**
- `envelope.ts`: extract `davstack-logs.db` from attributes, strip from `rec` before persist, surface as internal `_route_db` field
- `ingest.ts`: group-by-`_route_db` dispatch loop
- `db.ts`: `DbHandleCache`, `resolveDbPath()`, validation
- `openDb()`: unchanged (already creates the table + index + `logs_v` view; runs per DB)
- Default path moves: `.davstack/logs.db` → `.davstack/logs/default.db`
- `prune` verb: walks `.davstack/logs/*.db` instead of single file (`--db <name>` to scope to one if needed)
- Docs updates (see Docs phase below)
- Tests: dispatch routing, validation table cases, escape rules, cache idle-close, strip-before-persist verification
- CHANGELOG `2.0.0` block with migration note

**BC notes**: requests without the attribute (i.e. everyone today) route to `default.db` in the new location. The only breaking change is the path move — anyone with hardcoded `sqlite3 .davstack/logs.db` scripts updates to `sqlite3 .davstack/logs/default.db`. The `logs-server check` verb should detect a legacy `.davstack/logs.db` file at boot and print a one-line migration hint.

**Not in this phase**: no runner flags, no transmitter changes, no node-side stamping. Phase 1 is a pure daemon upgrade. Until Phase 2/3 land, nobody is setting the attribute, so behavior is identical to today except the file moves into `logs/`.

### Phase 2 — `playwright-server --db` flag

One package, minor bump (likely `@davstack/playwright-server@1.4.0`):

- Add `--db=<value>` CLI flag
- In the spec-runner, if flag is set, call `page.addInitScript` to seed `window.__davstack_db` before navigation
- Test: assert `window.__davstack_db` is set in the page context when the flag is passed

~5–10 lines + a test.

### Phase 3 — consumer wiring snippet

Not a davstack ship — a docs deliverable. Add the 3-line snippet to `packages/logs-server/docs/transmitter-wiring.md` (see Docs phase). The user copies it into their app's `sentry.ts`.

## Docs phase (lands with Phase 1)

### Updates to existing docs

- **`packages/logs-server/docs/reading-logs.md`**: revise opening to mention the per-DB layout. Replace `.davstack/logs.db` with `.davstack/logs/default.db` throughout. Add a "Choosing a DB" subsection explaining file-per-session, naming convention, opening the right one (`sqlite3 .davstack/logs/<name>.db`).
- **`packages/logs-server/docs/setup.md`**: document the new default path. Note `pruneDays` semantics (per-DB or all-DBs, whichever we land on).
- **`packages/logs-server/docs/writing-logs.md`**: add a short "Routing logs to a specific DB" section pointing to the new `transmitter-wiring.md` for the snippet.
- **`packages/logs-server/README.md`**: one-line update to reflect the new default path in any inline example.
- **`packages/logs-server/CHANGELOG.md`**: 2.0.0 entry with migration note.
- **`~/dev/davstack/skills/*`**: audit any skill docs that reference the old `.davstack/logs.db` path or teach query patterns.

### New doc: `packages/logs-server/docs/transmitter-wiring.md`

How to wire your app's `sentry.ts` to honor `window.__davstack_db`. The single ~3-line snippet shown above + brief explanation of what each line does. Includes a one-paragraph note that backend logs (today) go to default DB, by design.

### New doc: `packages/logs-server/docs/session-views.md`

**The per-DB views guide.** This is the second load-bearing reason to ship multi-DB — each session DB is an isolated playground for session-specific views, with cleanup-via-`rm`.

Content outline:

1. **Why per-DB views are now safe**
   - With one global DB, `CREATE VIEW probe AS …` would pollute every future query.
   - With per-session DBs, the view lives in THAT bug's DB. When you `rm .davstack/logs/reorder-bug.db`, the views go with it.
   - This achieves the "temp view with auto-cleanup" goal without SQLite's per-connection limitation.

2. **The pattern**
   - Pick a DB: `sqlite3 .davstack/logs/reorder-bug.db`
   - Define a probe-vocabulary view at the start of the session:
     ```sql
     CREATE VIEW probe AS
     SELECT id, ts, level,
            json_extract(data, '$.body')               AS msg,
            json_extract(attrs, '$.seam')              AS seam,
            json_extract(attrs, '$.nextDims')          AS nextDims,
            json_extract(attrs, '$.prevDims')          AS prevDims,
            json_extract(attrs, '$.columnOrder')       AS columnOrder
     FROM logs_v
     WHERE msg LIKE '%[colorder-probe]%';
     ```
   - Every subsequent query becomes `SELECT … FROM probe …` — one cheap reference, no JSON-extract repetition.

3. **Useful view shapes**
   - `pre_fix` / `post_fix`: filter by `ts <` / `>=` a fix-application timestamp; compare side-by-side.
   - `this_run`: `WHERE run_id = 'r-XYZ'` — scope to one run within the session.
   - `errors_only`: convenience filter for an errors-with-context recipe.
   - Pivot views when probes emit a fixed attribute set: rotate `attrs.<k>` into typed columns for `WHERE` ergonomics.

4. **Lifecycle**
   - Views persist across `sqlite3` invocations within the same DB file.
   - Cleanup = delete the file: `rm .davstack/logs/<name>.db`.
   - To drop just one view in a live session: `DROP VIEW probe;`.

5. **Agent usage**
   - If an agent is iterating in a session, the FIRST query of the iteration is `CREATE VIEW … IF NOT EXISTS` for the probe vocabulary; subsequent queries hit `FROM probe`. This is the agent-side hygiene equivalent of "stash the projection once, reuse it everywhere."
   - Naming convention for agent-created views: prefix `dbg_` so they're easy to spot and drop in bulk (`SELECT name FROM sqlite_master WHERE type='view' AND name LIKE 'dbg_%'`).

6. **Anti-patterns**
   - Don't `CREATE VIEW` in `default.db` (or any sessionless DB). That view is now global noise.
   - Don't rely on `CREATE TEMP VIEW` — it's per-connection and evaporates between sqlite invocations.

## Open items / things to confirm before coding

These have been discussed and tentatively decided, but worth a final pass before Phase 1 starts:

1. **Charset rule**: `[a-z0-9_-]+` per segment (lowercase alnum + hyphen + underscore). Tentative. Hyphen + underscore both allowed; user said "might want an underscore at some point."
2. **Validation reject behavior**: warn-on-stderr + route to default (friendly). Not fail-loud. Tentative — could be revisited if it masks typos in practice.
3. **Idle-close timeout**: 30 min. Pick by feel; can tune. Memory cost of holding DB handles open is trivial; only reason to close is to free file descriptors.
4. **What if the legacy `.davstack/logs.db` file exists at boot?** Tentative answer: print a warning, create the new default anyway, leave the legacy file orphaned. The `logs-server check` verb gets a row that flags the legacy file's presence with the migration command (`mv .davstack/logs.db .davstack/logs/default.db`).
5. **`prune` verb scoping**: walk all DB files by default, or require `--db <name>`? Default to "all" seems closer to today's "one DB pruned" behavior — semantically the same global cleanup.

## Test plan (Phase 1)

Unit:
- `resolveDbPath`: full validation table from above, every row a test case.
- `DbHandleCache`: cache hit, miss, idle-close after configured timeout, parallel insert into same DB doesn't collide (WAL handles it).
- Containment check: `..`, double-`..`, absolute paths, Windows drive prefixes — all rejected per the table.
- Strip-before-persist: insert a log with `davstack-logs.db` attribute, assert the persisted `data` blob does NOT contain that key in its `attributes`.

Integration:
- Two `POST /envelope/` requests carrying different `davstack-logs.db` attributes → two DB files materialize with correct row counts.
- Attribute-absent request → row in `default.db`.
- Invalid value → stderr warning + row in `default.db`.
- Backend service emits a log (no attribute) → row in `default.db` (regression test for "we didn't accidentally make backend logs disappear").

E2E (after Phase 2):
- `playwright-server --db=test-bug e2e/smoke.spec.ts` against a sample app that includes the transmitter snippet → rows land in `.davstack/logs/test-bug.db`, not `default.db`.

## Filing

Open a single issue (`feat(logs-server): per-DB log routing via davstack-logs.db attribute`) referencing this plan as the canonical design. Mark with `breaking-change` label given the 2.0 bump. Cross-link to #51 (closes if appropriate) and #52 (depends-on, already shipped).
