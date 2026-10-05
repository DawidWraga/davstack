# `@davstack/fn` — design decisions, evaluations & vision

> A consolidated record of the design conversation about the future of this package:
> the guiding philosophy, every decision with its rationale and caveats, the research
> that informed them, and the deliberately-cautious near-term plan.
>
> Companion notes: `[eval-pipe-vs-middleware.md](./eval-pipe-vs-middleware.md)` (delete `pipe`),
> `[eval-fnerror.md](./eval-fnerror.md)` (keep `FnError`),
> `[research-orpc-internals.md](./research-orpc-internals.md)` (how hard owning HTTP is).
> Private research (kept out of this repo): `~/dev/output-schema-migration-notes.md`.

---

## 1. What the package is

`@davstack/fn` is a **transport-agnostic server-function convention**. You define a plain
function with metadata:

```ts
createPublicServerFn({
  name, description?, tags?,
  inputSchema?, outputSchema?,
  route?: { path, method },   // (proposed) marks it as a public HTTP endpoint
  handler: async ({ input, ctx }) => { ... },
})
```

The defining property — and the thing the user values most — is that **the fn is callable
with the exact same `{ input, ctx }` as its handler**. No builder chain; a flat `{}` config
object. This makes fns directly callable, portable, testable, and composable, independent of
any transport.

Real consumption today:

- **titanium** uses it via `initCreateFn<Ctx>([...middleware])` → `createPublicServerFn` /
`createAuthedServerFn`, with three middlewares (tracing, error-handling, auth). ~92 in-use
fns. Currently bridged into **tRPC** through `initProcedureFactory` (a ~256-line `router.ts`
with ~98 manual registrations).
- **aftrak** does NOT use `@davstack/fn`; it uses **oRPC** directly (15 procedures, all with
`.output()`). It is the reference for the oRPC + OpenAPI pattern.

---

## 2. The guiding philosophy (the principle everything else follows from)

**Ports & adapters.** Business logic lives in plain, portable, directly-callable functions.
Transport (tRPC / oRPC / HTTP) is a thin adapter bolted on at the edge — never the home of
the logic.

The user articulated this sharply: they *dislike* the "server-fn wrapped in tRPC/oRPC" model
because it "feels like typing up all your business logic within a 3rd-party library." They
*prefer* directly-callable functions because they're portable (usable in tests, other
frameworks), and composable. This is the north star.

Consequence: the package is really **two layers**, and they have very different risk profiles:

- **Layer 1 — the directly-callable fn convention.** Good, safe, low-risk. This is your own
code in plain-function form. Not lock-in.
- **Layer 2 — the transport/codegen bridge.** Risky. Source of both the registration
boilerplate *and* the IDE lag. Must stay thin, optional, and ejectable.

---

## 3. The cautionary tale & the test that keeps us honest

The user was previously burned by `**@davstack/store`**: a custom-optimal solution that lost
to standard-but-AI-trained alternatives because of the compatibility/education tax. The fear
is repeating that — building a "framework" the world must adopt.

**The ejectability test:** a *convention* is one you can throw away while keeping the durable
artifacts; a *framework* owns your control flow and can't be removed without a rewrite.

This package passes the test **as long as the durable artifact is a standard** (OpenAPI) and
the durable logic is **your own plain functions**. The danger is only ever in Layer 2.

A key clarification that resolved a lot of tension: there are two meanings of "standard."

- ❌ *Evangelize a new governed spec the world must adopt* — this is the store trap. Avoid.
- ✅ *Adopt the minimal convergent shape everyone already uses* (input + output + handler +
name/description) — this is just naming the obvious. Safe.

The fn shape is the second kind. So "make it a standard" is fine **if** it means "use the
convergent shape + lean on existing standards," and dangerous **if** it means "get others to
adopt open-fn and maintain governance/compat for external users."

---

## 4. Decision log

Each entry: **decision · rationale · caveats · status.**

### D1 — Delete `pipe`

- **Decision:** remove `src/pipe.ts`, drop its export, remove the stale `why-pipe-over-middleware.md`.
- **Rationale:** dead code inherited from `packages/store`. Unused by `createFn`, tests, or
README. Its one theoretical advantage (type-safe progressive context evolution) is
deliberately *not* used — context is declared upfront as one generic. The middleware array
is strictly more capable (it needs around/onion semantics + short-circuit that `pipe`'s
linear `reduce` can't express). The 2-line runtime is buried under ~4245 lines of overload
signatures — pure type-check-time noise and a contributor to IDE lag.
- **Caveat:** none. (Only reason to keep would be exposing a generic FP helper for consumers —
not fn-specific value.)
- **Status:** agreed. (See `eval-pipe-vs-middleware.md`.)

### D2 — Keep `FnError`

- **Decision:** retain `src/errors.ts`.
- **Rationale:** load-bearing and earns its ~150 lines. Gives typed error `code`
(tRPC-style), `functionTrace` accumulation across composed fns (semantic call path of fn
names — survives async boundaries where native stacks don't), idempotent `from()` (enhances
in place, preserves original cause/stack), `markAsReported()` dedup, and structured `meta`
(zod field errors for the `Result` error half). Plain `Error` would mean reimplementing a
worse subset. It's baked into the public `Result<T>` type.
- **Caveat:** minor cleanups available (redundant `cause` field reassignment;
`getDefaultErrorMessage` only covers ~5/19 codes).
- **Status:** agreed — keep. (See `eval-fnerror.md`.)

### D3 — Replace `.safeCall` with a standalone `tryCatch`

- **Decision:** remove the `.safeCall` method from the fn object; ship a standalone
`tryCatch(promise)` util (in its own package) that wraps any promise into `{ data, error }`.
  ```ts
  type Result<T, E = Error> = { data: T; error: null } | { data: null; error: E };
  async function tryCatch<T, E = Error>(promise: Promise<T>): Promise<Result<T, E>> {
    try { return { data: await promise, error: null }; }
    catch (error) { return { data: null, error: error as E }; }
  }
  ```
- **Rationale:** makes the fn a *plain callable* (no methods bolted on) → maximally portable
and composable, aligning with the core philosophy. The util is generic (works on any
promise, not just fns) and uses the widely-recognized shape (good for the anti-store
"use familiar patterns" goal). Lighter core.
- **Caveats:** (1) type it `tryCatch<T, FnError>(...)` at fn call sites to keep typed-error
branching. (2) `tryCatch(fn(args))` evaluates the promise eagerly, so errors thrown during
*argument construction* aren't caught — a non-issue for async fns (they reject, never throw
sync).
- **Status:** agreed; near-term.

### D4 — Standard Schema v1 instead of zod under the hood

- **Decision:** type the core's schema fields as `StandardSchemaV1` rather than zod-specific
types; validate via `schema['~standard'].validate(...)`; infer via
`StandardSchemaV1.InferInput/InferOutput`.
- **Rationale:**
  - oRPC is itself built on Standard Schema, so `toOrpcRouter` passes schemas straight
  through — native composition, zero impedance. (Standard Schema makes *more* sense for the
  oRPC setup, not less.)
  - Decouples the core from zod → users can bring zod / valibot / arktype.
  - **Deletes the zod v3/v4 dual-support code** (`isZod4`, branched `zInfer`/`zInferInput`) —
  so this is partly *subtraction*, not just refactor.
  - Fixes the titanium **zod import-drift landmine** (`zod/v3` vs `zod` root on `zod@^3.25`
  causing "two zod instances" errors) at the package boundary.
- **The decisive caveat:** Standard Schema standardizes *validation*, **not** JSON-Schema
generation. So the OpenAPI step needs a library-specific converter, registered with oRPC's
generator. **zod → `@orpc/zod`** is the most mature (zod v4 also has native
`z.toJSONSchema`). valibot/arktype converters exist but are less battle-tested.
- **Net pattern:** **Standard Schema as the *interface* (core, lib-agnostic), zod as the
*implementation* you actually write** (best OpenAPI conversion). The core never needs
zod-specific behavior; anything lib-specific lives in the adapter layer where knowing it's
zod is fine.
- **Status:** agreed; folds into the core subtraction.

### D5 — Make `outputSchema` required when `route` is set

- **Decision:** require `outputSchema` iff the fn has a `route` (i.e. is publicly exposed);
optional otherwise.
- **Rationale (this is load-bearing, not cosmetic):**
  1. **Cheaper types / fixes IDE lag.** The lag comes from output types inferred as
    `Awaited<ReturnType<handler>>` *through* Kysely's heavy types, ×~98. Sourcing the type
     from `outputSchema` (`InferOutput`) makes it an already-flat resolved type. This is the
     enabling condition for a typed adapter without lag.
  2. **OpenAPI is impossible without it** — you can't serialize an inferred TS type to JSON
    Schema at runtime; you need a declared output schema.
  3. **Runtime safety boundary** — catches handler bugs and stops leaking extra DB columns
    (relevant to RLS/security work).
  4. **Smoke tests** get an assertion target.
- **Why `iff route` (not global):** kills the only weak case — void setter fns gaining nothing
but `z.void()` boilerplate. `route` becomes both the "expose" switch *and* the
"output required" trigger. Internal/void fns stay friction-free.
- **Caveat — validate at the boundary, not on direct calls:** parse output at the HTTP edge
(and always in dev to catch schema/handler drift); skip on internal direct calls so the
hot portable-call path stays zero-overhead. Drift maintenance (schema vs `selectAll()` as
columns change) is the real ongoing cost — supazod regen covers base tables; partial
selects/joins drift and need discipline.
- **Status:** agreed in principle; depends on adopting the `route` metadata.

### D6 — Package split: dep-free core + separate adapter packages

- **Decision:** core `@davstack/fn` carries **zero transport deps**. tRPC and oRPC adapters
live in separate packages. `tryCatch` in its own package too.
- **Rationale:** the live contradiction is a "transport-agnostic" core that hard-depends on
`@trpc/server` + `superjson` in `dependencies`. Splitting is pure hygiene and *reduces*
maintenance. It also makes each adapter individually optional/ejectable.
- **Caveat / scope discipline:** split the core out, but do **not** build a general "plugin
system"/ecosystem for hypothetical adapters — that's premature generalization (store trap).
Build exactly the adapters you need (tRPC for titanium today, oRPC for aftrak); let any
third adapter reveal the shared shape.
- **Status:** agreed; near-term (see §6 plan).

### D7 — OpenAPI is the *boundary*; oRPC is the *implementation*

- **Decision:** treat `openapi.json` as the contract/boundary. Whatever serves it (oRPC now)
is a swappable implementation detail.
- **Rationale:** this resolves the apparent "OpenAPI vs oRPC" conflict — they're different
layers. The client (orval-generated hooks) depends *only* on the spec, never imports oRPC.
So you can later swap oRPC → your own generator+handler with **zero downstream change**.
Independence is secured by the spec being the boundary — you get it *now* without owning the
generator now.
- **Caveat:** because the boundary is the spec, "use openapi" and "use the oRPC adapter" are
both true simultaneously. Don't agonize over the choice; it's reversible.
- **Status:** agreed as the principle.

### D8 — Owning the HTTP layer: possible & cheap, but delegate for now

- **Research verdict:** owning a standard-OpenAPI HTTP handler is a **~1-day, ~250–400 LOC**
job. Our use case (orval → plain JSON REST) maps to oRPC's `OpenAPIHandler` family, **not**
its `RPCHandler`/custom RPC protocol — and the RPC half (super-JSON typed codec for
Date/Map/Set/bigint/File, RPC wire format, RPC client) is the bulk of oRPC's size and is
**completely irrelevant** to us. MVP = match route (reuse `rou3` trie), parse JSON body +
path/query, validate via Standard Schema, call fn, validate output, map error→status
(~80 trivial LOC), return JSON; adapters ~30–50 LOC each. Long tail (bracket-notation nested
query params, files/multipart, SSE/streaming, exotic coercion) is all deferrable.
- **Decision:** **delegate to oRPC for now.** The user has no time to build/maintain HTTP.
The research was still worth it: it proves you *could* own it cheaply, which permanently
kills the "thin oRPC wrapper" anxiety.
- **Why "thin wrapper" doesn't apply anyway:** your value was never HTTP serving — it's the
fn-authoring layer, the internal/composition superset (oRPC has no concept of
"functions that exist but aren't exposed"), and the OpenAPI projection. The adapter is the
last ~5%.
- **Status:** delegate now; owning is a documented, deferred option.

### D9 — A registry `{ key: fn }` as the single source of truth

- **Decision:** collect fns into a registry object; everything is a projection of it.
  ```
  registry { k: fn }  ─→ toOrpcRouter(registry) ─→ oRPC serves HTTP
  (ALL fns)           │        └─→ oRPC emits openapi.json ─→ orval ─→ typed hooks
                      └─→ smokeTest(registry) ─→ loop, call, assert output
  ```
- **Rationale:** one source feeds router, spec, and smoke tests. **Registry = all fns
(superset); OpenAPI = the `route`d subset (projection).** Internal/composition fns live in
the registry and feed smoke tests but never get a `route`, so never hit the public spec —
the internal-layer value falls straight out of the design. Registry can be nested
(`{ user: { list, create } }`) for grouping → oRPC structure / OpenAPI tags; `route` drives
the actual HTTP path.
- **Caveat:** `toOrpcRouter` should be a **generic mapper**, not 98 hand-registrations — that
avoids replicating titanium's `router.ts` pain.
- **Status:** agreed as the target shape (deferred with the oRPC/openapi decision).

### D10 — Codegen is an explicit command, NOT in the watch script

- **Decision:** `pnpm gen:api` = registry → `openapi.json` → orval → hooks. Run on demand.
- **Rationale:** codegen-on-every-save is exactly the always-running magic machinery that
causes noise/lag — the thing being escaped. Contract changes are infrequent and intentional
(like migrations); handler-body edits (the common case) don't change the contract, so ~95%
of saves shouldn't trigger codegen. Predictable > automatic, matching the low-abstraction
values. Automate later only if manual runs become genuinely annoying (or have oRPC serve the
spec live at `/openapi.json` and point orval at the endpoint).
- **Status:** agreed (applies if/when the openapi/orval path is adopted).

### D11 — Smoke tests from the registry

- **Decision:** `smokeTest(registry)` loops every fn, calls it, asserts the result validates
against its `outputSchema`.
- **Rationale:** registry gives free enumeration; mandatory output schema gives the assertion
target.
- **Caveat (be honest about it):** valid inputs + a test ctx (db/user) are *not* free.
Auto-coverable: `z.void()`/no-input fns. Everything else needs a registered fixture
(e.g. an optional `examples`/`fixture` field on the fn, reusable as OpenAPI example
payloads). The runner must **log which fns it skipped** — never report green on partial
coverage.
- **Status:** desirable; deferred.

### D12 — Naming: `open-fn` vs keep `@davstack/fn` — UNDECIDED

- **Arguments for keeping `fn`:** it's accurate and humble; already published at
`@davstack/fn` v1.1.0 (renaming = churn); "open-X" implies an open *standard* with
governance, which is the framing to avoid. You can *describe* it as "an open,
transport-agnostic fn convention that compiles to OpenAPI" without renaming.
- **Arguments for `open-fn`:** evokes OpenAPI; signals the interoperable/standard intent;
brandable; with Standard Schema adoption the "open/interoperable" framing is more defensible.
- **Status:** **open / undecided.** Leaning cautious (keep `fn`) but not settled.

---

## 5. The IDE-lag diagnosis (context for several decisions above)

After running the tRPC-generation script on a titanium branch, the IDE began lagging badly.
Most likely cause: the generated tRPC `AppRouter` over ~98 procedures, each inferring its
output type *through* heavy Kysely query builders → tsserver type-instantiation blowup.
Secondary contributors: the unused 60-overload `pipe`, and zod v3/v4 dual inference.

Mitigations (which several decisions encode): source output types from `outputSchema` instead
of inferring handler returns (D5); delete `pipe` (D1); move to Standard Schema (D4); prefer a
data artifact (`openapi.json`) over a giant generated *typed* router file — **codegen that
emits DATA is harmless; codegen that emits heavy TYPES is what lagged** (D7/D10). Confirm with
`tsc --generateTrace` if needed.

---

## 6. The near-term plan (deliberately cautious)

The user is intentionally limiting changes — **not yet committing** to going all-in on oRPC,
or on the OpenAPI/orval direction. So for now:

1. **Move `tryCatch` to a separate package** and export it; **remove `.safeCall`** (D3).
2. **Swap to Standard Schema v1** over zod in the core (D4).
3. **Move `@trpc/server` + `superjson` deps to a separate package** — but **keep tRPC
  compatibility** (titanium still relies on it). I.e. move the **tRPC plugin/adapter
   (`initProcedureFactory`) into its own package**, don't delete it (D6).
4. **Create a separate oRPC adapter package** for the aftrak codebase (D6).
5. **Delete `pipe`** (D1) and **keep `FnError`** (D2).

Explicitly **deferred / not doing now:** owning the HTTP layer (D8), the registry+codegen+
orval pipeline (D9/D10), smoke tests (D11), making `outputSchema` mandatory across titanium
(D5 — the migration), and the final naming call (D12).

> **Implementation status (branch `fn-near-term-plan`).** Done, in this order:
>
> 1. ✅ **Deleted `pipe`** (D1) — removed `src/pipe.ts` + its export + the stale
>   `why-pipe-over-middleware.md` note.
> 2. ✅ **Extracted `tryCatch` → new `@davstack/try-catch`** (zero-dep) and **removed
>   `.safeCall`** (D3). Also removed the now-dead `Result` type and `withSafeResultFormatter`
>    middleware from core. fn tests that used `.safeCall` now assert on the thrown `FnError`.
> 3. ✅ **Extracted the tRPC adapter → new `@davstack/fn-trpc`** (D6); dropped `@trpc/server`
>   **and** `superjson` from core deps (`superjson` was unused everywhere — dropped, not
>    moved). **Core now has zero runtime dependencies.**
>
> **Paused here, before** the **oRPC adapter package** (D6, item 4) — by request, pending the
> decision on whether to go all-in on oRPC/OpenAPI. Also **not done this round:** the Standard
> Schema v1 swap (D4) — still zod-coupled for now. `FnError` kept (D2). fn bumped to a major
> (`2.0.0`) via changeset; the two new packages start at `0.1.0`.

This keeps every change either **pure subtraction** or **dependency-relocation** — no bets on
the uncertain Layer-2 direction. The architecture stays open: adopting oRPC/OpenAPI later is a
clean, additive step because the boundary (the spec) and the source of truth (plain fns)
don't change.

> **Don't forget the docs.** Several near-term changes are breaking and must be reflected in
> the `README.md` (and `CHANGELOG.md` / a version bump): `.safeCall` removed in favour of the
> standalone `tryCatch`, the Standard Schema swap (no longer zod-coupled), and the tRPC/oRPC
> adapters moving to separate packages (new install + import paths). Update docs as part of
> the same change, not after — stale examples are how a "simple" package starts feeling
> untrustworthy.

---

## 7. Supporting research (summaries)

**Output-schema migration effort** (private notes at `~/dev/output-schema-migration-notes.md`):
aftrak already 15/15 with output schemas. titanium ~~92 fns, ~49 already have `outputSchema`
(~~53%), ~43 missing. supazod `RowSchema` reuse + `z.coerce.date()` already solves the
date-column killer; `.pick()`/`.extend()` patterns already in production. ~25 of the 43 are
trivial/codemod-able, ~12–16 need hand-crafting (chart/stats/nested). **Total ~1.5–3 dev-days.**
Risks: zod import drift (v3 vs root), runtime parse cost on hot list/live endpoints, loosely
-typed Json columns, void-fn boilerplate.

**oRPC internals** (`research-orpc-internals.md`): owning standard-OpenAPI HTTP is a ~1-day /
250–400 LOC MVP; the hard, large parts of oRPC are the RPC protocol + exotic serializer, none
of which our plain-JSON use case needs. The OpenAPI spec generator (`@orpc/openapi`, ~880 LOC)
is fully decoupled from serving — reuse it build-time-only, or own a lean zod-only generator
later.