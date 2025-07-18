import { describe, test, expect, expectTypeOf } from 'vitest';
import { createFn, FnError } from '../src'; // Assuming FnError is exported from the main index
import { z } from 'zod';

// Mock utilities can be in the same file for simplicity or in test-utils.ts
const createMockLogger = () => ({ info: () => {}, error: () => {} });
const mockDb = { chat: { create: async (d: any) => d } };
const commonSchemas = {
	createChatInput: z.object({ title: z.string() }),
	createChatOutput: z.object({ id: z.string(), title: z.string() }),
};

describe('Core `createFn` API', () => {
	const logger = createMockLogger();
	const ctx = { logger, db: mockDb };

	test('should create a function with definition properties attached', () => {
		const createChat = createFn({
			name: 'createChat',
			description: 'Create a chat',
			tags: ['chat'],
			inputSchema: commonSchemas.createChatInput,
			outputSchema: commonSchemas.createChatOutput,
			handler: async ({ input }) => {
				return { id: 'chat_123', title: input.title };
			},
		});

		expect(typeof createChat).toBe('function');
		// The function's own `name` property is set by Object.assign
		expect(createChat.name).toBe('createChat');
		// The definition property is also available
		expect(createChat.inputSchema).toBeDefined();
		expect(createChat.inputSchema).toEqual(commonSchemas.createChatInput);
		expect(createChat.description).toBe('Create a chat');
		expect(createChat.tags).toEqual(['chat']);
		expect(createChat.outputSchema).toBeDefined();
		expect(createChat.handler).toBeDefined();
	});

	describe('Direct Call', () => {
		test('should return data directly on success', async () => {
			const getChat = createFn({
				name: 'getChat',

				handler: async () => {
					return 'hello world';
				},
			});

			const result = await getChat();
			expect(result).toBe('hello world');
			expectTypeOf(result).toEqualTypeOf<string>();
		});

		test('should NOT validate schemas on direct calls', async () => {
			const createChat = createFn({
				name: 'createChat',
				inputSchema: commonSchemas.createChatInput,
				handler: async ({ input }) => input, // Passthrough
			});

			// Pass invalid input, should not throw validation error
			// but will throw an enhanced error from withThrowingErrorHandler
			const result = await createChat({ input: { title: 123 }, ctx } as any);
			expect(result).toEqual({ title: 123 });
		});
	});

	describe('.safeCall()', () => {
		const createChat = createFn({
			name: 'createChat',
			inputSchema: commonSchemas.createChatInput,
			outputSchema: commonSchemas.createChatOutput,
			handler: async ({ input }) => {
				if (input.title === 'throw') {
					throw new Error('Handler error');
				}
				// Return invalid output shape to test output validation
				if (input.title === 'invalid-output') {
					return { id: 123, title: 'invalid' } as any;
				}
				return { id: 'chat_123', title: input.title };
			},
		});

		test('should return { data, error: null } on success', async () => {
			const { data, error } = await createChat.safeCall({
				input: { title: 'Test' },
				ctx,
			});
			expect(error).toBeNull();
			expect(data).toEqual({ id: 'chat_123', title: 'Test' });
			expectTypeOf(data).toMatchTypeOf<{ id: string; title: string } | null>();
		});

		test('should return an INVALID_INPUT error for invalid input', async () => {
			const { data, error } = await createChat.safeCall({
				input: { title: 123 } as any, // Invalid input
				ctx,
			});
			expect(data).toBeNull();
			// Add type guard to safely access properties
			if (error instanceof FnError) {
				expect(error.code).toBe('INVALID_INPUT');
			} else {
				// Fail the test if it's not an FnError
				expect(error).toBeInstanceOf(FnError);
			}
		});

		test('should return an INVALID_OUTPUT error for invalid output', async () => {
			const { data, error } = await createChat.safeCall({
				input: { title: 'invalid-output' }, // Triggers invalid output
				ctx,
			});
			expect(data).toBeNull();
			if (error instanceof FnError) {
				expect(error.code).toBe('INVALID_OUTPUT');
			} else {
				expect(error).toBeInstanceOf(FnError);
			}
		});

		test('should return an INTERNAL_SERVER_ERROR for thrown errors', async () => {
			const { data, error } = await createChat.safeCall({
				input: { title: 'throw' }, // Triggers a throw
				ctx,
			});
			expect(data).toBeNull();
			if (error instanceof FnError) {
				expect(error.code).toBe('INTERNAL_SERVER_ERROR');
				expect(error.message).toBe('Handler error');
			} else {
				expect(error).toBeInstanceOf(FnError);
			}
		});
	});
});
