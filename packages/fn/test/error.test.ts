import { describe, test, expect } from 'vitest';
import { z } from 'zod';
import { createFn, FnError } from '../src';

/**
 * A helper to create an error with a distinct, deep stack trace for testing.
 */
const createOriginalError = (message: string): Error => {
	try {
		function createErrorFrame1() {
			function createErrorFrame2() {
				throw new Error(message);
			}
			createErrorFrame2();
		}
		createErrorFrame1();
	} catch (e) {
		return e as Error;
	}
	throw new Error('Fallback error'); // Should not be reached
};

describe('Core Error Handling', () => {
	const basicFn = createFn({
		name: 'basicFn',
		inputSchema: z.object({ id: z.string().min(1) }),
		outputSchema: z.object({ success: z.boolean() }),
		handler: ({ input }) => {
			if (input.id === 'throw-raw') {
				throw createOriginalError('Raw error from handler');
			}
			if (input.id === 'throw-fn-error') {
				throw new FnError({
					code: 'FORBIDDEN',
					message: 'Custom FnError from handler',
				});
			}
			if (input.id === 'invalid-output') {
				return { wrong: 'shape' } as any;
			}
			return { success: true };
		},
	});

	test('direct call should throw FnError on input validation failure', async () => {
		const promise = basicFn({ input: { id: '' } });
		await expect(promise).rejects.toThrow(FnError);
		await expect(promise).rejects.toHaveProperty('code', 'INVALID_INPUT');
	});

	test('safeCall should return FnError on input validation failure', async () => {
		const { data, error } = await basicFn.safeCall({ input: { id: '' } });
		expect(data).toBeNull();
		expect(error).toBeInstanceOf(FnError);
		expect(error).toHaveProperty('code', 'INVALID_INPUT');
	});

	test('direct call should throw FnError on output validation failure', async () => {
		const promise = basicFn({ input: { id: 'invalid-output' } });
		await expect(promise).rejects.toThrow(FnError);
		await expect(promise).rejects.toHaveProperty('code', 'INVALID_OUTPUT');
	});

	test('safeCall should return FnError on output validation failure', async () => {
		const { data, error } = await basicFn.safeCall({
			input: { id: 'invalid-output' },
		});
		expect(data).toBeNull();
		expect(error).toBeInstanceOf(FnError);
		expect(error).toHaveProperty('code', 'INVALID_OUTPUT');
	});

	test('direct call should wrap raw handler error in FnError and preserve cause', async () => {
		const promise = basicFn({ input: { id: 'throw-raw' } });
		await expect(promise).rejects.toThrow(FnError);

		const caughtError = (await promise.catch((e) => e)) as FnError;
		expect(caughtError.code).toBe('INTERNAL_SERVER_ERROR');
		expect(caughtError.message).toBe('Raw error from handler');

		// Check that the original error is preserved as the cause
		const cause = caughtError.cause;
		expect(cause).toBeInstanceOf(Error);
		if (cause instanceof Error) {
			expect(cause.message).toBe('Raw error from handler');
			// Verify the original stack trace is present
			expect(cause.stack).toContain('createErrorFrame2');
		}
	});

	test('direct call should preserve and enhance a thrown FnError', async () => {
		const promise = basicFn({ input: { id: 'throw-fn-error' } });
		await expect(promise).rejects.toThrow(FnError);

		const caughtError = (await promise.catch((e) => e)) as FnError;
		expect(caughtError.code).toBe('FORBIDDEN');
		expect(caughtError.message).toBe('Custom FnError from handler');
		// The default error handler should have added its own context
		expect(caughtError.meta.functionName).toBe('basicFn');
	});
});
