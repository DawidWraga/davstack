import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { createFn, FnHandler, initCreateFn, createMiddleware } from '../src';

// Mock types for testing
type ServerFnCtx = {
	logger: {
		info: (msg: string) => void;
		error: (error: unknown, msg: string) => void;
	};
	db: {
		users: { findById: (id: string) => Promise<{ id: string; name: string }> };
	};
	user?: { id: string };
};

type AuthedServerFnCtx = Required<ServerFnCtx>;

describe('fn type system', () => {
	describe('basic createFn types', () => {
		it('should properly infer handler input and output types', () => {
			const inputSchema = z.object({ title: z.string() });
			const myFn = createFn({
				name: 'test',
				inputSchema,
				handler: async ({ input, ctx }) => {
					// Test that input is properly typed
					expectTypeOf(input).toEqualTypeOf<{ title: string }>();
					// Test that ctx is properly typed as unknown by default
					expectTypeOf(ctx).toEqualTypeOf<unknown>();
					return { success: true };
				},
			});

			// Test the return type is properly inferred
			expectTypeOf(myFn).parameter(0).toEqualTypeOf<{
				input: { title: string };
				ctx?: unknown;
			}>();
		});

		it('should properly handle context types', () => {
			const myFn = createFn<ServerFnCtx>({
				name: 'test',
				handler: async ({ input, ctx }) => {
					// Test that ctx is properly typed
					expectTypeOf(ctx).toEqualTypeOf<ServerFnCtx>();
					// Test that input is null when no schema provided
					expectTypeOf(input).toEqualTypeOf<null>();
					return ctx.user?.id ?? 'anonymous';
				},
			});

			expectTypeOf(myFn).parameter(0).toEqualTypeOf<{
				input?: void;
				ctx: ServerFnCtx;
			}>();
		});
	});

	describe('initCreateFn and middleware composition', () => {
		it('should create typed middleware that preserves handler types', () => {
			// Test createMiddleware helper
			const loggingMiddleware = createMiddleware<ServerFnCtx>(
				(def, handler) => {
					return async (opts) => {
						opts.ctx.logger.info(`-> Calling '${def.name}'`);
						const result = await handler(opts);
						opts.ctx.logger.info(`<- Finished '${def.name}'`);
						return result;
					};
				}
			);

			// Middleware should preserve the exact handler type
			expectTypeOf(loggingMiddleware).toEqualTypeOf<
				<TInputSchema extends z.ZodTypeAny | undefined, TOutput>(
					def: any,
					handler: FnHandler<ServerFnCtx, TInputSchema, TOutput>
				) => FnHandler<ServerFnCtx, TInputSchema, TOutput>
			>();
		});

		it('should create properly typed function factory with middleware', () => {
			const loggingMiddleware = createMiddleware<ServerFnCtx>(
				(def, handler) => {
					return async (opts) => {
						opts.ctx.logger.info(`-> ${def.name}`);
						return handler(opts);
					};
				}
			);

			const createServerFn = initCreateFn<ServerFnCtx>().use(loggingMiddleware);

			// Test that the factory produces properly typed functions
			const inputSchema = z.object({ userId: z.string() });
			const myFn = createServerFn({
				name: 'getUser',
				inputSchema,
				handler: async ({ input, ctx }) => {
					// Input should be properly typed
					expectTypeOf(input).toEqualTypeOf<{ userId: string }>();
					// Context should be properly typed
					expectTypeOf(ctx).toEqualTypeOf<ServerFnCtx>();

					return ctx.db.users.findById(input.userId);
				},
			});

			// Function call signature should be properly typed
			expectTypeOf(myFn).parameter(0).toEqualTypeOf<{
				input: { userId: string };
				ctx: ServerFnCtx;
			}>();

			// Return type should be properly inferred
			expectTypeOf(myFn).returns.toEqualTypeOf<
				Promise<{ id: string; name: string }>
			>();
		});

		it('should handle multiple middleware with type preservation', () => {
			const authMiddleware = createMiddleware<AuthedServerFnCtx>(
				(def, handler) => {
					return async (opts) => {
						if (!opts.ctx.user?.id) {
							throw new Error('Unauthorized');
						}
						return handler(opts);
					};
				}
			);

			const loggingMiddleware = createMiddleware<AuthedServerFnCtx>(
				(def, handler) => {
					return async (opts) => {
						opts.ctx.logger.info(`-> ${def.name}`);
						return handler(opts);
					};
				}
			);

			const createAuthedServerFn = initCreateFn<AuthedServerFnCtx>()
				.use(authMiddleware)
				.use(loggingMiddleware);

			const myFn = createAuthedServerFn({
				name: 'secureAction',
				inputSchema: z.object({ data: z.string() }),
				handler: async ({ input, ctx }) => {
					// Should have access to required user
					expectTypeOf(ctx.user).toEqualTypeOf<{ id: string }>();
					expectTypeOf(input).toEqualTypeOf<{ data: string }>();
					return { processed: input.data };
				},
			});

			expectTypeOf(myFn).parameter(0).toEqualTypeOf<{
				input: { data: string };
				ctx: AuthedServerFnCtx;
			}>();
		});

		it('should allow array-style middleware composition', () => {
			const middleware1 = createMiddleware<ServerFnCtx>(
				(def, handler) => handler
			);
			const middleware2 = createMiddleware<ServerFnCtx>(
				(def, handler) => handler
			);

			// Should support both styles
			const createFn1 = initCreateFn<ServerFnCtx>([middleware1, middleware2]);
			const createFn2 = initCreateFn<ServerFnCtx>()
				.use(middleware1)
				.use(middleware2);

			// Both should produce equivalent types
			expectTypeOf(createFn1).toEqualTypeOf(createFn2);
		});
	});

	describe('edge cases and optional types', () => {
		it('should handle functions with no input schema', () => {
			const createServerFn = initCreateFn<ServerFnCtx>();

			const noInputFn = createServerFn({
				name: 'ping',
				handler: async ({ input, ctx }) => {
					expectTypeOf(input).toEqualTypeOf<null>();
					expectTypeOf(ctx).toEqualTypeOf<ServerFnCtx>();
					return 'pong';
				},
			});

			// Should allow calling without input
			expectTypeOf(noInputFn).parameter(0).toEqualTypeOf<{
				input?: void;
				ctx: ServerFnCtx;
			}>();
		});

		it('should handle functions with no context requirement', () => {
			const createPureFn = initCreateFn();

			const pureFn = createPureFn({
				name: 'add',
				inputSchema: z.object({ a: z.number(), b: z.number() }),
				handler: async ({ input, ctx }) => {
					expectTypeOf(input).toEqualTypeOf<{ a: number; b: number }>();
					expectTypeOf(ctx).toEqualTypeOf<unknown>();
					return input.a + input.b;
				},
			});

			expectTypeOf(pureFn).parameter(0).toEqualTypeOf<{
				input: { a: number; b: number };
				ctx?: unknown;
			}>();
		});
	});
});
