import { describe, test, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { createFn, FnError, createMiddleware } from '../src/create-fn';

// Mock context for testing
type TestContext = {
	user?: { id: string };
	db?: {
		users: {
			find: (id: string) => Promise<{ id: string; name: string }>;
		};
	};
};

describe('Type System', () => {
	test('should infer types for handler with input and default context', () => {
		const fn = createFn({
			name: 'test',
			inputSchema: z.object({ id: z.string() }),
			handler: async ({ input, ctx }) => {
				expectTypeOf(input).toEqualTypeOf<{ id: string }>();
				expectTypeOf(ctx).toEqualTypeOf<{}>();
				return { success: true, id: input.id };
			},
		});

		expectTypeOf(fn).parameter(0).toEqualTypeOf<{
			input: { id: string };
			ctx?: unknown;
		}>();
		expectTypeOf(fn).returns.resolves.toEqualTypeOf<{
			success: boolean;
			id: string;
		}>();
	});

	test('should infer types for handler with context and no input', () => {
		const fn = createFn<TestContext>({
			name: 'test',
			handler: async ({ input, ctx }) => {
				expectTypeOf(input).toEqualTypeOf<null>();
				expectTypeOf(ctx).toEqualTypeOf<TestContext>();
				// return ctx.user?.id ?? 'guest';
				return 'hello';
			},
		});

		const returnType = fn({ ctx: { user: { id: '123' } } });

		expectTypeOf(fn).parameter(0).toEqualTypeOf<{
			input?: void;
			ctx: TestContext;
		}>();
		// This should now properly infer the return type from the handler
		expectTypeOf(fn).returns.resolves.toEqualTypeOf<string>();
	});

	test('should handle functions with no context and no input', () => {
		const fn = createFn({
			name: 'ping',
			handler: async ({ input, ctx }) => {
				expectTypeOf(input).toEqualTypeOf<null>();
				expectTypeOf(ctx).toEqualTypeOf<{}>();
				return 'pong';
			},
		});

		// Allows calling with no arguments at all
		expectTypeOf(fn)
			.parameter(0)
			.toEqualTypeOf<{ input?: void; ctx?: unknown }>();
		expectTypeOf(fn).returns.resolves.toEqualTypeOf<string>();
	});
});

describe('Runtime Behavior', () => {
	const testFn = createFn({
		name: 'testFn',
		inputSchema: z.object({ title: z.string() }),
		outputSchema: z.object({ id: z.string(), title: z.string() }),
		handler: async ({ input }) => {
			if (input.title === 'throw') {
				throw new Error('Handler error');
			}
			if (input.title === 'invalid-output') {
				return { id: 123, title: 'bad-data' } as any;
			}
			return { id: '123', title: input.title };
		},
	});

	describe('Direct Call', () => {
		test('should return data directly on success', async () => {
			const result = await testFn({ input: { title: 'hello' } });
			expect(result).toEqual({ id: '123', title: 'hello' });
		});

		test('should throw an enhanced FnError on failure', async () => {
			await expect(testFn({ input: { title: 'throw' } })).rejects.toThrow(
				FnError
			);
			try {
				await testFn({ input: { title: 'throw' } });
			} catch (e) {
				const err = e as FnError;
				expect(err.code).toBe('INTERNAL_SERVER_ERROR');
				expect(err.message).toBe('Handler error');
				expect(err.meta.functionName).toBe('testFn');
			}
		});

		test('should NOT validate input or output schemas', async () => {
			// Does not throw on invalid input
			const result1 = await testFn({ input: { title: 123 } } as any);
			expect(result1.title).toBe(123);

			// Does not throw on invalid output
			const result2 = await testFn({ input: { title: 'invalid-output' } });
			expect(result2.id).toBe(123);
		});
	});

	describe('.safeCall()', () => {
		test('should return { data, error: null } on success', async () => {
			const { data, error } = await testFn.safeCall({
				input: { title: 'good' },
			});
			expect(error).toBeNull();
			expect(data).toEqual({ id: '123', title: 'good' });
		});

		test('should return an INVALID_INPUT error', async () => {
			const { data, error } = await testFn.safeCall({
				input: { title: 123 } as any,
			});
			expect(data).toBeNull();
			expect(error).toBeInstanceOf(FnError);
			expect((error as FnError).code).toBe('INVALID_INPUT');
		});

		test('should return an INVALID_OUTPUT error', async () => {
			const { data, error } = await testFn.safeCall({
				input: { title: 'invalid-output' },
			});
			expect(data).toBeNull();
			expect(error).toBeInstanceOf(FnError);
			expect((error as FnError).code).toBe('INVALID_OUTPUT');
		});

		test('should return an INTERNAL_SERVER_ERROR', async () => {
			const { data, error } = await testFn.safeCall({
				input: { title: 'throw' },
			});
			expect(data).toBeNull();
			expect(error).toBeInstanceOf(FnError);
			expect((error as FnError).code).toBe('INTERNAL_SERVER_ERROR');
		});
	});
});

describe('Middleware', () => {
	test('should execute middleware in order', async () => {
		const executionOrder: string[] = [];

		const mw1 = createMiddleware(async ({ next }) => {
			executionOrder.push('mw1-in');
			const result = await next();
			executionOrder.push('mw1-out');
			return result;
		});

		const mw2 = createMiddleware(async ({ next }) => {
			executionOrder.push('mw2-in');
			const result = await next();
			executionOrder.push('mw2-out');
			return result;
		});

		const fnWithMiddleware = createFn({
			name: 'mwTest',
			middleware: [mw1, mw2],
			handler: async () => {
				executionOrder.push('handler');
				return 'done';
			},
		});

		await fnWithMiddleware.safeCall({});
		expect(executionOrder).toEqual([
			'mw1-in',
			'mw2-in',
			'handler',
			'mw2-out',
			'mw1-out',
		]);
	});

	test('should allow middleware to modify context', async () => {
		type CtxWithUser = {
			user: { id: string; name: string };
			db: {
				users: { find: (id: string) => Promise<{ id: string; name: string }> };
			};
		};

		const authMiddleware = createMiddleware(async ({ ctx, next }) => {
			// This middleware "authenticates" the user and passes a new context
			// to the next function in the chain.
			const newCtx = {
				// ...ctx,
				user: { id: 'user-123', name: 'Alice' },
			};
			return next(newCtx);
		});

		const fnWithAuth = createFn<CtxWithUser>({
			name: 'getProfile',
			middleware: [authMiddleware],
			handler: async ({ ctx }) => {
				// The context here should be the one modified by the middleware.
				expectTypeOf(ctx).toEqualTypeOf<CtxWithUser>();
				return `Hello, ${ctx.user.name}`;
			},
		});

		const { data } = await fnWithAuth.safeCall({
			ctx: {
				user: { id: '123', name: 'Alice' },
				db: {
					users: { find: async (id) => ({ id, name: 'Alice' }) },
				},
			},
		});
		expect(data).toBe('Hello, Alice');
	});
});
