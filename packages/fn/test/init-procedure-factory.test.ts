// import { describe, test, expect } from 'vitest';
// describe('initProcedureFactory', () => {
// 	expect(true).toBe(true);
// });
import { test, expect, describe } from 'vitest';
import { initProcedureFactory } from '../src/utils/init-procedure-factory';
import {
	AnyProcedureBuilder,
	Router,
} from '@trpc/server/unstable-core-do-not-import';
import { createFn } from '../src';
import { z } from 'zod';
import { expectTypeOf } from 'vitest';
import { MutationProcedure } from '@trpc/server/unstable-core-do-not-import';

describe('initProcedureFactory', () => {
	test('should create a hello world test', () => {
		// Simple hello world test to verify the test setup works
		const message = 'Hello World';
		expect(message).toBe('Hello World');
	});

	test('should initialize a procedure factory', () => {
		// Mock procedure builder
		const mockProcedureBuilder = {} as AnyProcedureBuilder;

		// Create factory
		const createFnProcedure = initProcedureFactory(mockProcedureBuilder as any);

		// Verify factory is a function
		expect(typeof createFnProcedure).toBe('function');

		const createChat = createFn({
			name: 'createChat',
			description: 'Create a chat',
			tags: ['chat'],
			inputSchema: z.object({ title: z.string() }),
			handler: async ({ input }) => {
				return { id: 'chat_123', title: input.title };
			},
		});

		const createChatProcedure = createFnProcedure(createChat, 'mutation');

		expect(createChatProcedure).toBeDefined();
		expectTypeOf(createChatProcedure).not.toBeUndefined();

		expectTypeOf(createChatProcedure).toEqualTypeOf<
			MutationProcedure<{
				input: { title: string };
				output: { id: string; title: string };
			}>
		>();
	});
});
