import { z } from 'zod';

import { silentTestConsoleError, silentTestConsoleLog } from './test-utils';

import { describe, expect, test } from 'vitest';
import { service } from '../src';
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

describe('Service', () => {
	describe('Schema definitions', () => {
		const createUser = service()
			.input(d.input)
			.output(d.output)
			.mutation(async ({ input, ctx }) => {
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

	describe('Direct calls', () => {
		const createUser = service()
			.input(d.input)
			.output(d.output)
			.mutation(async ({ input, ctx }) => {
				return d.defaultOutput;
			});

		test('should be able to call directly', async () => {
			const user = await createUser(d.ctx, { name: 'test' });

			expect(user).toStrictEqual(d.defaultOutput);
		});

		test('should parse the input', async () => {
			await expect(async () => {
				// @ts-expect-error
				await createUser(d.ctx, { name: 123 });
			}).rejects.toThrowError();
		});

		test('should parse the output', async () => {
			const differentCreateUser = service()
				.input(z.any())
				.output(z.string())
				.mutation(async ({ input, ctx }) => {
					return input.name;
				});

			silentTestConsoleError(async () => {
				await expect(async () => {
					await differentCreateUser(d.ctx, { name: 555 });
				}).rejects.toThrowError();
			});
		});
	});

	describe('Should handle input and ctx', () => {
		const createUser = service()
			.input(d.input)
			.output(z.object({ input: d.input, ctx: z.any() }))
			.mutation(async ({ input, ctx }) => {
				return {
					input,
					ctx,
				};
			});

		test('should access input correctly', async () => {
			const result = await createUser(d.ctx, { name: 'test' });
			expect(result.input).toStrictEqual({ name: 'test' });
		});

		test('should access ctx correctly', async () => {
			const createUser = service()
				.input({ name: z.string() })
				.output(z.boolean())
				.mutation(async ({ input, ctx }) => {
					return input.name === 'test123';
				});

			const result = await createUser(d.ctx, { name: 'test123' });
			expect(result).toBe(true);

			const result2 = await createUser(d.ctx, { name: 'test' });
			expect(result2).toBe(false);

			// @ts-expect-error
			expect(() => createUser(d.ctx, { name: 1 })).rejects.toThrowError();
			// @ts-expect-error
			expect(() => createUser(d.ctx)).rejects.toThrowError();

			// here we are testing the type inference
			// it does seem slighly different from just using z.object({ name: z.string() }
			// however it still works as expected and is more concise, so we will keep it
			const inputSchema = createUser.inputSchema;
		});

		test('should default to zod object if object is passed', async () => {
			const result = await createUser(d.ctx, { name: 'test' });
			expect(result.input).toStrictEqual({ name: 'test' });
		});
	});

	describe('Should handle no input', () => {
		const createUser = service()
			.output(d.output)
			.mutation(async () => {
				return d.defaultOutput;
			});

		test('input schema should not be defined', async () => {
			expect(createUser.inputSchema).toBeUndefined();
		});

		test('should be able to call directly', async () => {
			const user = await createUser(d.ctx);
			expect(user).toStrictEqual(d.defaultOutput);
		});
	});

	describe('Should handle no output', () => {
		const createUser = service()
			.input(d.input)
			.mutation(async ({ input, ctx }) => {
				return d.defaultOutput;
			});

		test('output schema not be defined', async () => {
			expect(createUser.outputSchema).toBeUndefined();
		});

		test('should be able to call directly', async () => {
			const user = await createUser(d.ctx, { name: 'test' });
			expect(user).toStrictEqual(d.defaultOutput);
		});

		// test that the type is inferred correctly
		test('should infer the type correctly', async () => {
			const user = await createUser(d.ctx, { name: 'test' });
			// not sure how to test the type here
		});
	});

	describe('should support query', () => {
		const getUser = service()
			.input(z.object({ id: z.string() }))
			.output(z.string())
			.query(async ({ input, ctx }) => {
				return 'id=' + input.id;
			});

		test('should be able to call directly', async () => {
			const user = await getUser(d.ctx, { id: '1' });
			expect(user).toStrictEqual('id=1');
		});
	});

	describe('Should handle access control correctly', () => {
		test('Should be able to acces the access level', async () => {
			const createUser = service()
				.access('public')
				.input(d.input)
				.output(d.output)
				.mutation(async ({ input, ctx }) => {
					return d.defaultOutput;
				});
			expect(createUser.accessLevel).toBe('public');
		});

		test('public procedure: should pass with no user', async () => {
			const createUser = service()
				.access('public')
				.input(d.input)
				.output(d.output)
				.mutation(async ({ input, ctx }) => {
					return d.defaultOutput;
				});

			await expect(
				createUser({ user: { id: '' } }, { name: 'test' })
			).resolves.not.toThrowError();
		});

		test('authed procedure: should throw on no user; should pass with user', async () => {
			const createUser = service()
				.access('authed')
				.input(d.input)
				.output(d.output)
				.mutation(async ({ input, ctx }) => {
					return d.defaultOutput;
				});

			await expect(async () => {
				await createUser({ user: { id: '' } }, { name: 'test' });
			}).rejects.toThrowError();

			await expect(
				createUser({ user: { id: '1' } }, { name: 'test' })
			).resolves.not.toThrowError();
		});
	});
});
