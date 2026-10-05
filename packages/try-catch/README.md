# @davstack/try-catch

A tiny, zero-dependency helper that wraps a promise or thunk into a `{ data, error }` result — so you can skip the `try/catch` boilerplate and handle failures inline.

## Install

```bash
npm install @davstack/try-catch
```

## Usage

```ts
import { tryCatch } from "@davstack/try-catch";

// Promise form
const { data, error } = await tryCatch(fetchUser(id));

// Preferred: thunk form — also catches synchronous throws
const { data, error } = await tryCatch(() => fetchUser(id));
```

Prefer the thunk form (`() => ...`) when the work might throw *synchronously*. Passing `tryCatch(doThing())` runs `doThing()` outside the internal try/catch, so a synchronous throw would escape uncaught. `tryCatch(() => doThing())` captures both sync and async failures.

## Narrowing

Exactly one of `data` or `error` is non-null. Discriminate on `error`:

```ts
const { data, error } = await tryCatch(() => fetchUser(id));
if (error) {
	// error is non-null here
	return handle(error);
}
// data is narrowed to non-null here
use(data);
```

## Pairs with @davstack/fn

A [`@davstack/fn`](https://www.npmjs.com/package/@davstack/fn) direct call throws a typed `FnError` on bad input/output. Wrap it with `tryCatch` to get a result instead of a throw:

```ts
const { data, error } = await tryCatch(() => createUser({ input }));
if (error) {
	// handle the FnError
}
```
