/* eslint-disable no-unused-vars */
import { z } from 'zod';

import { silentTestConsoleError, silentTestConsoleLog } from './test-utils';

import { describe, expect, expectTypeOf, test } from 'vitest';
import { action } from '../src';
const d = {
	input: z.object({
		name: z.string(),
	}),
	output: z.object({
		id: z.string(),
		email: z.string(),
	}),
	defaultOutput: {
		id: '1',
		email: '',
	},
	ctx: {
		user: { id: '1' },
		db: (() => {}) as any,
		sb: (() => {}) as any,
	},
};

type ApiContext = {
	user?: { id: string };
};

const publicAction = action<ApiContext>();

const authedAction = action<Required<ApiContext>>().use(
	async ({ ctx, next }) => {
		if (!ctx.user) {
			throw new Error('No user');
		}
		return await next();
	}
);

describe('Action', () => {
	expect(false).toBe(false);
	describe('Schema definitions', () => {
		const createUser = action()
			.input(d.input)
			.output(d.output)
			.mutation(async ({ input }) => {
				return d.defaultOutput;
			});

		test('should have input schema', () => {
			const inputSchema = createUser.inputSchema;
			expect(inputSchema).toBeDefined();
			expect(inputSchema.shape).toStrictEqual(d.input.shape);
		});

		test('should have output schema', () => {
			const outputSchema = createUser.outputSchema;
			expect(outputSchema).toBeDefined();
			expect(outputSchema.shape).toStrictEqual(d.output.shape);
		});
	});

	describe('Safe calls', () => {
		const createUser = action()
			.input(d.input)
			.output(d.output)
			.mutation(async ({ input }) => {
				return d.defaultOutput;
			});

		test('should be able to call safely', async () => {
			const user = await createUser({ name: 'test' });
			expect(user).toStrictEqual(d.defaultOutput);
		});

		test('should parse the input', async () => {
			await expect(async () => {
				// @ts-expect-error
				await createUser({ name: 123 });
			}).rejects.toThrowError();
		});

		test('should parse the output', async () => {
			const differentCreateUser = action()
				.input(z.any())
				.output(z.string())
				.mutation(async ({ input }) => {
					return input.name;
				});

			silentTestConsoleError(async () => {
				await expect(async () => {
					await differentCreateUser({ name: 555 });
				}).rejects.toThrowError();
			});
		});
	});

	describe('Raw calls', () => {
		const createUser = action()
			.input(d.input)
			.output(z.object({ input: d.input, ctx: z.any() }))
			.mutation(async ({ input, ctx }) => {
				return {
					input,
					ctx,
				};
			});

		test('should access input correctly', async () => {
			const result = await createUser.raw(d.ctx, { name: 'test' });
			expect(result.input).toStrictEqual({ name: 'test' });
		});

		test('should access ctx correctly', async () => {
			const createUser = action()
				.input({ name: z.string() })
				.output(z.boolean())
				.mutation(async ({ input }) => {
					return input.name === 'test123';
				});

			const result = await createUser.raw(d.ctx, { name: 'test123' });
			expect(result).toBe(true);

			const result2 = await createUser.raw(d.ctx, { name: 'test' });
			expect(result2).toBe(false);

			// @ts-expect-error
			expect(() => createUser.raw(d.ctx, { name: 1 })).rejects.toThrowError();
			// @ts-expect-error
			expect(() => createUser.raw(d.ctx)).rejects.toThrowError();

			const inputSchema = createUser.inputSchema;
		});

		test('should default to zod object if object is passed', async () => {
			const result = await createUser.raw(d.ctx, { name: 'test' });
			expect(result.input).toStrictEqual({ name: 'test' });
		});
	});

	describe('Should handle no input', () => {
		const createUser = action()
			.output(d.output)
			.mutation(async () => {
				return d.defaultOutput;
			});

		test('input schema should not be defined', async () => {
			expect(createUser.inputSchema).toBeUndefined();
		});

		test('should be able to call safely', async () => {
			const user = await createUser();
			expect(user).toStrictEqual(d.defaultOutput);
		});
	});

	describe('Should handle no output', () => {
		const createUser = action()
			.input(d.input)
			.mutation(async ({ input }) => {
				return d.defaultOutput;
			});

		test('output schema not be defined', async () => {
			expect(createUser.outputSchema).toBeUndefined();
		});

		test('should be able to call safely', async () => {
			const user = await createUser({ name: 'test' });
			expect(user).toStrictEqual(d.defaultOutput);
		});

		// test that the type is inferred correctly
		test('should infer the type correctly', async () => {
			const user = await createUser({ name: 'test' });
			// not sure how to test the type here
		});
	});

	describe('should support query', () => {
		const getUser = action()
			.input(z.object({ id: z.string() }))
			.output(z.string())
			.query(async ({ input }) => {
				return 'id=' + input.id;
			});

		test('should be able to call safely', async () => {
			const user = await getUser({ id: '1' });
			expect(user).toStrictEqual('id=1');
		});
	});

	describe('Should handle middleware correctly', () => {
		test('public action: should pass with no user', async () => {
			const createUser = publicAction
				.input(d.input)
				.output(d.output)
				.mutation(async ({ input }) => {
					return d.defaultOutput;
				});

			await expect(createUser({ name: 'test' })).resolves.not.toThrowError();
		});

		test('private action: should throw on no user; should pass with user', async () => {
			const createUser = authedAction
				.input(d.input)
				.output(d.output)
				.mutation(async ({ input }) => {
					return d.defaultOutput;
				});

			await expect(async () => {
				// @ts-expect-error
				await createUser({ name: 'test' });
			}).rejects.toThrowError();

			await expect(
				createUser.raw({ user: { id: '1' } }, { name: 'test' })
			).resolves.not.toThrowError();
		});

		test('should infer outputs', async () => {
			const createUser = publicAction
				.input(d.input)
				.mutation(async ({ input }) => {
					return d.defaultOutput;
				});

			const user = await createUser({ name: 'test' });
			expectTypeOf(user).toEqualTypeOf(d.defaultOutput);
			expect(user).toStrictEqual(d.defaultOutput);
		});
	});

	describe('Should handle creating context from complex middleware types', async () => {
		// from next auth
		type User = {
			id: string;
			name?: string | null;
			email?: string | null;
			image?: string | null;
		};

		const getServerAuthSession = async () => {
			return undefined as { user: User } | undefined;
		};

		const db = {} as any;
		type Headers = Record<string, string>;

		const createActionContext = async (opts: { headers: Headers }) => {
			const session = await getServerAuthSession();

			const user = session?.user;

			return {
				db,
				user,
				...opts,
			};
		};

		type WithUser<T> = Omit<T, 'user'> & { user: { id: string } };

		type PublicActionCtx = Awaited<ReturnType<typeof createActionContext>>;
		type AuthedActionCtx = WithUser<PublicActionCtx>;

		const publicAction = action<PublicActionCtx>();
		const authedAction = action<AuthedActionCtx>().use(
			async ({ ctx, next }) => {
				if (!ctx.user) {
					throw new Error('Unauthorized');
				}
				return next();
			}
		);

		const createUser = authedAction
			.input(d.input)
			.mutation(async ({ input }) => {
				return d.defaultOutput;
			});

		test('should be able to call safely', async () => {
			const user = await createUser.raw(
				{ user: { id: '1' }, db, headers: {} as any },
				{ name: 'test' }
			);
			expect(user).toStrictEqual(d.defaultOutput);
		});

		const getLatestTodo = authedAction.query(async () => {
			return 'hello' as const;
		});

		test('should be able to call safely - v2', async () => {
			const todo = await getLatestTodo.raw({
				user: { id: '1' },
				db,
				headers: {} as any,
			});
			expect(todo).toStrictEqual('hello');

			expectTypeOf(todo).toEqualTypeOf<'hello'>();
		});
	});
});
