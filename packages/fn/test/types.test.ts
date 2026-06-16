import { describe, test, expect, expectTypeOf } from 'vitest';
import { z } from 'zod';
import { createFn, FnError, createMiddleware } from '../src/create-fn';

// Mock context for testing
type TestContext = {
	user?: { id: string };
	db?: {
		users: {
			find: (id: string) => Promise<{ id: string; name: string }>;
		};
	};
};

describe('Type System', () => {
	test('should infer types for handler with input and default context', () => {
		const inputSchema = z.object({ id: z.string() });

		const fn = createFn({
			name: 'test',
			inputSchema,
			handler: async ({ input, ctx }) => {
				expectTypeOf(input).toEqualTypeOf<{ id: string }>();
				// expectTypeOf(ctx).toEqualTypeOf<undefined>();
				return { success: true, id: input.id };
			},
		});

		expectTypeOf(fn).parameter(0).toEqualTypeOf<{
			input: { id: string };
			ctx?: undefined;
		}>();
		expectTypeOf(fn).returns.resolves.toEqualTypeOf<{
			success: boolean;
			id: string;
		}>();

		expectTypeOf(fn.inputSchema).not.toBeUndefined();
		expectTypeOf(fn.outputSchema).toBeUndefined();

		expectTypeOf(fn.inputSchema).toEqualTypeOf<typeof inputSchema>();
	});

	test('should handle functions with no context and no input', () => {
		const fn = createFn({
			name: 'ping',
			handler: async ({ input, ctx }) => {
				expectTypeOf(input).toEqualTypeOf<void>();
				// expectTypeOf(ctx).toEqualTypeOf<never>();
				return 'pong';
			},
		});

		// Allows calling with no arguments at all
		expectTypeOf(fn)
			.parameter(0)
			.toEqualTypeOf<{ input?: void; ctx?: undefined }>();
		expectTypeOf(fn).returns.resolves.toEqualTypeOf<string>();
	});
});
