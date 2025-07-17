import { beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createFn, FnDef, FnError, FnHandler } from '../src'; // Assuming all are exported from main index
import { pipe } from '../src/pipe';
import {
	AuthedServerFnCtx,
	createMockLogger,
	mockDb,
	ServerFnCtx,
} from './test-utils';

// =================================================================
// 2. Mock Server Function Implementations
// (This mirrors the `create-server-fn.ts` file from your design)
// =================================================================

// A mock logging middleware that now also handles error logging
function withLogging<THandler extends FnHandler<any, any, any>>(
	def: FnDef<any, any, any, any>,
	handler: THandler
): THandler {
	const wrappedHandler = async (opts: any) => {
		try {
			opts.ctx?.logger?.info(`-> Calling '${def.name}'`);
			const result = await handler(opts);
			opts.ctx?.logger?.info(`<- Finished '${def.name}'`);
			return result;
		} catch (error) {
			// Per your design doc, log the original error before it's re-thrown
			opts.ctx?.logger?.error(error, `Error in '${def.name}'`);
			throw error; // Re-throw the error to be handled by the next layer
		}
	};
	return wrappedHandler as THandler;
}

// A mock auth middleware for testing
function withAuth<THandler extends FnHandler<any, any, any>>(
	_def: FnDef<any, any, any, any>,
	handler: THandler
): THandler {
	const wrappedHandler = (opts: any) => {
		if (!opts.ctx?.user?.id) {
			throw new FnError({
				code: 'UNAUTHORIZED',
				message: 'User is not authenticated.',
			});
		}
		return handler(opts);
	};
	return wrappedHandler as THandler;
}

// REFACTORED: These now use a single generic and cleaner naming
type AnyFnDef = FnDef<any, any, any, any>;

const createPublicServerFn = <TFnDef extends AnyFnDef>(def: TFnDef) => {
	const handler = pipe(def.handler, (h) => withLogging(def, h));
	return createFn<ServerFnCtx>({ ...def, handler });
};

const createAuthedServerFn = <TFnDef extends AnyFnDef>(def: TFnDef) => {
	const handler = pipe(
		def.handler,
		(h) => withAuth(def, h),
		(h) => withLogging(def, h)
	);
	return createFn<AuthedServerFnCtx>({ ...def, handler });
};

// =================================================================
// 3. The Comprehensive Test Suite
// =================================================================

describe('Composition and Middleware', () => {
	const logger = createMockLogger();
	beforeEach(() => logger.cleanup());

	describe('Authentication Middleware', () => {
		const getSecretData = createAuthedServerFn({
			name: 'getSecretData',
			handler: async ({ ctx }) => `Secret data for ${ctx.user.id}`,
		});

		test('Authed Fn: should throw UNAUTHORIZED if user is missing', async () => {
			const promise = getSecretData({
				ctx: { logger, db: mockDb }, // No user
			});

			await expect(promise).rejects.toThrow(FnError);
			await expect(promise).rejects.toHaveProperty('code', 'UNAUTHORIZED');
		});

		test('Authed Fn: should succeed if user is present', async () => {
			const result = await getSecretData({
				ctx: { logger, db: mockDb, user: { id: 'user_123' } },
			});
			expect(result).toBe('Secret data for user_123');
		});

		test('Public Fn: should succeed even if user is missing', async () => {
			const getPublicData = createPublicServerFn({
				name: 'getPublicData',
				handler: async () => 'Public data',
			});
			const promise = getPublicData({
				ctx: { logger, db: mockDb }, // No user
			});
			await expect(promise).resolves.toBe('Public data');
		});
	});

	describe('Logging and Error Preservation', () => {
		test('should log start and end of a successful call', async () => {
			const doWork = createPublicServerFn({
				name: 'doWork',
				handler: async () => 'done',
			});
			await doWork({ ctx: { logger, db: mockDb } });
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'doWork'");
			expect(logger.info).toHaveBeenCalledWith("<- Finished 'doWork'");
		});

		test('should preserve the original error in the logger', async () => {
			const originalError = new Error('Database connection failed!');

			const faultyFn = createPublicServerFn({
				name: 'faultyFn',
				handler: async () => {
					throw originalError;
				},
			});

			// The function will ultimately throw an enhanced FnError
			await expect(faultyFn({ ctx: { logger, db: mockDb } })).rejects.toThrow(
				FnError
			);

			// CRITICAL TEST: Verify the logger received the *original* error object
			// from the `withLogging` middleware's catch block.
			expect(logger.error).toHaveBeenCalledTimes(1);
			expect(logger.error).toHaveBeenCalledWith(
				originalError, // Asserting the original error object was passed
				"Error in 'faultyFn'"
			);
		});
	});

	describe('Nested Function Calls', () => {
		// Mimics the `sendWelcomeText` example
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
					ctx, // Pass context down
					input: { cost: 5 },
				});

				if (!hasEnoughCredits) {
					throw new FnError({
						code: 'FORBIDDEN',
						message: 'Insufficient credits',
					});
				}

				return await sendSms({ ctx }); // Pass context down again
			},
		});

		test('should pass context correctly to nested functions', async () => {
			const user = { id: 'user_with_credits' };
			const result = await sendWelcomeText({
				ctx: { logger, db: mockDb, user },
			});

			expect(result.success).toBe(true);

			// Verify the logger was called for all functions in the chain
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'sendWelcomeText'");
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'checkCredits'");
			expect(logger.info).toHaveBeenCalledWith("-> Calling 'sendSms'");
			expect(logger.info).toHaveBeenCalledWith("<- Finished 'sendSms'");
			expect(logger.info).toHaveBeenCalledWith("<- Finished 'sendWelcomeText'");
		});
	});
});
