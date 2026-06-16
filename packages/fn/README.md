# @davstack/fn

A tiny, transport-agnostic convention for server functions. Define your business logic
once as a plain, **directly-callable** async function with input/output validation and
middleware — then call it from anywhere (a route handler, a server action, a script, or
another fn). Attach a transport (tRPC, oRPC, HTTP) at the edge with a thin adapter, never
in the core.

The core has **zero runtime dependencies** and never throws abstraction at you: a fn is
just a function you call with `{ input, ctx }`.

```bash
npm install @davstack/fn zod
```

> `zod` is a peer dependency (v3 or v4). Schemas are optional.

## Quick start

```ts
import { createFn, FnError } from '@davstack/fn';
import { z } from 'zod';

export const createChat = createFn({
	name: 'createChat',
	inputSchema: z.object({ title: z.string() }),
	handler: async ({ input, ctx }) => {
		return ctx.db.chat.create({ data: { title: input.title } });
	},
});

// Call it directly — same `{ input, ctx }` shape as the handler.
const chat = await createChat({ input: { title: 'Hello' }, ctx: { db } });
```

A fn validates its input (applying zod defaults/transforms), runs its middleware, runs the
handler, then validates its output if an `outputSchema` is set. On any failure it **throws an
`FnError`** (see [Errors](#errors)).

## Definition shape

```ts
createFn({
	name: 'sendWelcomeText',       // required — used in error traces & adapters
	description: '...',            // optional
	tags: ['sms', 'credits'],     // optional
	inputSchema: z.object({ ... }),   // optional
	outputSchema: z.object({ ... }),  // optional — validated on the way out
	middleware: [/* fn-specific middleware */], // optional
	handler: async ({ input, ctx }) => { ... },
});
```

`input` is typed from `inputSchema` (or `void` if omitted). The handler's return type (or
`outputSchema`) becomes the call's resolved type.

## Shared context & base middleware — `initCreateFn`

Declare your context type once and pre-attach base middleware with `initCreateFn`. Everything
built from it inherits that context type and middleware.

```ts
import { initCreateFn, createMiddleware, FnError } from '@davstack/fn';

type PublicCtx = { db: Db; user?: { id: string } };
type AuthedCtx = Required<PublicCtx>;

const authMiddleware = createMiddleware<AuthedCtx>(async ({ ctx, next }) => {
	if (!ctx.user?.id) throw new FnError({ code: 'UNAUTHORIZED' });
	return next(); // short-circuits if you don't call it
});

export const createPublicFn = initCreateFn<PublicCtx>();
export const createAuthedFn = initCreateFn<AuthedCtx>([authMiddleware]);
```

Now `createAuthedFn(...)` produces fns whose `ctx` is typed `AuthedCtx`, with `authMiddleware`
always running first.

## Middleware

Middleware is an onion (Express/tRPC-style `next` chain). Each receives
`{ ctx, input, def, next }` and can run code before/after `next`, swap the context or input
(`next(newCtx, newInput)`), wrap it in `try/catch`, or short-circuit by not calling it.

```ts
const timing = createMiddleware(async ({ def, next }) => {
	const start = performance.now();
	const result = await next();
	console.log(`${def.name} took ${performance.now() - start}ms`);
	return result;
});
```

## Composition

Because fns are just callables, compose them by calling one inside another's handler — pass
the same `ctx` through. Error traces accumulate across the call path (see below).

```ts
export const sendWelcomeText = createAuthedFn({
	name: 'sendWelcomeText',
	inputSchema: z.object({ chatId: z.string() }),
	handler: async ({ input, ctx }) => {
		await checkCredits({ input: { actionType: 'welcome' }, ctx });
		const text = await generateWelcomeText({ ctx });
		return sendSms({ input: { chatId: input.chatId, message: text }, ctx });
	},
});
```

## Errors

Failures throw an `FnError` — a typed error with a tRPC-style `code`, structured `meta`, and a
`functionTrace` that accumulates the fn names along the call path (so a deep failure tells you
*which business operations* were in play, not just a file:line stack).

```ts
import { FnError, isFnError } from '@davstack/fn';

throw new FnError({ code: 'INSUFFICIENT_CREDITS', message: 'Not enough credits' });
```

Validation failures throw automatically with `code: 'INVALID_INPUT'` / `'INVALID_OUTPUT'` and
the zod error in `meta.zodErrors`.

### Want a result instead of a throw?

There's no `.safeCall`. Wrap the direct call with [`tryCatch`](../try-catch) from the
companion package:

```ts
import { tryCatch } from '@davstack/try-catch';
import type { FnError } from '@davstack/fn';

const { data, error } = await tryCatch<Chat, FnError>(() =>
	createChat({ input: { title: 'Hello' }, ctx })
);
if (error) return handle(error); // typed FnError
use(data);                       // narrowed to non-null
```

Use the thunk form (`() => fn(...)`) so a synchronous throw is caught too.

## Transport adapters

The core knows nothing about transports. Attach one at the edge:

- **tRPC** — [`@davstack/fn-trpc`](../fn-trpc) turns a fn into a tRPC procedure via
  `initProcedureFactory`.

```ts
import { initTRPC } from '@trpc/server';
import { initProcedureFactory } from '@davstack/fn-trpc';

const t = initTRPC.create();
const fromFn = initProcedureFactory(t.procedure);

export const appRouter = t.router({
	createChat: fromFn(createChat, 'mutation'),
});
```

- **oRPC** — [`@davstack/fn-orpc`](../fn-orpc) turns a fn into an oRPC procedure via
  `initProcedureFactory` (no query/mutation arg — chain `.route()` for OpenAPI).

```ts
import { os } from '@orpc/server';
import { initProcedureFactory } from '@davstack/fn-orpc';

const fromFn = initProcedureFactory(os);

export const router = {
	createChat: fromFn(createChat),
};
```

## Companion packages

| Package | What it does |
| --- | --- |
| [`@davstack/try-catch`](../try-catch) | `tryCatch(promiseOrThunk)` → `{ data, error }` (zero-dep) |
| [`@davstack/fn-trpc`](../fn-trpc) | tRPC adapter (`initProcedureFactory`) |
| [`@davstack/fn-orpc`](../fn-orpc) | oRPC adapter (`initProcedureFactory`) |

## License

MIT
