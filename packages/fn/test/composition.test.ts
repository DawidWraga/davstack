import { beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { initCreateFn, FnError } from '../src';
import {
	AuthedServerFnCtx,
	createMockLogger,
	mockDb,
	ServerFnCtx,
	loggingMiddleware,
	authMiddleware,
	authedLoggingMiddleware,
	authedErrorLoggingMiddleware,
	createTimingMiddleware,
} from './test-utils';

describe('Clean Composition API', () => {
	const logger = createMockLogger();
	beforeEach(() => logger.cleanup());

	describe('Middleware Creation', () => {
		test('should create and use right runtime types', () => {
			expect(typeof loggingMiddleware).toBe('function');
			expect(typeof authMiddleware).toBe('function');
			const timingMiddleware = createTimingMiddleware<ServerFnCtx>();
			expect(typeof timingMiddleware).toBe('function');
		});
	});

	describe('Function Factory Creation', () => {
		test('should create clean public server function factory', async () => {
			const createServerFn = initCreateFn<ServerFnCtx>([loggingMiddleware]);

			expect(typeof createServerFn).toBe('function');

			const getPublicData = createServerFn({
				name: 'getPublicData',
				handler: async ({ ctx }) => {
					return `Public data for ${ctx.user?.id || 'anonymous'}`;
				},
			});

			expect(typeof getPublicData).toBe('function');
			expect(typeof getPublicData.safeCall).toBe('function');
			expect(getPublicData.name).toBe('getPublicData');

			const result = await getPublicData({
				ctx: { logger, db: mockDb, user: { id: 'user_123' } },
			});

			expect(typeof result).toBe('string');
			expect(result).toBe('Public data for user_123');
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'getPublicData'");
			expect(logger.info).toHaveBeenCalledWith("<- Finished 'getPublicData'");
		});

		test('should create clean authed server function factory', async () => {
			const createAuthedServerFn = initCreateFn<AuthedServerFnCtx>([
				authMiddleware,
				authedLoggingMiddleware,
			]);

			expect(typeof createAuthedServerFn).toBe('function');

			const getSecretData = createAuthedServerFn({
				name: 'getSecretData',
				handler: async ({ ctx }) => {
					return `Secret data for ${ctx.user.id}`;
				},
			});

			expect(typeof getSecretData).toBe('function');
			expect(getSecretData.name).toBe('getSecretData');

			// Should succeed with proper user
			const result = await getSecretData({
				ctx: { logger, db: mockDb, user: { id: 'user_123' } },
			});

			expect(typeof result).toBe('string');
			expect(result).toBe('Secret data for user_123');
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'getSecretData'");
			expect(logger.info).toHaveBeenCalledWith("<- Finished 'getSecretData'");
		});

		test('should throw auth error for unauthenticated requests', async () => {
			const createAuthedServerFn = initCreateFn<AuthedServerFnCtx>([
				authMiddleware,
			]);

			const protectedFn = createAuthedServerFn({
				name: 'protected',
				handler: async () => 'secret',
			});

			// Test with missing user
			await expect(
				protectedFn({ ctx: { logger, db: mockDb } } as any)
			).rejects.toThrow(FnError);

			// Test with undefined user
			await expect(
				protectedFn({ ctx: { logger, db: mockDb, user: undefined } } as any)
			).rejects.toThrow('User is not authenticated');
		});
	});

	describe('Complex Nested Function Calls', () => {
		test('should handle nested function calls with proper context passing', async () => {
			const createAuthedServerFn = initCreateFn<AuthedServerFnCtx>([
				authMiddleware,
				authedErrorLoggingMiddleware,
			]);

			// Create individual functions
			const checkCredits = createAuthedServerFn({
				name: 'checkCredits',
				inputSchema: z.object({ cost: z.number() }),
				handler: async ({ input, ctx }) => {
					const credits = await ctx.db.credits.findFirst();
					return credits!.amount > input.cost;
				},
			});

			const sendSms = createAuthedServerFn({
				name: 'sendSms',
				handler: async () => {
					return { success: true };
				},
			});

			const sendWelcomeText = createAuthedServerFn({
				name: 'sendWelcomeText',
				handler: async ({ ctx }) => {
					const hasEnoughCredits = await checkCredits({
						ctx,
						input: { cost: 5 },
					});

					if (!hasEnoughCredits) {
						throw new FnError({
							code: 'FORBIDDEN',
							message: 'Insufficient credits',
						});
					}

					return await sendSms({ ctx });
				},
			});

			// Test successful flow
			const user = { id: 'user_with_credits' };
			const result = await sendWelcomeText({
				ctx: { logger, db: mockDb, user },
			});

			expect(typeof result).toBe('object');
			expect(result.success).toBe(true);

			// Verify the logger was called for all functions in the chain
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'sendWelcomeText'");
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'checkCredits'");
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'sendSms'");
		});

		test('should handle errors in nested calls', async () => {
			const createAuthedServerFn = initCreateFn<AuthedServerFnCtx>([
				authMiddleware,
				authedErrorLoggingMiddleware,
			]);

			const failingFn = createAuthedServerFn({
				name: 'failing',
				handler: async () => {
					throw new Error('Something went wrong');
				},
			});

			const callerFn = createAuthedServerFn({
				name: 'caller',
				handler: async ({ ctx }) => {
					return await failingFn({ ctx });
				},
			});

			await expect(
				callerFn({ ctx: { logger, db: mockDb, user: { id: 'test' } } })
			).rejects.toThrow('Something went wrong');

			expect(logger.error).toHaveBeenCalledWith(
				expect.any(Error),
				"Error in 'failing'"
			);
		});
	});

	describe('Array-style middleware composition', () => {
		test('should support array-style middleware initialization', async () => {
			const createServerFn = initCreateFn<ServerFnCtx>([
				loggingMiddleware,
				createTimingMiddleware<ServerFnCtx>(),
			]);

			expect(typeof createServerFn).toBe('function');

			const testFn = createServerFn({
				name: 'test',
				handler: async () => 'result',
			});

			const result = await testFn({ ctx: { logger, db: mockDb } });

			expect(typeof result).toBe('string');
			expect(result).toBe('result');
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'test'");
			expect(logger.info).toHaveBeenCalledWith("<- Finished 'test'");
			expect(logger.info).toHaveBeenCalledWith(
				expect.stringMatching(/'test' took \d+ms/)
			);
		});

		test('should handle empty middleware array', async () => {
			const createServerFn = initCreateFn<ServerFnCtx>([]);

			expect(typeof createServerFn).toBe('function');

			const simpleFn = createServerFn({
				name: 'simple',
				handler: async () => ({ message: 'no middleware' }),
			});

			const result = await simpleFn({ ctx: { logger, db: mockDb } });

			expect(typeof result).toBe('object');
			expect(result.message).toBe('no middleware');
		});

		test('should handle middleware without explicit array parameter', async () => {
			const createServerFn = initCreateFn<ServerFnCtx>();

			expect(typeof createServerFn).toBe('function');

			const defaultFn = createServerFn({
				name: 'default',
				handler: async () => 'default behavior',
			});

			const result = await defaultFn({ ctx: { logger, db: mockDb } });

			expect(typeof result).toBe('string');
			expect(result).toBe('default behavior');
		});
	});

	describe('SafeCall behavior', () => {
		test('should return proper result structure from safeCall', async () => {
			const createServerFn = initCreateFn<ServerFnCtx>([]);

			const testFn = createServerFn({
				name: 'safeTest',
				inputSchema: z.object({ value: z.string() }),
				handler: async ({ input }) => ({
					processed: input.value.toUpperCase(),
				}),
			});

			const result = await testFn.safeCall({
				input: { value: 'hello' },
				ctx: { logger, db: mockDb },
			});

			expect(typeof result).toBe('object');
			expect(result).toHaveProperty('data');
			expect(result).toHaveProperty('error');
			expect(result.error).toBeNull();
			expect(result.data).toEqual({ processed: 'HELLO' });
		});

		test('should handle validation errors in safeCall', async () => {
			const createServerFn = initCreateFn<ServerFnCtx>([]);

			const testFn = createServerFn({
				name: 'validationTest',
				inputSchema: z.object({ value: z.string() }),
				handler: async ({ input }) => input.value,
			});

			const result = await testFn.safeCall({
				input: { value: 123 } as any, // Invalid input
				ctx: { logger, db: mockDb },
			});

			expect(typeof result).toBe('object');
			expect(result.data).toBeNull();
			expect(result.error).toBeInstanceOf(FnError);
		});
	});
});
