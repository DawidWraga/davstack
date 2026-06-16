# Evaluation: is `pipe` worth keeping? (verdict: no — delete it)

> Analysis of `src/pipe.ts` against what the package actually does.
> See also the (now stale) design note [`why-pipe-over-middleware.md`](./why-pipe-over-middleware.md),
> whose conclusion the shipped code contradicts.

## TL;DR

**Delete `pipe`.** It's dead code inherited from `packages/store`, it's unused, and for
this package's needs the middleware array is *strictly more capable*. The one advantage
`pipe` has (type-safe progressive context evolution) is something this package deliberately
does **not** do.

## What `pipe` actually is

`src/pipe.ts` is 4247 lines, but the runtime is **2 lines** (the last ones in the file):

```ts
export function pipe(x: any, ...fns: any[]) {
  return fns.reduce((y: any, fn) => fn(y), x);
}
```

The other ~4245 lines are pure TypeScript overload signatures (one per arity,
`pipe(x)` … `pipe(x, f1, …, f40)`) so chained types infer. They're erased at build —
**zero bundle/runtime cost** (package is `sideEffects: false`, tree-shakeable). The real
cost is type-check time, file noise, and maintenance.

## Is it used?

No. `pipe` is exported from `index.ts` but:

- **not** used by `createFn` (which runs on the middleware array + `executeMiddleware`),
- **not** referenced in any test,
- **not** referenced in the README.

It's orphaned — it came across when this code lived in `packages/store`.

## Does `pipe` give any benefit here? No.

### 1. Its one advantage is unused

`why-pipe-over-middleware.md` argued `pipe` wins on **type-safe progressive context
evolution** (middleware A adds `user`, so B + the handler then see `user` typed). But this
package punts on that entirely:

- `middleware?: Middleware<any>[]` — the array is typed `any`; context changes are **not**
  tracked through the chain.
- Context is declared **upfront** as one generic: `initCreateFn<AuthedServerFnCtx>([authMw])`.
  In `test/composition.test.ts`, `ctx.user` is `{ id: string }` because the generic
  *asserted* `AuthedServerFnCtx`, not because `authMw` narrowed it.

So the design sidesteps the "type hell" the note worried about by just naming the full
context type upfront. `pipe`'s only edge is therefore moot.

### 2. `pipe` is strictly *less* expressive for this use case

`pipe` is a linear `reduce`: value out → value in, every step runs, forward only. But all
four built-in behaviors need *around* ("onion") semantics that `pipe` can't express:

| Built-in middleware       | Needs…                                  | `pipe` can do it? |
| ------------------------- | --------------------------------------- | ----------------- |
| `withThrowingErrorHandler`| `try { await next() } catch` downstream | ❌ can't catch downstream |
| `withSafeResultFormatter` | run after `next`, reshape to `{data,error}` | ❌ no "after" hook |
| `withOutputValidation`    | validate the *result* of `next`         | ❌                |
| auth middleware           | **short-circuit** (don't call `next`)   | ❌ pipe always runs every step |

Plus every middleware receives `{ ctx, input, def, next }` together; a `pipe` step only
gets the single piped value, so it can't see `def`/metadata or swap `input` + `ctx`
independently.

## Conclusion

The `next`-chain (Express/tRPC style) is the right primitive, and it's what already shipped.
`pipe` would be a downgrade: its theoretical edge is unused, and it loses the
around/short-circuit semantics the package relies on.

**Action:** delete `src/pipe.ts`, remove `export * from './pipe'` from `index.ts`, and remove
the stale `why-pipe-over-middleware.md` note (the code went the other way).

The only reason to keep `pipe` would be exposing it as a generic FP helper for consumers'
own handler code — but nothing here uses it, and that's not fn-specific value.
