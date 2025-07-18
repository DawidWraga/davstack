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
import { expectTypeOf } from 'vitest';

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

	describe('Input and Context Type Inference', () => {
		test('should properly infer simple input types inside handler', () => {
			const createServerFn = initCreateFn<ServerFnCtx>([]);

			const simpleInputFn = createServerFn({
				name: 'simpleInput',
				inputSchema: z.object({
					title: z.string(),
					count: z.number(),
				}),
				handler: async ({ input, ctx }) => {
					// Type assertions for input
					expectTypeOf(input).toEqualTypeOf<{
						title: string;
						count: number;
					}>();
					expectTypeOf(input.title).toEqualTypeOf<string>();
					expectTypeOf(input.count).toEqualTypeOf<number>();

					// Type assertions for context
					expectTypeOf(ctx).toEqualTypeOf<ServerFnCtx>();

					return `${input.title}: ${input.count}`;
				},
			});

			// Verify function call signature
			expectTypeOf(simpleInputFn).parameter(0).toEqualTypeOf<{
				input: { title: string; count: number };
				ctx: ServerFnCtx;
			}>();
			expectTypeOf(simpleInputFn).returns.resolves.toEqualTypeOf<string>();
		});

		test('should properly infer complex nested input types', () => {
			const createServerFn = initCreateFn<ServerFnCtx>([]);

			const complexInputFn = createServerFn({
				name: 'complexInput',
				inputSchema: z.object({
					user: z.object({
						id: z.string(),
						profile: z.object({
							name: z.string(),
							age: z.number().optional(),
						}),
					}),
					metadata: z.record(z.any()).optional(),
					tags: z.array(z.string()),
				}),
				handler: async ({ input, ctx }) => {
					// Type assertions for nested input structure
					expectTypeOf(input).toEqualTypeOf<{
						user: {
							id: string;
							profile: {
								name: string;
								age?: number;
							};
						};
						metadata?: Record<string, any>;
						tags: string[];
					}>();

					expectTypeOf(input.user.id).toEqualTypeOf<string>();
					expectTypeOf(input.user.profile.name).toEqualTypeOf<string>();
					expectTypeOf(input.user.profile.age).toEqualTypeOf<
						number | undefined
					>();
					expectTypeOf(input.metadata).toEqualTypeOf<
						Record<string, any> | undefined
					>();
					expectTypeOf(input.tags).toEqualTypeOf<string[]>();

					// Context should remain unchanged
					expectTypeOf(ctx).toEqualTypeOf<ServerFnCtx>();

					return { success: true, userId: input.user.id };
				},
			});

			expectTypeOf(complexInputFn).parameter(0).toMatchTypeOf<{
				input: {
					user: {
						id: string;
						profile: {
							name: string;
							age?: number;
						};
					};
					metadata?: Record<string, any>;
					tags: string[];
				};
				ctx: ServerFnCtx;
			}>();
		});

		test('should handle no input schema correctly', () => {
			const createServerFn = initCreateFn<ServerFnCtx>([]);

			const noInputFn = createServerFn({
				name: 'noInput',
				handler: async ({ input, ctx }) => {
					// When no input schema is provided, input should be void
					expectTypeOf(input).toEqualTypeOf<void>();
					expectTypeOf(ctx).toEqualTypeOf<ServerFnCtx>();

					return 'no input needed';
				},
			});

			expectTypeOf(noInputFn).parameter(0).toEqualTypeOf<{
				input?: void;
				ctx: ServerFnCtx;
			}>();
		});

		test('should properly infer authed context types in handler', () => {
			const createAuthedServerFn = initCreateFn<AuthedServerFnCtx>([
				authMiddleware,
			]);

			const authedFn = createAuthedServerFn({
				name: 'authedFunction',
				inputSchema: z.object({
					action: z.enum(['create', 'update', 'delete']),
				}),
				handler: async ({ input, ctx }) => {
					// Input type should be properly inferred
					expectTypeOf(input).toEqualTypeOf<{
						action: 'create' | 'update' | 'delete';
					}>();
					expectTypeOf(input.action).toEqualTypeOf<
						'create' | 'update' | 'delete'
					>();

					// Context should be the authed version with required user
					expectTypeOf(ctx).toEqualTypeOf<AuthedServerFnCtx>();
					expectTypeOf(ctx.user).toEqualTypeOf<{ id: string }>();
					expectTypeOf(ctx.user.id).toEqualTypeOf<string>();

					return { action: input.action, userId: ctx.user.id };
				},
			});

			expectTypeOf(authedFn).parameter(0).toEqualTypeOf<{
				input: { action: 'create' | 'update' | 'delete' };
				ctx: AuthedServerFnCtx;
			}>();
		});

		test('should properly infer union and literal types', () => {
			const createServerFn = initCreateFn<ServerFnCtx>([]);

			const unionTypeFn = createServerFn({
				name: 'unionTypes',
				inputSchema: z.object({
					status: z.union([
						z.literal('active'),
						z.literal('inactive'),
						z.literal('pending'),
					]),
					priority: z.enum(['low', 'medium', 'high']),
					value: z.union([z.string(), z.number()]),
				}),
				handler: async ({ input, ctx }) => {
					expectTypeOf(input).toEqualTypeOf<{
						status: 'active' | 'inactive' | 'pending';
						priority: 'low' | 'medium' | 'high';
						value: string | number;
					}>();

					expectTypeOf(input.status).toEqualTypeOf<
						'active' | 'inactive' | 'pending'
					>();
					expectTypeOf(input.priority).toEqualTypeOf<
						'low' | 'medium' | 'high'
					>();
					expectTypeOf(input.value).toEqualTypeOf<string | number>();

					return {
						processedStatus: input.status,
						processedPriority: input.priority,
						processedValue: input.value,
					};
				},
			});

			expectTypeOf(unionTypeFn).returns.resolves.toEqualTypeOf<{
				processedStatus: 'active' | 'inactive' | 'pending';
				processedPriority: 'low' | 'medium' | 'high';
				processedValue: string | number;
			}>();
		});

		test('should properly infer types through middleware chain', () => {
			const createAuthedServerFn = initCreateFn<AuthedServerFnCtx>([
				authMiddleware,
				authedLoggingMiddleware,
			]);

			const middlewareChainFn = createAuthedServerFn({
				name: 'middlewareChain',
				inputSchema: z.object({
					data: z.object({
						items: z.array(
							z.object({
								id: z.string(),
								value: z.number(),
							})
						),
					}),
				}),
				handler: async ({ input, ctx }) => {
					// Even with middleware chain, types should be preserved
					expectTypeOf(input).toEqualTypeOf<{
						data: {
							items: Array<{
								id: string;
								value: number;
							}>;
						};
					}>();

					expectTypeOf(input.data.items).toEqualTypeOf<
						Array<{
							id: string;
							value: number;
						}>
					>();

					// Context should still be the correct authed type
					expectTypeOf(ctx).toEqualTypeOf<AuthedServerFnCtx>();
					expectTypeOf(ctx.user.id).toEqualTypeOf<string>();

					return input.data.items.map((item) => ({
						...item,
						processed: true,
					}));
				},
			});

			expectTypeOf(middlewareChainFn).returns.resolves.toEqualTypeOf<
				Array<{
					id: string;
					value: number;
					processed: boolean;
				}>
			>();
		});

		test('should handle optional input fields correctly', () => {
			const createServerFn = initCreateFn<ServerFnCtx>([]);

			const optionalFieldsFn = createServerFn({
				name: 'optionalFields',
				inputSchema: z.object({
					required: z.string(),
					optional: z.string().optional(),
					withDefault: z.string().default('default-value'),
					nullable: z.string().nullable(),
				}),
				handler: async ({ input, ctx }) => {
					expectTypeOf(input).toEqualTypeOf<{
						required: string;
						optional?: string;
						withDefault: string;
						nullable: string | null;
					}>();

					expectTypeOf(input.required).toEqualTypeOf<string>();
					expectTypeOf(input.optional).toEqualTypeOf<string | undefined>();
					expectTypeOf(input.withDefault).toEqualTypeOf<string>();
					expectTypeOf(input.nullable).toEqualTypeOf<string | null>();

					return {
						required: input.required,
						hasOptional: input.optional !== undefined,
						withDefault: input.withDefault,
						isNullable: input.nullable === null,
					};
				},
			});

			expectTypeOf(optionalFieldsFn).parameter(0).toMatchTypeOf<{
				input: {
					required: string;
					optional?: string;
					withDefault?: string; // Zod default makes this optional in input
					nullable: string | null;
				};
				ctx: ServerFnCtx;
			}>();
		});

		test('should properly type safeCall results', async () => {
			const createServerFn = initCreateFn<ServerFnCtx>([]);

			const typedFn = createServerFn({
				name: 'typedSafeCall',
				inputSchema: z.object({ value: z.number() }),
				handler: async ({ input }) => ({
					doubled: input.value * 2,
					original: input.value,
				}),
			});

			const result = await typedFn.safeCall({
				input: { value: 42 },
				ctx: { logger: createMockLogger(), db: mockDb },
			});

			expectTypeOf(result).toEqualTypeOf<{
				data: { doubled: number; original: number } | null;
				error: FnError | Error | null;
			}>();

			if (result.error === null) {
				expectTypeOf(result.data).toEqualTypeOf<{
					doubled: number;
					original: number;
				} | null>();
			}
		});
	});
});
