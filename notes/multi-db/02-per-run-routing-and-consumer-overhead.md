# Per-run log-DB routing: header experiment (works) → the cleaner trace_id + integration design

**Date:** 2026-06-03
**Status:** Header approach PROTOTYPED + VALIDATED in traffease, then REVERTED. Recommended design (sink-side trace_id inference + Sentry integration packaging) NOT yet built. Pick up tomorrow.
**Repos:** experiment ran in `~/dev/traffease_man` (branch `feat/full-stack-logs-infra`, PR #1229); real implementation home is `~/dev/davstack` (`@davstack/logs-server`).
**Continues:** [`01-plan.md`](./01-plan.md)
**⚠️ SUPERSEDED (2026-06-03):** the per-run **file-routing** direction below (Approach A/B/C) is
replaced by [`03-clean-and-label-the-stateless-pivot.md`](./03-clean-and-label-the-stateless-pivot.md)
— a single DB + a logical `label` (filter at query time) + a `clean` verb. The trace-propagation
**foundation** here still holds (it's reused at query time); the **routing machinery** is demoted to
an optional escape hatch. Read 03 first.

---

## 0. TL;DR

- **Problem:** today the server tiers (Node, Python backend, Python agent) pick their sink DB from a **boot-time `LOGS_DB` env**, so to route a run into its own `.davstack/logs/<name>.db` you must set `LOGS_DB` on `docker compose up`. That pins the whole container to one DB → **can't run parallel runs through shared containers** (the actual goal).
- **We proved** a per-request `x-davstack-db` **header** approach works end-to-end (logs *and* spans route per-request, no per-container env). See §2 for the validated result.
- **But we're not shipping it:** it demands ~5 edit sites × every service in every consumer repo, and **structurally can't do WebSocket** (browsers can't set WS headers → the agent chat path is excluded). Wrong place for the complexity given we maintain the package and want **minimal consumer setup** (traffease + titanium + public sharing).
- **Recommended instead (§3):** **sink-side `trace_id → db` inference.** `trace_id` is *already* propagated across all tiers by Sentry for free; the DB is decided once at the trace root (browser tab = the run). So don't propagate the DB at all — let the **sink** learn `trace_id → db` from the browser's already-stamped rows and route every same-trace row accordingly. **Zero server-tier consumer code. Solves WebSocket. Backward compatible.**
- **Plus (§4):** package the *stamping* boilerplate (project / run_id / db-hint `before_send` hooks, ~100 lines per service today) as a **Sentry integration** `davstackLogs({ project })`. Routing stays sink-side; stamping shrinks to one init line.
- **Open knobs (§6):** back-fill migration vs. buffering vs. accept-leak for pre-mapping rows; where the integration package lives.

---

## 1. Context / how routing works today

- The sink dispatches **per-record**: every log/span envelope may carry a `davstack-logs.db` attribute; the sink writes that row to `.davstack/logs/<value>.db` (validated + sandboxed in `db-route.ts`), strips the key, else → `default.db`. Code path: `ingest.ts` → `stamp()` → `resolveTarget(routeDb, ctx)` → `resolveRoutedDb()`. `db.ts` already has a `trace_id` column (indexed) and `selectByTrace()`.
- **Who stamps the routing key today:**
  - **Browser (React):** from `window.__davstack_db` (set pre-page-load by the e2e fixture / devtools). → **already per-run.** `react/src/config/sentry.ts` `beforeSendLog` + `beforeSendTransaction`.
  - **Node / backend / agent:** from **`env.LOGS_DB`** (boot-time constant) in their `beforeSend(Transaction|Log)` hooks. → **per-container.**
- **Backend already has more machinery than the others:** `backend/src/config/diag_logs.py` has a `_logs_db` **ContextVar** that *wins over* the env (`resolve_logs_db()` precedence: ContextVar > `LOGS_DB` env > None), plus a `logs_db()` context manager (used by the eval `--db` flag) and `ROUTE_DB_ATTR = "davstack-logs.db"`. Agent + Node only read env.

So routing is *already per-record* — the only reason it's "per-container" is that 3 tiers stamp a **constant**. Make them stamp a **per-run** value and parallelism falls out. The header experiment does that via the request; the recommended design does it via the trace.

---

## 2. What we tried: per-request `x-davstack-db` header (Approach A) — WORKS, but reverted

### Mechanism
Browser stamps `x-davstack-db: <window.__davstack_db>` on every outgoing HTTP request; each server reads it per-request and routes that request's logs+spans to `<db>.db`. React calls all three backends **directly** (star topology, not a chain) — `VITE_BACKEND_URL`=node, `VITE_AGENT_API_ROOT`=agent, `VITE_AGENTFLOW_API_URL`=backend — so mostly the browser stamps + each server reads; server↔server propagation is a smaller secondary concern.

### The one non-obvious technical win (keep this knowledge)
**Backend middleware must be pure-ASGI, not `BaseHTTPMiddleware`.** Sentry's `before_send_transaction` fires at **transaction-finish**, which is *after* a `BaseHTTPMiddleware.dispatch` returns (Starlette runs the app in a child task → the ContextVar binding is gone by the time the txn is serialized → **span routing silently lost**, though *logs* would still route since they're emitted mid-request). A **pure-ASGI** middleware sets the ContextVar in the *same* async context Sentry finishes the transaction in → both logs AND spans route. **This was the main risk and it's now empirically dead** (see below).

### Validated result (real, this session)
- Backend restarted with `ENABLE_LOGS=1`, **no `LOGS_DB`**. Fired 5 requests with `x-davstack-db: hdrtest1` + 3 without.
- `hdrtest1.db` got exactly **5 logs + 5 spans, project `traffease-backend`**; the 3 header-less control requests did **not** leak in. → per-request routing works for both logs and spans, with zero env.
- Earlier in the session we also confirmed (compose-tagged run) that one `trace_id` spans react+node+backend, and that **server rows carry the browser's `trace_id` even with no routing code** — this is the foundation Approach C relies on (§3).
- **Cross-stack re-validation (a separate Next.js app [titanium]):** independently confirmed the same foundation on a different stack/topology by querying that app's local sink — found **344 distinct `trace_id`s shared between confirmed browser rows and server rows**. Browser rows were positively identified by client-only console output (React DevTools notice / Fast Refresh / hydration warnings); server rows by a server-only `server.address` attribute. So browser→server `trace_id` propagation — the thing Approach C stands on — is **not stack-specific**: it holds on Next.js (Sentry's server SDK continues the browser's trace via the `sentry-trace`/`baggage` headers) where the topology is browser → middleware/edge → RSC/route-handlers, not traffease's star. (Two caveats found there, now resolved — see 03 §8: browser shipped *logs but not spans* — a **config gap**, fixed by enabling `browserTracingIntegration` on the client, not a limitation; and trace grain is **per-pageload/navigation** — fine for run/session/`db`/`label` keying, too coarse for per-test.)

### Why we reverted it (the adoption argument)
- **Consumer surface is the worst of all options:** per service you write inbound-read + scope-binding + outbound-propagation + (Node) a CORS allowlist entry; the browser needs an HTTP-client interceptor. ~5 sites × N services, replicated in every adopting repo.
- **WebSocket is structurally excluded:** browsers can't set custom headers on `WebSocket`. The agent chat path is raw WS → never covered by a header scheme.
- We maintain `@davstack/logs-server` and want **minimal consumer setup**. Header plumbing is the opposite.

### Exact diff we reverted (recoverable — re-apply if ever needed)

> 5 files, +90/−6. All gated so prod is byte-identical (`diag_logs_enabled()` / `logsEnabled`). Reverted via `git restore` on branch `feat/full-stack-logs-infra` (these were uncommitted working-tree edits on top of the committed PR).

```diff
# backend/src/config/diag_logs.py  — pure-ASGI middleware + header const
+ROUTE_DB_HEADER = b"x-davstack-db"
+
+class LogsDbRoutingMiddleware:
+    """Pure-ASGI (NOT BaseHTTPMiddleware): ContextVar set survives to
+    before_send_transaction at txn-finish, so SPAN routing works."""
+    def __init__(self, app): self.app = app
+    async def __call__(self, scope, receive, send):
+        if scope.get("type") in ("http", "websocket"):
+            for key, value in scope.get("headers") or []:
+                if key == ROUTE_DB_HEADER:
+                    db = value.decode(errors="ignore").strip()
+                    if db: _logs_db.set(db)
+                    break
+        await self.app(scope, receive, send)

# backend/src/app/middleware.py  — wire it in, gated
+def configure_logs_db_routing(app):
+    if diag_logs_enabled():
+        app.add_middleware(LogsDbRoutingMiddleware)
# ...called in configure_middleware() between event_context and exception_handlers

# react/src/lib/axios/axios.ts  — forward the header from window.__davstack_db (all 3 Orval clients funnel through addAuthHeaders)
+const addDavstackDbHeader = (config) => {
+  const db = (window as Window & { __davstack_db?: string }).__davstack_db
+  if (db) config.headers["x-davstack-db"] = db
+}
# ...addDavstackDbHeader(config) appended inside addAuthHeaders()

# node/src/server.ts  — CORS allow + scope-bind middleware
-allowedHeaders: ["Content-Type", "Authorization", "sentry-trace", "baggage"]
+allowedHeaders: ["Content-Type", "Authorization", "sentry-trace", "baggage", "x-davstack-db"]
+app.use((req, _res, next) => {
+  const db = req.headers["x-davstack-db"]
+  if (typeof db === "string" && db) Sentry.getCurrentScope().setTag("davstack-logs.db", db)
+  next()
+})

# node/src/config/sentry.ts  — per-request tag wins over env in stampDiagOnTransaction
+const perRequestDb = tx.tags?.["davstack-logs.db"]
+const logsDb = (typeof perRequestDb === "string" && perRequestDb) || env.LOGS_DB
+if (tx.tags) delete tx.tags["davstack-logs.db"]
```

> Agent tier was **not** implemented (would need the ContextVar machinery the backend has + a FastAPI middleware + the unsolved WS path). Deliberately stopped before it once the strategy pivoted.

---

## 3. Recommended: sink-side `trace_id → db` inference (Approach C)

### The insight
Sentry **already propagates `trace_id`** across every hop, free, zero consumer code (it's the cross-service-join key that already works). The DB is chosen **once at the trace root** (the browser tab = one run) and is constant for the whole trace. So **don't propagate the DB name at all** — associate `trace_id → db` once and let the sink route.

### Mechanism (all in `@davstack/logs-server`)
1. Browser stamps `davstack-logs.db` on **its own** rows — **already happens** (from `window.__davstack_db`).
2. Sink keeps an in-memory `Map<trace_id, routeDb>`. On ingest, if a row carries both `trace_id=T` and `davstack-logs.db=D` → learn `T → D`.
3. Any row (from *any* tier) with `trace_id=T` and **no** explicit route → route to `D` via the map.
4. Rows that already landed in `default.db` before the mapping was learned → **back-fill** (`INSERT…SELECT` into `D.db` + `DELETE` from default) when `T → D` is first seen.

Slot-in point: `resolveTarget(routeDb, ctx)` in `ingest.ts` (consult the map when `routeDb` is absent); learning + back-fill hang off the same ingest loop. `db.ts` already has `selectByTrace()` for the migration query.

### Why this is the right call
- **Server-tier consumer code: ZERO.** No middleware, no CORS, no header, no `before_send` routing. They emit normal trace-correlated envelopes (already do).
- **Solves WebSocket / agent for free:** the agent's spans already carry the bridged `trace_id` (`agent_traces.sentry_trace_id` in the PR) → they route correctly with no agent code. The thing the header approach *couldn't* do.
- **Backward compatible & additive:** explicit `davstack-logs.db` (env-based `LOGS_DB`, pytest `--db`, browser stamp) still works and takes precedence; inference only fills the gap.
- **Complexity lives once, in the package we own** — not copied into every adopter forever.

### Cost / risks
- **Sink becomes stateful** (the map + back-fill). Bound it: TTL / LRU on the map (dev-only, fine).
- **Ordering race:** server rows for `T` can arrive before the browser's `D`-stamped row. Browser usually starts the trace first, but server spans flush at request-end. Back-fill self-heals it; the design knob (§6) is whether to back-fill, buffer briefly, or accept a small leak to `default.db`.
- A trace mapping to two DBs "shouldn't happen" (DB is per-tab-run) — assert/last-writer-wins.

---

## 4. The other half: a `davstackLogs()` Sentry integration (packaging the stamping)

Routing is only half the consumer pain. The *other* half is that today **every service hand-writes ~100 lines** of `before_send_log` / `before_send_transaction` to stamp `diag.project`, `diag.run_id`, and the db hint (see `react/src/config/sentry.ts`, `node/src/config/sentry.ts`, `backend|agent/src/config/sentry.py` — all near-duplicates).

Package that as a **Sentry integration** per platform (browser / node / python):

```ts
// target consumer surface — per service, this is the WHOLE setup:
Sentry.init({
  dsn: davstackSinkDsn(),                       // helper: dev → local sink, prod → real DSN
  integrations: [davstackLogs({ project: "myapp-web" })],
})
```

What the integration does (event processors, not consumer code):
- stamp `diag.project` (from the one config arg) on logs + span data,
- stamp `diag.run_id` (browser: per-page-load uuid + `window.__diagRunId`),
- browser only: stamp the `davstack-logs.db` hint from `window.__davstack_db` — **this is the single feeder for Approach C.**

**Keep routing OUT of the integration.** An integration can't cleanly propagate a custom key across services (that's Approach B / baggage — see §5, fragile). Routing belongs sink-side (§3). The integration only owns *stamping*.

Net consumer overhead after C + integration: **routing → 0 lines; stamping → 1 integration line per service; DSN → 1 helper call.** Down from ~100 lines × N services + per-container env.

---

## 5. Approach B (Sentry baggage) — considered, parked

Put the db in Sentry **baggage** (W3C baggage / DSC): Sentry auto-propagates `baggage` outbound+inbound, and CORS already allows it (the PR added it for tracing). DSC is frozen at trace root — which actually *fits* (db is constant per trace).

**Why parked, not chosen:** relies on Sentry propagating **third-party (non-`sentry-`) baggage items** end-to-end, which is SDK-version-dependent and underdocumented across the three SDKs we use (browser/node/python, mixed v8/v9). You'd still need an integration to inject at the root + read downstream + stamp. More moving parts and more fragility than §3 for the *same* outcome. **Fallback only** if trace-inference (§3) proves too racy in practice.

---

## 6. Decisions / open questions for tomorrow

1. **Build order:** (a) prototype C in `~/dev/davstack` and re-validate the parallel-e2e with zero server config, then (b) the `davstackLogs()` integration. Probably C first (unblocks the real goal).
2. **Pre-mapping rows knob:** back-fill migration (self-healing, more code) **vs.** brief buffering window **vs.** accept-leak-to-default (simplest). Recommend back-fill; it's bounded and gives correct files.
3. **Integration packaging:** new package(s) vs. part of the existing logs-server client surface? Three runtimes (browser/node/python) — python can't live in an npm package, so at least a `davstack-logs` PyPI shim is implied. Scope this.
4. **`davstackSinkDsn()` helper:** ship per-platform helpers so the DSN line is also boilerplate-free.
5. **titanium check:** validate the target surface against titanium's setup so we don't design only for traffease.
6. **Map bound:** TTL/LRU sizing for `trace_id → db` (dev volumes are small; pick something boring).

---

## 7. State left behind (for clean resume)

- **Code:** the §2 diff was **reverted** (`git restore` on the 5 files). Branch `feat/full-stack-logs-infra` is back to its committed state. The browser's existing `davstack-logs.db` stamping is **untouched** (it's the feeder for C).
- **Containers:** `node` / `backend` / `agent` left running with `ENABLE_LOGS=1`, **no `LOGS_DB`** (so → `default.db`). To fully restore the pre-session state, recreate without `ENABLE_LOGS`.
- **Sink test DBs created this session** (`hdrtest1.db`, `qbtrace.db`, `bug-5.db`) can be deleted from `traffease_man/.davstack/logs/`.
- **Untracked in traffease:** `PR-1229-how-to-use.md` (the rewritten "How to use it" section for PR #1229 — separate, unrelated workstream).
