# The stateless pivot: drop per-file routing → `label` (filter) + `clean` (size)

**Date:** 2026-06-03
**Status:** DESIGN AGREED, not yet built. Supersedes the routing direction in
[`02-per-run-routing-and-consumer-overhead.md`](./02-per-run-routing-and-consumer-overhead.md)
(Approaches A/B/C). The empirical foundation from 02 (browser→server `trace_id`
propagation, incl. the cross-stack Next.js re-validation) **still holds and is reused** —
just at query time instead of ingest time.
**Repo:** `~/dev/davstack` (`@davstack/logs-server`).

---

## 0. TL;DR

- **Decision:** abandon **physical per-run DB-file routing** (02's Approach A/B/C). It was
  meant to *simplify* the workflow but did the opposite. Replace it with two small,
  **stateless, local, independent** primitives:
  1. **`label`** — a free-form annotation stamped **once at the source** (browser), used to
     **filter at query time** via a `trace_id` self-join. Zero server-tier code.
  2. **`clean`** — a CLI verb + auto-clean loop that bounds the working DB's size
     (archive-or-delete old rows, then vacuum).
- **The core insight:** physical routing forced the sink to decide *which file* a row goes to
  **at ingest** — before the browser's stamp may have arrived. *That* is the single source of
  all of 02's complexity (stateful `trace_id→db` map, back-fill, ordering race). Drop routing
  and the decision moves to **query time**, where the data is already complete → **the sink
  goes back to being dumb.**
- **`label` and `clean` are complementary, not redundant.** `label` = *logical* isolation
  (keep history, look back at past runs, compare — without deleting). `clean` = *physical*
  hygiene (a true slate when you want one; bounded disk). Having both means you **don't have to
  clean on every run** to stay un-confused.
- **Consumer surface:** deliberately minimal — server tiers stamp **nothing** (joined in by
  trace); only the browser stamps `label`. Packaging that into an integration + DSN helper is
  **deferred** (see §6) — not building a custom abstraction now.

---

## 1. Why we're pivoting (the complexity audit)

Per-run **file** routing (`.davstack/logs/<name>.db`) sounded like clean isolation. In
practice it dragged in (all documented in 02 §3/§6):

- the sink must become **stateful** — an in-memory `Map<trace_id, db>`;
- it needs **back-fill** — moving rows that landed in `default.db` before the mapping was
  learned;
- it has an **ordering race** — server spans flush at request-end, often *before* the
  browser's db-stamped row arrives.

Every one of those exists for a single reason: **a physical file must be chosen the instant a
row is ingested**, and at that instant the routing value may not have been seen yet.

A **metadata tag** has none of that pressure. It just rides on the row; the sink stores it and
moves on (it already stores arbitrary `attrs`). You decide what to *do* with it — filter,
group — **later, at query time, when every row is already present.** No map, no back-fill, no
race. The sink stays stateless.

So: routing-to-simplify backfired. Tag-and-filter is both simpler *for the user* and *far*
less machinery *in the package*. The test we'll hold every piece of this design to:
**does it keep the sink stateless?** If a feature reintroduces the map/back-fill/race, it's
the wrong feature.

---

## 2. The `label` primitive

### 2.1 Name
Call it **`label`**. Not `tag` — the `logs` table already has a `tag` column for **row-type**
tags (`server-fn`, `test-boundary`, `action`); overloading it will confuse every query. Not
`run` — collides with the existing `run_id` (process/page-load uuid). `label` is unambiguous:
*a free-form annotation the human chose for this run.*

### 2.2 How it's set & propagated (one place)
Identical mechanism to the browser's existing `davstack-logs.db` stamp — which already works:

1. Source sets it: e.g. `LABEL=login-bug pnpm playwright …` → the e2e fixture reads
   `process.env.LABEL` and sets `window.__davstack_label` (via `addInitScript`), exactly like
   `window.__davstack_db` today. For manual browsing, set it from devtools or leave it absent.
2. The browser's `beforeSendLog` / integration stamps `attrs.label` on **its own** rows.
3. **That's it.** Server tiers stamp nothing. They are correlated in by `trace_id` (validated:
   server rows carry the browser's trace — 02 §2 + the Next.js cross-stack re-validation).

### 2.3 How it's queried (the whole "routing" replacement)
Resolution is a query-time self-join on the validated key:

```sql
-- everything belonging to a labelled run, across all tiers
SELECT l.*
FROM logs l
WHERE l.trace_id IN (
  SELECT DISTINCT trace_id
  FROM logs
  WHERE json_extract(attrs, '$.label') = :label
    AND trace_id IS NOT NULL AND trace_id != ''
);
```

A CLI verb (`logs --label <x>`) wraps this; optionally a `labelled_logs` VIEW. **The sink does
nothing special for labels** — it only needs the value present on ≥1 row per trace (the browser
row). Server rows stay lean; they're pulled in by the join. Storage cost: the label is
denormalised onto browser rows only (a small fraction of rows).

### 2.4 Why keep `label` *and* `clean`
- `label` lets you **retain and revisit** past runs and still tell them apart — so you're not
  forced to `clean` before every single run just to avoid confusion.
- `clean` gives a **true empty slate** and **bounds disk** — things filtering can't do.

They cover different needs; neither subsumes the other.

---

## 3. The `clean` verb + auto-clean

Bounds the working DB and provides the "fresh slate for this repro" move. **Manual** and
**auto** are deliberately *different sweeps*:

| | Trigger | Scope | Honors `autoCleanWindow`? |
|---|---|---|---|
| **Manual `clean`** | CLI, on demand | **full sweep** → fresh empty hot DB | **No** — you want it *all* gone (a slate) |
| **Auto-clean** | daemon timer, every `autoCleanInterval` | rows older than `autoCleanWindow` | **Yes** |

Both honor `cleaningMode` and **both must `VACUUM`** afterward.

### 3.1 Config (in logs-server config)
- `autoCleanInterval` — how often the daemon sweeps, e.g. `"10m"`. **Unset → auto-clean off.**
- `autoCleanWindow` — retention, e.g. `"24h"`. **Default `"24h"`** (deliberately *not* `1h`:
  aggressive windows can delete logs mid-session if you step away; 24h is safe, and you use
  manual `clean` when you actually want a slate).
- `cleaningMode` — `"archive" | "delete"`.

Manual `clean` may take `--window` / `--mode` overrides, but defaults to full sweep + the
configured `cleaningMode`.

### 3.2 The reclaim gotcha (don't skip)
SQLite `DELETE` **does not shrink the file** — 311 MB stays 311 MB until you `VACUUM`. So:

- `delete` mode = `DELETE …` **+ `VACUUM`** (or run with `PRAGMA auto_vacuum=INCREMENTAL` set
  at DB creation + `PRAGMA incremental_vacuum`).
- `archive` mode = write the archive file → `DELETE` the rows → **`VACUUM`**.

`VACUUM INTO '<path>'` conveniently produces a clean, defragmented copy in one step — useful for
the archive write (§4). VACUUM briefly takes a write lock; at dev volumes that's a non-issue,
but it's why the daemon (not an ad-hoc process) should own the timer.

---

## 4. Archive format — lightest, never queried, no new dependency

Assumption (stated by design): **archives are just-in-case cold storage; we will not query
them**, and they may get **big**. So optimize purely for **small + simple**, not for
queryability.

- **Skip parquet.** Its only edge is columnar query via DuckDB/pandas — a toolchain we'd never
  use here, bought at the cost of leaving the `sqlite3` world.
- The data is wildly repetitive (same `attrs` keys, `sentry.sdk.name`, `server.address` on every
  row) → it compresses **10–20×**. **Compression is the whole game; the container barely
  matters.**
- The sink is **Node**, whose stdlib `zlib` ships **Brotli** — excellent ratio, **zero extra
  dependency**.

**Chosen:** `sqlite3 .dump` (SQL text) → Brotli → `logs/archive/<timestamp>.sql.br`. Text dump
compresses best of all *and* carries no index bloat (indexes are just `CREATE` statements).
Restore if ever needed: `brotli -d < x.sql.br | sqlite3 restored.db`.

**Noted alternative (slightly bigger, zero reopen-friction):** `VACUUM INTO <ts>.db` → Brotli →
`<ts>.db.br` — decompress and it's openable as a normal DB. Pick this only if "peek without
restoring" turns out to matter.

---

## 5. The workflow this enables

- **Routine:** let **auto-clean** (24h) handle accumulation. You generally don't think about it.
- **Look back / compare:** runs you care about carry a **`label`** → filter past runs out of the
  retained 24h window without having cleaned between them.
- **Focused debug:** run **`clean`** to get a slate, then run the one repro, then read
  everything (no label even needed at that point). Optionally also `LABEL=<x>` it so it survives
  in the archive/history meaningfully.

**Cautions baked into the design:**
1. **`clean` is a *before-you-observe* action.** Do **not** put it at the *end* of an e2e
   script — that deletes exactly the logs you'd debug a failure with. Put it at the **start** of
   a focused run; rely on auto-clean for routine growth.
2. Skill guidance: when an agent is debugging and wants to disambiguate, it runs `clean` (or
   filters by `label`) **first**, not after.

---

## 6. Consumer surface — DEFERRED (future consideration)

> **Status: not building this now.** No custom Sentry integration, no `davstackSinkDsn()`
> helper. Decision parked. This section records the research so picking it up later is cheap.
> For now, the small amount of consumer-side stamping `label` needs (§2.2) can be a few inline
> lines; we are explicitly *not* introducing a package abstraction yet.

The eventual idea (future): package the per-service `beforeSend*` boilerplate as a
`davstackLogs({ project })` Sentry integration + a `davstackSinkDsn()` helper, so consumer setup
is ~one init line:

```ts
// FUTURE — not implemented; illustration only
Sentry.init({
  dsn: davstackSinkDsn(),                 // dev → local sink, prod → real DSN
  integrations: [davstackLogs({ project: "myapp-web" })],
})
```

### What belongs where (research, for when we revisit)

**Governing fact:** Sentry **log records and span data do NOT inherit `initialScope` tags** —
only *error events* do. So any custom attribute on logs/spans (`label`, `run_id`, `project`)
**must** be stamped in `beforeSendLog` / `beforeSendTransaction` (or an integration
event-processor); there is no scope shortcut. (This is *why* `beforeSend*` exists in titanium
and traffease today.)

`beforeSend*` does three separable jobs — keep them distinct when deciding what to cut:

1. **Correlation stamping** — `project` / `run_id` / `label` onto logs + spans.
2. **Routing** — the `davstack-logs.db` hint. **Demoted by this design.**
3. **Noise hygiene** — drop prod debug logs; **drop Sentry's own `"Sentry Logger ["` chatter**
   (a real feedback-loop guard: `consoleLoggingIntegration` would otherwise re-ingest Sentry's
   debug output); ignore internal-user error events.

Where each piece lands under this architecture:

| Piece | Verdict | Why |
|---|---|---|
| **Server-tier `beforeSend*` (correlation)** | **delete entirely** | server rows correlate by `trace_id` (auto); the server is downstream of "stamp once at the source" — it needs to stamp nothing |
| **`davstack-logs.db` hint** | **gone** | routing demoted to escape hatch |
| **`run_id`** | **drop** (or keep as free auto-grouping) | `label` (human) + `trace_id` (correlation) supersede it |
| **`project`** | **multi-service sinks only** | traffease's 4 tiers need it; for a single app `server.address` already separates client/server |
| **`label` (browser stamp)** | **the one must-keep** *if* we want look-back filtering | logs don't inherit scope, so it must be stamped on browser rows; ~3 lines or the integration's browser processor |
| **Noise guards** | **keep regardless** | not correlation; the chatter guard prevents a feedback loop |

**Implication for the future integration:** its real remaining weight is **browser-side** (the
`label` stamp + noise guards + the DSN helper). **Server-side it is near-empty.** So when we
revisit, the open question is narrow: build the integration at all, or keep a tiny inline
browser `beforeSendLog`? Either way, *everything server-side comes out.*

---

## 7. Empirical foundation (reused, not re-litigated)

- Browser→server `trace_id` propagation is **confirmed** (02 §2 in traffease's node/py/react;
  cross-stack re-validated on a Next.js app — **344 distinct trace_ids shared** between
  confirmed-browser and server rows). This is the join key §2.3 stands on. Now used at **query
  time**, which is strictly easier than the ingest-time use Approach C needed.
- Browser **spans** reach the sink **once `browserTracingIntegration` is enabled** on the client
  (verified: `pageload`/`navigation` + child spans land). So the label feeder can be any browser
  row (log or span). (Earlier "browser ships logs but not spans" was a *config gap*, not a
  limitation.)

---

## 8. Caveats & limits (honest)

- **Trace grain is per-pageload/navigation.** Great for *per-run / per-session / per-db* labels;
  **too coarse to key per-test** (one session-trace can span many tests; e.g. a single trace
  observed spanning many Fast-Refresh cycles). Don't try to make `label` a per-test key — that's
  the grain trap from 02.
- **`label` only resolves browser-rooted traces.** A purely server-originated trace (background
  job, server→server call that starts its own trace, no browser ancestor) has no browser row
  carrying the label → unresolvable by label. Small tail for browser-driven work; fall back to
  time-slicing or `clean`-slate for those.
- **VACUUM** briefly write-locks; keep it on the daemon timer, fine at dev volumes.
- **Operational:** the daemon can wedge into "HTTP 200 but persists 0 rows" (stale DB handle).
  Fix observed: `logs-server refresh --hard`. Worth a doctor check + maybe an auto-heal.

---

## 9. What this supersedes / open questions

- **Supersedes** 02's recommendation to build Approach C routing. Physical `db` routing (the
  existing `db-route.ts` / `davstack-logs.db` stamp) is **demoted to an optional explicit escape
  hatch** (`DB=` for the rare "I really want a separate file"), **not** the default and **not**
  the thing we keep investing in. Candidate for eventual removal once `label` + `clean` prove
  out — decide later; no need to rip it out now.
- **Build order:** (1) `clean` + auto-clean + VACUUM (highest leverage — bounds the DB, enables
  the slate workflow, zero consumer change); (2) `label` end-to-end (a **tiny inline browser
  `beforeSendLog`** stamp for now + `logs --label` query). **Deferred / future (see §6):**
  packaging the stamp as a `davstackLogs()` integration and a `davstackSinkDsn()` helper — not
  building now.
- **Open knobs:** exact CLI flags for `clean`; whether `label` should *also* be settable
  server-side via a header for server-originated traces (only if the §8 tail bites); archive
  retention/rotation in `logs/archive/` (cap count? age?); whether to expose a `labelled_logs`
  VIEW vs a CLI flag only.
- **Skill integration:** wire "`clean` at the start of a repro / filter by `label`" into the
  debugging skill's guidance (consumer-side, e.g. titanium), not the package.
