// import { describe, test, expect } from 'vitest';
// describe('initProcedureFactory', () => {
// 	expect(true).toBe(true);
// });
import { describe, expect, test } from 'vitest';
import { initProcedureFactory } from '../src/utils/init-procedure-factory';

import { initTRPC } from '@trpc/server';
import { MutationProcedure } from '@trpc/server/unstable-core-do-not-import';
import { expectTypeOf } from 'vitest';
import { z } from 'zod';
import { createFn } from '../src';

describe('initProcedureFactory', () => {
	test('should create a hello world test', () => {
		// Simple hello world test to verify the test setup works
		const message = 'Hello World';
		expect(message).toBe('Hello World');
	});

	test('should initialize a procedure factory', () => {
		// Mock procedure builder

		const t = initTRPC.create();
		const baseProcedure = t.procedure;

		// Create factory
		const createFnProcedure = initProcedureFactory(baseProcedure);

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
		expectTypeOf<typeof createChatProcedure>().not.toBeUndefined();

		// console.log('createChatProcedure', createChatProcedure);
		// console.log('createChatProcedure.type:', typeof createChatProcedure);
		expectTypeOf<typeof createChatProcedure>({} as any).toEqualTypeOf<
			MutationProcedure<{
				input: { title: string };
				output: { id: string; title: string };
				meta: Record<string, string>;
			}>
		>({} as any);
	});
});
