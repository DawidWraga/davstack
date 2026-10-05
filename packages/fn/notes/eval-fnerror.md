# Evaluation: why `FnError`? Is it needed? (verdict: yes — keep it)

> Analysis of `src/errors.ts` and how it's used. Opposite conclusion to
> [`eval-pipe-vs-middleware.md`](./eval-pipe-vs-middleware.md): unlike `pipe`, `FnError`
> earns its place.

## TL;DR

**Keep `FnError`.** It's load-bearing (used by every validation path, the `Result`/`safeCall`
type, and the composition story) and gives you things plain `Error` can't, cheaply (~150
lines). It's the core of the package's value prop, not redundant inheritance.

## What it buys you over plain `Error`

1. **Typed error `code`** (tRPC-style: `UNAUTHORIZED`, `NOT_FOUND`, `INVALID_INPUT`, …).
   Lets `.safeCall()` consumers and HTTP/tRPC layers branch on the *kind* of failure without
   string-matching messages. Plain `Error` has nothing here.

2. **`functionTrace` across composed fns** — the headline feature (tested in
   `test/error-reporting.test.ts:156` and `test/tracing.test.ts`). As an error bubbles
   through nested fns, `enhanceError` does `trace.unshift(def.name)`, producing
   `[outerFn, middleFn, innerFn]` — a *semantic* call path of your fn names/tags. A native
   stack trace gives file:line and gets mangled across async boundaries; it won't tell you
   which business operations were in play.

3. **Idempotent `from()`** — if the cause is already an `FnError`, it *enhances in place*
   rather than re-wrapping. This is exactly the fix for the `improvements.md` complaint
   ("we recreate errors in the wrapper, so we lose the original stack trace and get a
   loooong message"). Original `cause` + stack are preserved while the trace accumulates.

4. **`markAsReported()` / `_reported`** — dedup flag so a nested error isn't logged 3× as it
   bubbles through 3 fns (tested at `test/error-reporting.test.ts:63`). Plain `Error` can't
   carry this cleanly.

5. **Structured `meta`** (e.g. `zodErrors`, `input`) — `withInputValidation` /
   `withOutputValidation` attach Zod's `.flatten()`, so `safeCall` callers get field-level
   validation detail. This is the `error` half of the `{ data, error }` `Result`.

## Is it strictly needed?

You *could* throw plain `Error`s — but the moment you want codes, validation detail in
`safeCall`, the cross-fn trace, or log dedup, you'd be reimplementing a worse subset of
exactly this. Not redundant the way `pipe` is.

`Result<T>` itself is typed as `{ data: T; error: null } | { data: null; error: FnError | Error }`,
so `FnError` is baked into the public surface.

## Why it's here (vs `pipe`)

`pipe` is dead inheritance from `packages/store`. `FnError` is the core of the package's
value prop — typed/validated errors with a composition-aware trace, framework-agnostic
(works in tRPC, server actions, and plain direct calls). The `improvements.md` notes
literally list the error problems (obfuscated messages, lost stack traces) that `FnError`
is the solution to.

## Optional cleanups (not blockers)

- `cause?: unknown` is redeclared as an instance field and reassigned, even though
  `super(message, { cause })` already sets `this.cause` (ES2022). Slightly redundant.
- `getDefaultErrorMessage` only handles ~5 of the ~19 codes; the rest fall through to
  `Error: ${code}`. Either fill them in or drop the switch and inline.

## Conclusion

**Keep `FnError`.** Delete `pipe`, keep this.
