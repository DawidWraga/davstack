import { beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createFn, createMiddleware, FnError } from '../src';
import { createMockLogger, mockDb } from './test-utils';

type ServerFnCtx = {
	logger: ReturnType<typeof createMockLogger>;
	db: typeof mockDb;
	user?: { id: string };
};

type AuthedServerFnCtx = Required<ServerFnCtx>;

describe('New Express-style Middleware System', () => {
	const logger = createMockLogger();
	beforeEach(() => logger.cleanup());

	test('should work with simple auth middleware', async () => {
		const authMiddleware = createMiddleware<ServerFnCtx, AuthedServerFnCtx>(
			({ ctx, next }) => {
				if (!ctx.user?.id) {
					throw new FnError({
						code: 'UNAUTHORIZED',
						message: 'Unauthorized',
					});
				}
				return next(ctx as AuthedServerFnCtx);
			}
		);

		const getSecretData = createFn({
			name: 'getSecretData',
			middleware: [authMiddleware],
			handler: async ({ ctx }) => {
				// ctx should now be AuthedServerFnCtx with required user
				return `Secret data for ${ctx.user.id}`;
			},
		});

		// Should work with authenticated user
		const result = await getSecretData({
			ctx: { logger, db: mockDb, user: { id: 'user123' } },
		});
		expect(result).toBe('Secret data for user123');

		// Should fail without user
		await expect(
			getSecretData({
				ctx: { logger, db: mockDb },
			})
		).rejects.toThrow(FnError);
	});

	test('should work with logging middleware', async () => {
		const loggingMiddleware = createMiddleware<ServerFnCtx>(
			({ ctx, def, next }) => {
				ctx.logger.info(`-> Calling '${def.name}'`);
				return next(ctx).then((result) => {
					ctx.logger.info(`<- Finished '${def.name}'`);
					return result;
				});
			}
		);

		const testFn = createFn({
			name: 'testWithLogging',
			middleware: [loggingMiddleware],
			handler: async ({ ctx }) => `Hello ${ctx.user?.id || 'anonymous'}`,
		});

		const result = await testFn({
			ctx: { logger, db: mockDb, user: { id: 'user123' } },
		});

		expect(result).toBe('Hello user123');
		expect(logger.info).toHaveBeenCalledWith("-> Calling 'testWithLogging'");
		expect(logger.info).toHaveBeenCalledWith("<- Finished 'testWithLogging'");
	});

	test('should work with context transformation middleware', async () => {
		const enrichContextMiddleware = createMiddleware<
			ServerFnCtx,
			ServerFnCtx & { timestamp: number }
		>(({ ctx, next }) => {
			return next({
				...ctx,
				timestamp: Date.now(),
			});
		});

		const testFn = createFn({
			name: 'testEnrichment',
			middleware: [enrichContextMiddleware],
			handler: async ({ ctx }) => {
				// ctx now has timestamp
				return { userId: ctx.user?.id, timestamp: ctx.timestamp };
			},
		});

		const result = await testFn({
			ctx: { logger, db: mockDb, user: { id: 'user123' } },
		});

		expect(result.userId).toBe('user123');
		expect(typeof result.timestamp).toBe('number');
	});

	test('should handle multiple middleware in correct order', async () => {
		const callOrder: string[] = [];

		const middleware1 = createMiddleware(({ ctx, next }) => {
			callOrder.push('middleware1-start');
			return next(ctx).then((result) => {
				callOrder.push('middleware1-end');
				return result;
			});
		});

		const middleware2 = createMiddleware(({ ctx, next }) => {
			callOrder.push('middleware2-start');
			return next(ctx).then((result) => {
				callOrder.push('middleware2-end');
				return result;
			});
		});

		const testFn = createFn({
			name: 'orderTest',
			middleware: [middleware1, middleware2],
			handler: async () => {
				callOrder.push('handler');
				return 'done';
			},
		});

		await testFn({});

		expect(callOrder).toEqual([
			'middleware1-start',
			'middleware2-start',
			'handler',
			'middleware2-end',
			'middleware1-end',
		]);
	});

	test('should still work with input validation', async () => {
		const testFn = createFn({
			name: 'testValidation',
			inputSchema: z.object({ title: z.string() }),
			handler: async ({ input }) => `Title: ${input.title}`,
		});

		// Valid input should work
		const validResult = await testFn.safeCall({
			input: { title: 'Test Title' },
		});
		expect(validResult.data).toBe('Title: Test Title');
		expect(validResult.error).toBeNull();

		// Invalid input should be caught
		const invalidResult = await testFn.safeCall({
			input: { title: 123 } as any,
		});
		expect(invalidResult.data).toBeNull();
		expect(invalidResult.error).toBeInstanceOf(FnError);
		expect((invalidResult.error as FnError).code).toBe('INVALID_INPUT');
	});

	test('should preserve original errors in middleware logging', async () => {
		const originalError = new Error('Database connection failed!');

		const loggingMiddleware = createMiddleware<ServerFnCtx>(
			({ ctx, def, next }) => {
				return next(ctx).catch((error) => {
					ctx.logger.error(error, `Error in ${def.name}`);
					throw error; // Re-throw to let other middleware handle it
				});
			}
		);

		const faultyFn = createFn({
			name: 'faulty',
			middleware: [loggingMiddleware],
			handler: async () => {
				throw originalError;
			},
		});

		await expect(faultyFn({ ctx: { logger, db: mockDb } })).rejects.toThrow(
			FnError
		);

		// Verify the original error was logged by our middleware
		expect(logger.error).toHaveBeenCalledWith(originalError, 'Error in faulty');
	});
});
