import { beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { initCreateFn, createMiddleware, FnError } from '../src';
import {
	AuthedServerFnCtx,
	createMockLogger,
	mockDb,
	ServerFnCtx,
} from './test-utils';

describe('Clean Composition API', () => {
	const logger = createMockLogger();
	beforeEach(() => logger.cleanup());

	describe('Middleware Creation', () => {
		test('should create properly typed logging middleware', () => {
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

			// Test that middleware is properly typed
			expect(typeof loggingMiddleware).toBe('function');
		});

		test('should create properly typed auth middleware', () => {
			const authMiddleware = createMiddleware<AuthedServerFnCtx>(
				(def, handler) => {
					return async (opts) => {
						if (!opts.ctx.user?.id) {
							throw new FnError({
								code: 'UNAUTHORIZED',
								message: 'User is not authenticated.',
							});
						}
						return handler(opts);
					};
				}
			);

			expect(typeof authMiddleware).toBe('function');
		});
	});

	describe('Function Factory Creation', () => {
		test('should create clean public server function factory', async () => {
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

			const createServerFn = initCreateFn<ServerFnCtx>().use(loggingMiddleware);

			const getPublicData = createServerFn({
				name: 'getPublicData',
				handler: async ({ ctx }) => {
					return `Public data for ${ctx.user?.id || 'anonymous'}`;
				},
			});

			const result = await getPublicData({
				ctx: { logger, db: mockDb, user: { id: 'user_123' } },
			});

			expect(result).toBe('Public data for user_123');
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'getPublicData'");
			expect(logger.info).toHaveBeenCalledWith("<- Finished 'getPublicData'");
		});

		test('should create clean authed server function factory', async () => {
			const authMiddleware = createMiddleware<AuthedServerFnCtx>(
				(def, handler) => {
					return async (opts) => {
						if (!opts.ctx.user?.id) {
							throw new FnError({
								code: 'UNAUTHORIZED',
								message: 'User is not authenticated.',
							});
						}
						return handler(opts);
					};
				}
			);

			const loggingMiddleware = createMiddleware<AuthedServerFnCtx>(
				(def, handler) => {
					return async (opts) => {
						opts.ctx.logger.info(`-> Calling '${def.name}'`);
						const result = await handler(opts);
						opts.ctx.logger.info(`<- Finished '${def.name}'`);
						return result;
					};
				}
			);

			const createAuthedServerFn = initCreateFn<AuthedServerFnCtx>()
				.use(authMiddleware)
				.use(loggingMiddleware);

			const getSecretData = createAuthedServerFn({
				name: 'getSecretData',
				handler: async ({ ctx }) => {
					return `Secret data for ${ctx.user.id}`;
				},
			});

			// Should succeed with proper user
			const result = await getSecretData({
				ctx: { logger, db: mockDb, user: { id: 'user_123' } },
			});

			expect(result).toBe('Secret data for user_123');

			// Should fail without user - but TypeScript should catch this at compile time
			// since AuthedServerFnCtx requires user to be present
		});
	});

	describe('Complex Nested Function Calls', () => {
		test('should handle nested function calls with proper context passing', async () => {
			const loggingMiddleware = createMiddleware<AuthedServerFnCtx>(
				(def, handler) => {
					return async (opts) => {
						try {
							opts.ctx.logger.info(`-> Calling '${def.name}'`);
							const result = await handler(opts);
							opts.ctx.logger.info(`<- Finished '${def.name}'`);
							return result;
						} catch (error) {
							opts.ctx.logger.error(error, `Error in '${def.name}'`);
							throw error;
						}
					};
				}
			);

			const authMiddleware = createMiddleware<AuthedServerFnCtx>(
				(def, handler) => {
					return async (opts) => {
						if (!opts.ctx.user?.id) {
							throw new FnError({
								code: 'UNAUTHORIZED',
								message: 'User is not authenticated.',
							});
						}
						return handler(opts);
					};
				}
			);

			const createAuthedServerFn = initCreateFn<AuthedServerFnCtx>()
				.use(authMiddleware)
				.use(loggingMiddleware);

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

			const user = { id: 'user_with_credits' };
			const result = await sendWelcomeText({
				ctx: { logger, db: mockDb, user },
			});

			expect(result.success).toBe(true);

			// Verify the logger was called for all functions in the chain
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'sendWelcomeText'");
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'checkCredits'");
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'sendSms'");
		});
	});

	describe('Array-style middleware composition', () => {
		test('should support array-style middleware initialization', async () => {
			const middleware1 = createMiddleware<ServerFnCtx>((def, handler) => {
				return async (opts) => {
					opts.ctx.logger.info('middleware1');
					return handler(opts);
				};
			});

			const middleware2 = createMiddleware<ServerFnCtx>((def, handler) => {
				return async (opts) => {
					opts.ctx.logger.info('middleware2');
					return handler(opts);
				};
			});

			const createServerFn = initCreateFn<ServerFnCtx>([
				middleware1,
				middleware2,
			]);

			const testFn = createServerFn({
				name: 'test',
				handler: async () => 'result',
			});

			await testFn({ ctx: { logger, db: mockDb } });

			expect(logger.info).toHaveBeenCalledWith('middleware1');
			expect(logger.info).toHaveBeenCalledWith('middleware2');
		});
	});
});
