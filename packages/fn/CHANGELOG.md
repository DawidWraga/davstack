# @davstack/fn

## 2.0.0

### Major Changes

- 40b8db5: **Breaking — core is now transport-agnostic with zero runtime dependencies.**

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

## 0.1.6

### Patch Changes

- change internals for trpc integration to try fix build type issues

## 0.1.5

### Patch Changes

- fix tsup building broken types bug (zInfer name conflict)

## 0.1.0

### Minor Changes

- bfde332: publish initial service version
