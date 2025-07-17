import { describe, expect, expectTypeOf, test } from 'vitest';
import { baseFn } from '../src';
import { testData, PublicActionCtx, AuthedActionCtx } from './test-utils';
import { z } from 'zod';

describe('Action Middleware', () => {
	// Set up middleware for tests
	const publicAction = baseFn<PublicActionCtx>();

	const authedAction = baseFn<AuthedActionCtx>().use(async ({ ctx, next }) => {
		if (!ctx.user) {
			throw new Error('No user');
		}
		return await next();
	});

	describe('Basic middleware handling', () => {
		test('should be able to use with function notation', async () => {
			const createUser = publicAction
				// .meta({ key: 'createUser' })
				.input(testData.input)
				.output(testData.output)
				.mutation(async ({ input }) => {
					return testData.defaultOutput;
				});

			await expect(
				createUser.safeCall({ input: { name: 'test' }, ctx: {} })
			).resolves.not.toThrowError();
		});

		test('public action: should pass with no user', async () => {
			const createUser = publicAction
				.input(testData.input)
				.output(testData.output)
				.mutation(async ({ input }) => {
					return testData.defaultOutput;
				});

			await expect(
				createUser.safeCall({ input: { name: 'test' } })
			).resolves.not.toThrowError();
		});

		test('private action: should throw on no user; should pass with user', async () => {
			const createUser = authedAction
				.input(testData.input)
				.output(testData.output)
				.mutation(async ({ input }) => {
					return testData.defaultOutput;
				});

			await expect(async () => {
				await createUser({ input: { name: 'test' } });
			}).rejects.toThrowError();

			await expect(
				createUser({
					input: { name: 'test' },
					ctx: { user: { id: '1' } },
				})
			).resolves.not.toThrowError();
		});

		test('should infer outputs', async () => {
			const createUser = publicAction
				.input(testData.input)
				.mutation(async ({ input }) => {
					return testData.defaultOutput;
				});

			const { data: user, error } = await createUser.safeCall({ name: 'test' });
			expectTypeOf(user).toEqualTypeOf<typeof testData.defaultOutput | null>();
			if (error) return;
			expectTypeOf(user).toEqualTypeOf<typeof testData.defaultOutput>();
			expect(user).toStrictEqual(testData.defaultOutput);
		});
	});

	describe('Complex middleware contexts', () => {
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

		const publicAction = baseFn<PublicActionCtx>();
		const authedAction = baseFn<AuthedActionCtx>().use(
			async ({ ctx, next }) => {
				if (!ctx.user) {
					throw new Error('Unauthorized');
				}
				return next();
			}
		);

		const createUser = authedAction
			.input(testData.input)
			.mutation(async ({ input }) => {
				return testData.defaultOutput;
			});

		test('should be able to call safely', async () => {
			const user = await createUser({
				input: { name: 'test' },
				ctx: { user: { id: '1' }, db, headers: {} as any },
			});
			expect(user).toStrictEqual(testData.defaultOutput);
		});

		const getLatestTodo = authedAction.query(async () => {
			return 'hello' as const;
		});

		test('should be able to call safely - v2', async () => {
			const todo = await getLatestTodo({
				ctx: { user: { id: '1' }, db, headers: {} as any },
			});
			expect(todo).toStrictEqual('hello');

			expectTypeOf(todo).toEqualTypeOf<'hello'>();
		});
	});
});
