# Telemetry package: naming + OpenTelemetry strategy

Design note / decision record. Captures a brainstorm on (1) renaming `logs-server`,
(2) the Sentry↔OTel relationship and how close our store is to the OTel standard,
(3) whether we *should* move toward OTel, and (4) the viewer / ecosystem strategy.

Status: **direction agreed, churn scope not yet committed.** This is a forward-looking
note, not yet implemented.

---

## 0. What this package actually is

A **local, Sentry-shaped telemetry sink**. It ingests Sentry envelopes over HTTP and
persists them to a per-repo SQLite file. One `logs` table holds three row kinds,
discriminated by a `kind` column:

- `kind='log'`   — log lines
- `kind='span'`  — trace spans / transactions (with real `duration_ms`)
- `kind='event'` — error/exception events (full stacktrace kept verbatim)

Key properties:
- **Optimized for coding agents** — one denormalized table queried with plain SQL.
- **Lossless** — the full original payload is kept verbatim in the `data` column;
  `attrs` is an *additional* convenience projection (flattened key→value) for terse
  `->>'key'` queries. Nothing is dropped.
- **Zero infra** — point your existing Sentry DSN at the local daemon; drop a `.db`
  file to reset retention.

---

## 1. Naming: `logs-server` → `telemetry`

**Problem:** "logs" describes 1 of 3 kinds — it undersells and mis-describes the package.
The codebase had drifted into *three* competing vocabularies:
- **logs** — package/bin/`.davstack/logs/` dir/`logs` table/docs
- **diag** — `DIAG_*` env, `diag.*` attrs, `~/.claude/diag`, "the diag sink" comments
- **telemetry** — README + package.json prose

**Resolution:**
- `diag` is **legacy** — it dates from when this was only a bug-diagnosis logger.
  Diagnosis-specific behaviour already moved to the `diagnose` skill; the `diag.*`
  bits are slated for cleanup/removal. So `diag` is **out** of the running.
- "logs" is factually wrong. **Pick one word, use it at every layer.**
- **Decision: `telemetry`.** It's the only word that's honest *and* collision-free at
  every layer (package, dir, table, attr prefix) — it genuinely means "all the stuff
  your app emits" and covers log+span+event without lying.

**Words rejected and why:**
- `trace`/`traces` — collides with `trace_id` (everywhere) and repeats the `logs` sin
  (implies spans only).
- `scope` — "Scope" is a core Sentry concept; collision in a Sentry-coupled tool.
- `otel` — **over-claims**: implies OTLP-native ingest (we ingest Sentry envelopes, not
  OTLP) and our schema isn't OTLP-conformant anyway. Also a brand/category error (OTel is
  instrumentation+protocol, not a backend/sink). Don't bake a false promise into the name.
- `activity` / `signals` — viable warmer/crisper roots (considered for the faint
  "surveillance / phone-home" vibe of "telemetry"), but we stuck with `telemetry`.

**Ambiguity (server vs viewer vs format):** solved by **role suffixes on a shared root**,
matching the existing `vitest-server` convention — not by abandoning the root:
- ingest daemon → `telemetry` (or `telemetry-server`)
- viewer        → `telemetry-viewer` / a `telemetry view` subcommand
- possible future subcommands: `telemetry listen` / `telemetry view`

**Surveillance vibe:** kill it in the tagline ("never leaves your machine"), since this
tool explicitly does *not* phone home.

**Cost flagged (not yet committed):** it's a published package at v2.x. Renaming the npm
package + the `logs` table is a breaking major (3.0) with migration, and the table rename
ripples through every SQL recipe in the docs. Open question: package/bin/dir only, vs.
also rename the `logs` table.

---

## 2. Sentry ↔ OTel: the relationship (clarifications)

They are **not opposites.** Modern Sentry JS SDK (v8+) is **built on OpenTelemetry**, and
our ingested data is already OTel-shaped (OTel `severity_number 1..24`, log body +
attributes). We are already "doing OTel" — via a Sentry front door.

Terminology (it's not a clean OTel-vs-OTLP split; OTLP is a *subset* of OTel):
- **OTel (umbrella)** = data model + **semantic conventions** + SDKs + protocol.
  The "modeling vocabulary" = the data-model + semantic-conventions specs.
- **OTLP** = the wire protocol (HTTP/gRPC + protobuf/JSON) for transporting telemetry.
- **Collector** = a separate deployable pipeline binary (sampling/redaction/fan-out).
- **Sentry** = polished multi-language SDKs + a *proprietary envelope* wire format +
  backend/UI. The "++" over raw OTel = better DX/docs, multi-language auto-instrumentation,
  much better *error* tracking (mechanism/handled/stacktraces/error boundaries), and
  extras like **Web Vitals** (`measurement.lcp` etc.).

We chose Sentry as the **easy front door** and built our **own open local SQLite backend**
→ no vendor lock-in on storage (more in the open-source spirit than it feels).

---

## 3. How close is our store to the OTel standard?

**OTel-*inspired* and fully *correlatable*, but NOT OTLP-*conformant*.**

Faithful to OTel:
- **Trace correlation via `trace_id`** across all signals — the core OTel principle, nailed.
- OTel severity model (`severity_number` 1..24; level→severity buckets match OTel exactly).
- `recv_ts` is exactly OTel's **ObservedTimestamp** concept (server-observed vs client time).
- All the OTel log primitives present (timestamp, trace/span ids, body, attributes).
- **Typed attributes ARE preserved** (verbatim in `data`); `attrs` is a bonus projection,
  not a lossy replacement.

Deliberate divergences (mostly product-right for our niche):
- **Signals merged into one table** (kind discriminator) — OTel keeps them separate. This
  is the agent-optimization and it's correct for us.
- Resource flattened into columns (`service`/`project`/`runtime`) vs an OTel Resource object.
- Sentry span vocabulary (`op`/`status`/`description`) vs OTel `Name`/`Kind`/`StatusCode`.
- Semantic-convention attrs are *preserved* but not *normalized/enforced*.

Because `data` is **lossless**, we can project to OTLP later without having lost anything.

---

## 4. Should we move toward OTel? (strategy)

Split the question: **OTel *modeling vocabulary* (cheap, helpful) vs OTLP *protocol +
Collector* (heavy, fights our value prop).**

**Lean IN (cheap wins):**
- Preserve the semantic-convention attribute keys Sentry already emits (`http.*`, `db.*`)
  instead of renaming to ad-hoc keys — makes a future viewer render generically.
- Keep typed attributes (already do) and trace-correlation (already do).

**Do NOT adopt:**
- OTLP-as-our-storage protocol, or the Collector — production-aggregation infra that
  breaks our "zero infra" pitch.
- A metrics-signal pipeline — **not needed.** `duration_ms` + SQL `GROUP BY` covers
  local-dev "metrics" (p95, counts, error rates). Real OTel metrics shine in *production
  fleet* monitoring, not local single-dev debugging.
- "Universal OTel sink/viewer" as a *goal* — that's a commodity space (Grafana, Jaeger);
  it abandons our moat (simple, local, agent-first).

**Keep our genuine advantages (do not sacrifice):**
- Single denormalized table + SQL → optimal for an LLM reader (`WHERE trace_id = ?`
  returns the full interleaved timeline, no UNION/join).
- Zero infra (a sqlite file), one-line DSN setup, lossless `data`.
- **Web Vitals / `measurement.*` are a real Sentry "++", not a gap** — keep them; they
  export to OTel as span attributes (OTel tools just won't special-render them).

**Table shape note:** logs + spans + events are all "events on a timeline" → one table
fits them naturally. **Metrics** (if ever added) are aggregatable series → that would be
the natural *second* table. 3 tables wouldn't complicate infra, but buys nothing for
compatibility (the exporter reads any layout) and is worse for the headline agent query;
use **views** if per-signal ergonomics are ever wanted.

---

## 5. Viewer / ecosystem strategy

**Key fact:** otel-tui and otel-desktop-viewer are **OTLP *receivers*** — they listen on
the wire (gRPC 4317 / HTTP 4318), hold telemetry in memory, and render it. They do **not**
read a sqlite file.

**Compatibility = a thin one-way OTLP *exporter* bridge** (cheap *because* `data` is
lossless): `davstack telemetry export --otlp localhost:4318` reads rows and replays them
as OTLP. This lights up otel-tui / Jaeger / Grafana **for free, with zero changes to our
storage or Sentry ingest path.**

- Make it **on-demand / incremental-poll**, NOT a live second sink. (Two always-on sinks
  is the bad practice to avoid.) Incremental export (`WHERE id > last_seen` every ~10s,
  encode OTLP, POST) is trivially cheap — the poll cost is a non-issue.
- Steady-state footprint stays **one daemon**; the viewer is ephemeral.

**Do NOT clone otel-tui into davstack tui.** davstack tui is **Ink + React + TypeScript**;
otel-tui is **Go**. "Clone" across that boundary = a rewrite, or maintaining a foreign Go
fork + shipping a second binary — exactly the custom-maintenance burden we want to avoid,
and it *still* wouldn't embed (Go TUI takes over the terminal). It also wouldn't give
topology (otel-tui doesn't do service maps) and renders our extras only generically.

**Two integration levels, matched to language:**

| Goal | Integrate by | How |
|---|---|---|
| Tap the ecosystem (Go tools: otel-tui/Jaeger/Grafana) | **protocol** | OTLP export; orchestrate as a subprocess (davstack tui "launch viewer" suspends Ink, hands over terminal, resumes) |
| Inside davstack tui + native rendering of *our* shape | **code** | a small native **Ink/React panel reading sqlite directly** — same language, actually embeddable |

Resolving the confusion: the thing you can truly *embed* in davstack tui is a **native
panel** (not otel-tui — wrong language); the thing that *taps the ecosystem* is the **OTLP
export** (not embedding). Reserve "custom" for the gaps the ecosystem won't render.

---

## 6. Topology (the one resource-model piece worth adopting)

A service topology graph is **derivable from data we already capture**:
- **Nodes** = services. **Edges** = a span in service A with a child span in service B.
- We already have `trace_id` + `span_id` + `parent_span_id` (in attrs) + a per-row service.

**The one gap = node identity.** Current `service` is `sdk.name`
(`sentry.javascript.node` vs `…react`) — enough to tell *browser from server*, but not
"api" from "worker" if both are Node. For real topology, capture a **logical
`service.name`** per app (set once per service via a Sentry tag/attribute) and promote it
to a column. Then: nodes = distinct service names; edges = cross-service parent/child spans;
render in the **native** viewer (off-the-shelf OTel TUIs won't do this).

This is *selective* adoption: take the one resource field topology needs, skip the rest of
the resource spec.

---

## 7. Recommended sequence

1. **(Decision)** Rename `logs` → `telemetry` (root + role suffixes). Decide churn scope:
   package/bin/dir only vs. also the `logs` table (breaking 3.0 + doc-recipe churn).
2. **Cheap OTel-vocabulary alignment**: preserve semantic-convention attr keys.
3. **Ship the OTLP export + poll bridge first** — smallest ecosystem win; validates the
   lossless-`data` → OTLP thesis; davstack tui gets a "launch viewer" action.
4. **Build a native Ink panel only for the gaps** (topology, Web Vitals, error rows) — in
   our own stack, where embedding is cheap and "custom" is justified.

## Open questions
- Rename churn scope (table or not?).
- Whether to build the native viewer at all, or stop at the OTLP bridge.
- Final tagline wording (carry "OpenTelemetry-shaped, Sentry-easy, never leaves your
  machine").
