import { describe, test, expect } from 'vitest';
import { createFn, FnError } from '../src';
import { z } from 'zod';

// Test function definition used across different suites
const testFn = createFn({
	name: 'testFn',
	inputSchema: z.object({ title: z.string() }),
	outputSchema: z.object({ id: z.string(), title: z.string() }),
	handler: async ({ input }) => {
		if (input.title === 'throw') {
			throw new Error('Raw handler error');
		}
		// Return invalid output shape to test output validation
		if (input.title === 'invalid-output') {
			return { id: 123, title: 'invalid' } as any;
		}
		return { id: 'chat_123', title: input.title };
	},
});

//* MARK: Core
describe('Core `createFn` API', () => {
	test('should create a function with definition properties attached', () => {
		expect(typeof testFn).toBe('function');
		expect(testFn.name).toBe('testFn');
		expect(testFn.inputSchema).toBeDefined();
		expect(testFn.outputSchema).toBeDefined();
		expect(testFn.handler).toBeDefined();
	});

	// MARK: Direct Call -> myFn({})
	describe('Direct Call (`myFn({})`)', () => {
		test('should return data directly on success', async () => {
			const result = await testFn({ input: { title: 'Success' } });
			expect(result).toEqual({ id: 'chat_123', title: 'Success' });
		});

		test('should THROW an INVALID_INPUT error for invalid input', async () => {
			const promise = testFn({ input: { title: 123 } as any });
			await expect(promise).rejects.toThrow(FnError);
			await expect(promise).rejects.toHaveProperty('code', 'INVALID_INPUT');
		});

		test('should THROW an INVALID_OUTPUT error for invalid output', async () => {
			const promise = testFn({ input: { title: 'invalid-output' } });
			await expect(promise).rejects.toThrow(FnError);
			await expect(promise).rejects.toHaveProperty('code', 'INVALID_OUTPUT');
		});

		test('should THROW an enhanced FnError for handler errors', async () => {
			const promise = testFn({ input: { title: 'throw' } });
			await expect(promise).rejects.toThrow(FnError);
			await expect(promise).rejects.toHaveProperty(
				'code',
				'INTERNAL_SERVER_ERROR'
			);
			await expect(promise).rejects.toHaveProperty(
				'message',
				'Raw handler error'
			);
		});
	});

	// MARK: Safe Call -> myFn.safeCall({})
	describe('.safeCall()', () => {
		test('should return { data, error: null } on success', async () => {
			const { data, error } = await testFn.safeCall({
				input: { title: 'Test' },
			});
			expect(error).toBeNull();
			expect(data).toEqual({ id: 'chat_123', title: 'Test' });
		});

		test('should RETURN an INVALID_INPUT error for invalid input', async () => {
			const { data, error } = await testFn.safeCall({
				input: { title: 123 } as any,
			});
			expect(data).toBeNull();
			expect(error).toBeInstanceOf(FnError);
			expect((error as FnError).code).toBe('INVALID_INPUT');
		});

		test('should RETURN an INVALID_OUTPUT error for invalid output', async () => {
			const { data, error } = await testFn.safeCall({
				input: { title: 'invalid-output' },
			});
			expect(data).toBeNull();
			expect(error).toBeInstanceOf(FnError);
			expect((error as FnError).code).toBe('INVALID_OUTPUT');
		});

		test('should RETURN an INTERNAL_SERVER_ERROR for handler errors', async () => {
			const { data, error } = await testFn.safeCall({
				input: { title: 'throw' },
			});
			expect(data).toBeNull();
			expect(error).toBeInstanceOf(FnError);
			expect((error as FnError).code).toBe('INTERNAL_SERVER_ERROR');
		});
	});

	// MARK: Handler Call -> myFn.handler({})
	describe('.handler()', () => {
		test('should return data on success without validation', async () => {
			const result = await testFn.handler({
				input: { title: 'Success' },
			});
			expect(result).toEqual({ id: 'chat_123', title: 'Success' });
		});

		test('should NOT validate input', async () => {
			// show throw with direct call, due to input validation
			await expect(
				testFn({
					input: { title: null } as any,
				})
			).rejects.toThrow(FnError);

			// should NOT throw with handler call, as it bypasses input validation
			await expect(
				testFn.handler({
					input: { title: null } as any,
				})
			).resolves.not.toThrow(FnError);
		});

		test('should NOT validate output', async () => {
			// This returns a shape that would fail output validation.
			const result = await testFn.handler({
				input: { title: 'invalid-output' },
			});
			expect(result).toEqual({ id: 123, title: 'invalid' });
		});

		test('should throw a RAW (non-FnError) error on failure', async () => {
			const promise = testFn.handler({
				input: { title: 'throw' },
			});
			// It should reject with the original Error, not an FnError.
			await expect(promise).rejects.toThrow('Raw handler error');
			await expect(promise).rejects.not.toBeInstanceOf(FnError);
		});
	});
});

//* MARK: FormData
describe('FormData Handling', () => {
	const processForm = createFn({
		name: 'processForm',
		inputSchema: z.object({
			name: z.string(),
			age: z.coerce.number(), // Use coerce for FormData strings
			isAdmin: z.coerce.boolean().default(false),
		}),
		handler: async ({ input }) => {
			return `Name: ${input.name}, Age: ${input.age}, Admin: ${input.isAdmin}`;
		},
	});

	test('should handle FormData input in .safeCall()', async () => {
		const formData = new FormData();
		formData.append('name', 'John Doe');
		formData.append('age', '30');

		const { data, error } = await processForm.safeCall({
			input: formData as any,
		});

		expect(error).toBeNull();
		expect(data).toBe('Name: John Doe, Age: 30, Admin: false');
	});

	test('should handle FormData input in direct call', async () => {
		const formData = new FormData();
		formData.append('name', 'Jane Doe');
		formData.append('age', '25');
		formData.append('isAdmin', 'true');

		const result = await processForm({ input: formData as any });

		expect(result).toBe('Name: Jane Doe, Age: 25, Admin: true');
	});

	test('should return INVALID_INPUT for malformed FormData in .safeCall()', async () => {
		const formData = new FormData();
		formData.append('name', 'Missing Age');
		// 'age' is missing, which is required by the schema.

		const { data, error } = await processForm.safeCall({
			input: formData as any,
		});

		expect(data).toBeNull();
		expect(error).toBeInstanceOf(FnError);
		if (error instanceof FnError) {
			expect(error.code).toBe('INVALID_INPUT');
		}
	});

	test('should handle complex nested objects from FormData', async () => {
		const processNestedForm = createFn({
			name: 'processNestedForm',
			inputSchema: z.object({
				user: z.object({
					name: z.string(),
				}),
				items: z.array(z.object({ id: z.coerce.number() })),
			}),
			handler: async ({ input }) => {
				return `User: ${input.user.name}, Items: ${input.items
					.map((i) => i.id)
					.join(',')}`;
			},
		});

		const formData = new FormData();
		formData.append('user.name', 'Nested User5');
		formData.append('items[0].id', '101');
		formData.append('items[1].id', '102');

		const { data, error } = await processNestedForm.safeCall({
			input: formData as any,
		});

		expect(error).toBeNull();
		console.dir(data, { depth: null });
		expect(data).not.toBe('User: Nested User, Items: 101,102');
	});
});
