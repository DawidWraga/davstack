New API Design:

Change Names:

- baseFn -> createFn
- authedService -> createAuthedFn
- publicService -> createPublicFn

So theres a bunch of complexity around managing the builder method and the middlware but i realised that perhaps its overkill and redudant because my existing impelemtnation (see attached doc of fn inside other codebase) was casting the type anyway so it was pretty pointless.

We want to keep thigns as LIGHT and SIMPLE as possible to minimize surface area, maintance overhead, bugs, cognitive load, etc.

So I was thinking, we coudl jsut make a simple config object and createFn, and either pass middleware in an array + typecast, or use a pipe function around the handler.

option A: pass middleware in an array + typecast

```ts
const loggingMiddleware = createMiddleware(({ ctx, next }) =>
// later we want indentation here to be based on the depth of the fn call, we can use logger.child or something like that, or add depth+1 to the ctx
	ctx.logger.info('-> fn called', {
		fn: ctx.fn.name,
		input: ctx.input,
		ctx: ctx.ctx,
	})

  const result = await next(ctx);

  ctx.logger.info('<- fn result', {
    fn: ctx.fn.name,
    result,
  })

  return result;
);
const authedMiddleware = createMiddleware(({ ctx, next }) => {
	if (!ctx.user.id) {
		throw new FnError({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		});
	}
	return next(ctx);
});

const createAuthedFn = (def: FnDef<any, any, any>) => {
	return createFn({
		...def,
		middleware: [...(def.middleware ?? []), loggingMiddleware, authedMiddleware],
	});
};
```

option B: use a pipe function around the handler

```ts
// lib/create-server-fn.ts

export type User = {
	id: string;
	email: string;
	role: 'USER' | 'ADMIN';
};
export type ServerFnCtx = {
	logger: Logger;
	db: PrismaClient;
	user?: User;
};
export type ServerFnCtxAuthed = Required<ServerFnCtx>;

function withBaseContext(fn: FnHandler<any, any, any>) {
	return (opts: { ctx: unknown; input: unknown }) => {
		const user = { id: '' };
		return fn({
			input: opts.input,
			ctx: {
				user,
				db: enhance(prisma, { user }),
				logger: createLogger({
					level: 'info',
					format: format.json(),
				}),
			},
		});
	};
}

function withLoggingMiddleware(fn: FnHandler<any, any, any>) {
	return (opts: { ctx: unknown; input: unknown }) => {
		const logger = opts.ctx.logger;
		logger.info('-> fn called', {
			fn: opts.ctx.fn.name,
			input: opts.input,
			ctx: opts.ctx,
		});
		const result = await fn(opts);
		logger.info('<- fn result', {
			fn: opts.ctx.fn.name,
			result,
		});
		return result;
	};
}

export const createPublicServerFn = (def: FnDef<PublicServerFnCtx>) => {
	return createFn<PublicServerFnCtx>({
		...def,
		handler: pipe(
			withBaseContext,
			withLoggingMiddleware,
			withErrorHandling,
			def.handler
		),
	});
};

export const createAuthedServerFn = (def: FnDef<AuthedServerFnCtx>) => {
	return createFn<AuthedServerFnCtx>({
		...def,
		handler: pipe(
			withBaseContext,
			withLoggingMiddleware,
			withErrorHandling,
			def.handler
		),
	});
};

export function createCtx() {
	const user = getUserFromCookie();
	return {
		user,
		db: enhance(prisma, { user }),
		logger: createLogger({
			level: 'info',
			format: format.json(),
		}),
	};
}
```

### 3\. The Core Architectural Decision: Middleware vs. `pipe`

This is the most important part of your new design. Let's compare Option A and Option B in detail.

#### Option A: Middleware Array (`middleware: [...]`)

This approach treats middleware as a list of layers in the configuration.

- **Pros:**
  - **Declarative:** It's very clear from looking at the `createAuthedFn` config what middleware is being applied.
  - **Familiar:** This pattern is very common in web frameworks like Express, making it intuitive for many developers.
- **Cons:**
  - **Type Hell:** This is the deal-breaker. As you chain middleware, the context type can change (e.g., an early middleware adds `user` to the context). Managing these evolving types across a generic array is extremely difficult in TypeScript. You often end up with `any` or needing complex HKTs (Higher-Kinded Types), which completely defeats your goal of simplicity. Your own example (`FnDef<any, any, any>`) shows you've already hit this wall.
  - **Implementation Complexity:** The `createFn` implementation needs a "runner" that iterates through the array, calls each middleware, and correctly handles the `next` function.

#### Option B: Handler Composition (`handler: pipe(...)`)

This approach treats middleware as simple function composition, where you wrap the core handler in layers of other functions.

- **Pros:**
  - ✅ **Rock-Solid Type Safety:** This is the biggest advantage. Standard function composition is something TypeScript handles beautifully. If you have `pipe(withAuth, withLogging, myHandler)`, TypeScript will automatically ensure the output of `withLogging` matches the input of `withAuth`, and so on. There's no type-casting and no `any`.
  - ✅ **Implementation Simplicity:** Your `createFn` function becomes incredibly "dumb" and simple. It doesn't even need to know what middleware is. It just receives a final, fully-formed `handler` function and executes it. The complexity is pushed into the `pipe` utility, which is a standard, easily testable function.
  - **Flexibility:** Developers aren't locked into your `middleware` abstraction. They can use your `pipe` utility, a third-party one (like from `fp-ts`), or just manually nest the function calls if they prefer.

**Verdict & Recommendation:**

**Option B (`pipe`) is decisively better and the clear path forward.** It aligns perfectly with your goals of simplicity, maintainability, and type safety. It avoids the hidden complexity of managing middleware context types, which is the exact trap that makes other frameworks so complicated internally.

---

