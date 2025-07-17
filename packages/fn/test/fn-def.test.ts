import { describe, expect, expectTypeOf, test } from 'vitest';
import { baseFn, FnError } from '../src';
import { testData } from './test-utils';
import { z } from 'zod';

describe('Fn Definition and Calls', () => {
	expect(false).toBe(false);
	describe('Schema definitions', () => {
		const createUser = baseFn()
			.input(testData.input)
			.output(testData.output)
			.mutation(async ({ input }) => {
				return testData.defaultOutput;
			});

		test('should have input schema', () => {
			const inputSchema = createUser.inputSchema;
			expect(inputSchema).toBeDefined();
			expect(inputSchema.shape).toStrictEqual(testData.input.shape);
		});

		test('should have output schema', () => {
			const outputSchema = createUser.outputSchema;
			expect(outputSchema).toBeDefined();
			expect(outputSchema.shape).toStrictEqual(testData.output.shape);
		});
	});

	describe('Safe calls', () => {
		const createUser = baseFn()
			.input(testData.input)
			.output(testData.output)
			.mutation(async ({ input }) => {
				return testData.defaultOutput;
			});

		test('should be able to call safely', async () => {
			const result = await createUser.safeCall({ input: { name: 'test' } });
			expect(result.data).toStrictEqual(testData.defaultOutput);
		});

		test('should parse the input', async () => {
			// @ts-expect-error
			const result = await createUser.safeCall({ input: { name: 123 } });
			expect(result.error).toBeDefined();
		});

		test('should parse the output', async () => {
			const differentCreateUser = baseFn()
				.input(z.any())
				.output(z.string())
				.mutation(async ({ input }) => {
					return input.name;
				});

			const result = await differentCreateUser.safeCall({
				input: { name: 555 },
			});
			expect(result.error).toBeDefined();
		});
	});

	describe('Should handle no input', () => {
		const createUser = baseFn().mutation(async () => {
			return testData.defaultOutput;
		});

		test('input schema should not be defined', () => {
			expect(createUser.inputSchema).toBeUndefined();
		});

		test('should be able to call safely', async () => {
			const result = await createUser.safeCall({});
			expect(result.data).toStrictEqual(testData.defaultOutput);
		});
	});

	describe('Should handle no output', () => {
		const createUser = baseFn()
			.input(testData.input)
			.mutation(async ({ input }) => {
				return testData.defaultOutput;
			});

		test('output schema not be defined', () => {
			expect(createUser.outputSchema).toBeUndefined();
		});

		test('should be able to call safely', async () => {
			const result = await createUser.safeCall({ input: { name: 'test' } });
			expect(result.data).toStrictEqual(testData.defaultOutput);
		});

		test('should infer the type correctly', () => {
			expectTypeOf(createUser).toBeFunction();
		});
	});

	describe('should support query', () => {
		const getUser = baseFn()
			.input(z.object({ id: z.string() }))
			.query(async ({ input }) => {
				return `id=${input.id}`;
			});

		test('should be able to call safely', async () => {
			const result = await getUser.safeCall({ input: { id: '1' } });
			expect(result.data).toStrictEqual('id=1');
		});
	});

	describe('Context passing', () => {
		type CustomCtx = { user: { id: string; role: string } };
		const customContext = { user: { id: '456', role: 'user' } };
		const userWithContext = baseFn<CustomCtx>()
			.input(testData.input)
			.output(z.object({ userName: z.string(), userContext: z.any() }))
			.mutation(async ({ input, ctx }) => {
				return {
					userName: input.name,
					userContext: ctx,
				};
			});

		test('should access context with safeCall', async () => {
			const customContext = { user: { id: '123', role: 'admin' } };
			const result = await userWithContext.safeCall({
				input: { name: 'test' },
				ctx: customContext,
			});

			expect(result.data).toBeDefined();
			expect(result.data?.userName).toBe('test');
			expect(result.data?.userContext).toStrictEqual(customContext);
		});

		test('should access context with direct call', async () => {
			const result = await userWithContext({
				input: { name: 'direct' },
				ctx: customContext,
			});

			expect(result.userName).toBe('direct');
			expect(result.userContext).toStrictEqual(customContext);
		});

		test('should work with empty context in safeCall', async () => {
			const result = await userWithContext.safeCall({
				input: { name: 'no-context' },
				ctx: customContext,
			});

			expect(result.data).toBeDefined();
			expect(result.data?.userName).toBe('no-context');
			expect(result.data?.userContext).toStrictEqual(customContext);
		});

		test('should work with empty context in direct call', async () => {
			const result = await userWithContext({
				input: { name: 'direct-no-ctx' },
				ctx: customContext,
			});

			expect(result.userName).toBe('direct-no-ctx');
			expect(result.userContext).toStrictEqual(customContext);
		});

		test('should work with null context in safeCall', async () => {
			const result = await userWithContext.safeCall({
				input: { name: 'null-context' },
				ctx: customContext,
			});

			expect(result.data).toBeDefined();
			expect(result.data?.userName).toBe('null-context');
			expect(result.data?.userContext).toStrictEqual(customContext);
		});

		test('should work with null context in direct call', async () => {
			const result = await userWithContext({
				input: { name: 'direct-null-ctx' },
				ctx: customContext,
			});

			expect(result.userName).toBe('direct-null-ctx');
			expect(result.userContext).toStrictEqual(customContext);
		});

		test('should work with complex context object in direct call', async () => {
			// this test doesn't really make sense
			const complexContext = {
				user: { id: '789', permissions: ['read', 'write'] },
				request: { ip: '127.0.0.1', userAgent: 'test-browser' },
				meta: { timestamp: Date.now() },
			};

			const result = await userWithContext({
				input: { name: 'complex-ctx' },
				ctx: complexContext as unknown as CustomCtx,
			});

			expect(result.userName).toBe('complex-ctx');
			expect(result.userContext).toStrictEqual(complexContext);
		});
	});

	describe('Type inference', () => {
		test('should infer input and output types correctly', async () => {
			const createUser = baseFn()
				.input(testData.input)
				.output(testData.output)
				.mutation(async ({ input }) => {
					return testData.defaultOutput;
				});

			// Test type inference for safeCall
			const safeResult = await createUser.safeCall({ input: { name: 'test' } });
			if (safeResult.error) return;
			expectTypeOf(safeResult.data).toMatchTypeOf<{
				id: string;
				email: string;
			}>();
			expectTypeOf(safeResult.data.id).toBeString();
			expectTypeOf(safeResult.data.email).toBeString();

			// Test type inference for default call
			const defaultResult = await createUser({ input: { name: 'test' } });
			expectTypeOf(defaultResult).toMatchTypeOf<{
				id: string;
				email: string;
			}>();
			expectTypeOf(defaultResult.id).toBeString();
			expectTypeOf(defaultResult.email).toBeString();
		});

		test('should infer complex input types', async () => {
			const complexAction = baseFn()
				.input(
					z.object({
						user: z.object({
							name: z.string(),
							age: z.number(),
							roles: z.array(z.string()),
						}),
						options: z
							.object({
								createProfile: z.boolean().optional(),
								notifyAdmin: z.boolean().optional(),
							})
							.optional(),
					})
				)
				.mutation(async ({ input }) => {
					return { success: true, userId: '123' };
				});

			// Test input type inference
			const input = {
				user: { name: 'John', age: 30, roles: ['user'] },
				options: { createProfile: true },
			};

			expectTypeOf<Parameters<typeof complexAction>[0]>().toMatchTypeOf<{
				input: {
					user: { name: string; age: number; roles: string[] };
					options?: { createProfile?: boolean; notifyAdmin?: boolean };
				};
				ctx?: unknown;
				preventLogging?: boolean;
			}>();

			// Make sure the compiler knows these are valid
			await complexAction({
				input: {
					user: { name: 'Test', age: 25, roles: [] },
					options: { createProfile: true },
				},
			});
			await complexAction({
				input: {
					user: { name: 'Test', age: 25, roles: [] },
				},
			});
		});

		test('should infer return types with conditional outputs', async () => {
			type UserResult =
				| { type: 'success'; user: { id: string; name: string } }
				| { type: 'error'; message: string };

			const getUserOrError = baseFn()
				.input(z.object({ id: z.string() }))
				.output(
					z.discriminatedUnion('type', [
						z.object({
							type: z.literal('success'),
							user: z.object({ id: z.string(), name: z.string() }),
						}),
						z.object({ type: z.literal('error'), message: z.string() }),
					])
				)
				.query(async ({ input }) => {
					// ! NOTE: this is NOT how to actually handle errors. Just used as an example.
					if (input.id === '404') {
						return { type: 'error', message: 'User not found' } as const;
					}
					return {
						type: 'success',
						user: { id: input.id, name: 'Test User' },
					} as const;
				});

			const result = await getUserOrError.safeCall({ input: { id: '123' } });
			if (result.error) return;
			// Using .data to access the actual value
			const data = result.data;

			if (data.type === 'success') {
				expectTypeOf(data.user).toMatchTypeOf<{ id: string; name: string }>();
			} else {
				expectTypeOf(data.message).toBeString();
			}
		});

		test('should infer primitive return types', async () => {
			const isUserAdmin = baseFn()
				.input(z.object({ userId: z.string() }))
				.output(z.boolean())
				.query(async ({ input }) => {
					return input.userId === 'admin123';
				});

			const result = await isUserAdmin.safeCall({
				input: { userId: 'admin123' },
			});
			if (result.error) return;
			expectTypeOf(result.data).toBeBoolean();

			const stringFn = baseFn()
				.input(z.object({ text: z.string() }))
				.output(z.string())
				.query(async ({ input }) => input.text.toUpperCase());

			const stringResult = await stringFn.safeCall({
				input: { text: 'hello' },
			});
			if (stringResult.error) return;
			expectTypeOf(stringResult.data).toBeString();
		});
	});

	describe('Should handle raw object for output schema', () => {
		test('should default to zod object if object is passed to output', async () => {
			const createUserWithRawOutput = baseFn()
				.input(testData.input)
				.output({
					id: z.string(),
					email: z.string(),
				})
				.mutation(async ({ input }) => {
					return testData.defaultOutput;
				});

			// Check that the output schema is correctly created
			const outputSchema = createUserWithRawOutput.outputSchema;
			expect(outputSchema).toBeDefined();
			expect(outputSchema.shape).toStrictEqual({
				id: expect.any(Object),
				email: expect.any(Object),
			});

			// Test that validation works correctly
			const result = await createUserWithRawOutput.safeCall({
				input: { name: 'test' },
			});
			expect(result.data).toStrictEqual(testData.defaultOutput);
		});

		test('should handle validation errors with raw object output schema', async () => {
			const createUser = baseFn()
				.input(z.any())
				.output({
					id: z.string(),
					count: z.number(),
				})
				.mutation(async ({ input }) => {
					return { id: 'test-id', count: 'not-a-number' as any };
				});

			const result = await createUser.safeCall({ input: { any: 'input' } });
			expect(result.error).toBeDefined();

			expect(result.error).toBeInstanceOf(FnError);
			expect((result.error as FnError).code).toBe('INVALID_OUTPUT');
		});

		test('type inference works with raw object output schema', async () => {
			const getUser = baseFn()
				.input({ id: z.string() })
				.output({
					user: z.object({
						id: z.string(),
						name: z.string(),
						roles: z.array(z.string()),
					}),
					meta: z.object({
						timestamp: z.number(),
					}),
				})
				.query(async ({ input }) => {
					return {
						user: {
							id: input.id,
							name: 'Test User',
							roles: ['user'],
						},
						meta: {
							timestamp: Date.now(),
						},
					};
				});

			const result = await getUser({ input: { id: '123' } });

			expectTypeOf(result).toMatchTypeOf<{
				user: {
					id: string;
					name: string;
					roles: string[];
				};
				meta: {
					timestamp: number;
				};
			}>();

			expectTypeOf(result.user.id).toBeString();
			expectTypeOf(result.meta.timestamp).toBeNumber();
		});
	});

	describe('forceSchemaValidation Option for Direct Calls', () => {
		test('direct calls should not validate schemas by default', async () => {
			const fn = baseFn()
				.input({ value: z.number() })
				.mutation(async ({ input }) => {
					return { result: input.value * 2 };
				});

			// Should NOT throw for invalid input with direct call
			const result = await fn({ input: { value: 'not-a-number' as any } });
			expect(result).toEqual({ result: NaN });
		});

		test('direct calls should validate schemas when forceSchemaValidation is enabled', async () => {
			const fn = baseFn()
				.options({ forceSchemaValidation: true })
				.input({ value: z.number() })
				.mutation(async ({ input }) => {
					return { result: input.value * 2 };
				});

			// Should throw for invalid input with direct call
			await expect(async () => {
				await fn({ input: { value: 'not-a-number' as any } });
			}).rejects.toThrow(/Invalid input/);

			// Should work with valid input
			const result = await fn({ input: { value: 42 } });
			expect(result).toEqual({ result: 84 });
		});

		test('direct calls should validate output when forceSchemaValidation is enabled', async () => {
			const fn = baseFn()
				.options({ forceSchemaValidation: true })
				.input(z.any())
				.output({ result: z.number() })
				.mutation(async ({ input }) => {
					// Return invalid output
					return { result: 'not-a-number' as any };
				});

			// Should throw for invalid output
			await expect(async () => {
				await fn({ input: {} });
			}).rejects.toThrow(/Invalid output/);
		});

		test('forceSchemaValidation can be enabled globally and overridden per function', async () => {
			// Create a baseFn with global forceSchemaValidation
			const validatingBaseFn = baseFn().options({
				forceSchemaValidation: true,
			});

			// Function that inherits global setting
			const fn1 = validatingBaseFn
				.input({ value: z.number() })
				.mutation(async ({ input }) => input.value * 2);

			// Function that overrides the global setting
			const fn2 = validatingBaseFn
				.options({ forceSchemaValidation: false })
				.input({ value: z.number() })
				.mutation(async ({ input }) => input.value * 2);

			// fn1 should validate
			await expect(
				fn1({ input: { value: 'not-a-number' as any } })
			).rejects.toThrow();

			// fn2 should NOT validate (overridden)
			const result = await fn2({ input: { value: 'not-a-number' as any } });
			expect(result).toEqual(NaN);
		});

		test('safeCall always validates schemas regardless of forceSchemaValidation option', async () => {
			// Create function with only forceSchemaValidation
			const fn1 = baseFn()
				.options({ forceSchemaValidation: true })
				.input({ value: z.number() })
				.mutation(async ({ input }) => input.value * 2);

			// Create function with only forceSchemaValidation
			const fn2 = baseFn()
				.options({ forceSchemaValidation: true })
				.input({ value: z.number() })
				.mutation(async ({ input }) => input.value * 2);

			// Both should validate on direct call
			await expect(
				fn1({ input: { value: 'not-a-number' as any } })
			).rejects.toThrow();

			await expect(
				fn2({ input: { value: 'not-a-number' as any } })
			).rejects.toThrow();

			// But safeCall always validates regardless of options
			const result1 = await fn1.safeCall({
				input: { value: 'not-a-number' as any },
			});
			expect(result1.error).toBeDefined();

			const result2 = await fn2.safeCall({
				input: { value: 'not-a-number' as any },
			});
			expect(result2.error).toBeDefined();
		});
	});
});
