---
"@davstack/fn": major
---

**Breaking — core is now transport-agnostic with zero runtime dependencies.**

- **Removed `.safeCall`.** Wrap a direct call with `tryCatch` from the new
  `@davstack/try-catch` package to get a `{ data, error }` result instead of a throw:
  `const { data, error } = await tryCatch(() => myFn({ input, ctx }))`.
- **Removed the `Result` type** (it now lives in `@davstack/try-catch`).
- **Extracted the tRPC adapter (`initProcedureFactory`) to the new `@davstack/fn-trpc`
  package.** Install `@davstack/fn-trpc` and import `initProcedureFactory` from there.
- **Removed the `pipe` export** (dead code inherited from the old `store` package; the
  middleware array is strictly more capable).
- **Dropped `@trpc/server` and `superjson` from dependencies** (`superjson` was unused;
  tRPC moved to `@davstack/fn-trpc`).
