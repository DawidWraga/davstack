import { describe, test, expect, vi, beforeEach, expectTypeOf } from 'vitest';
import { z } from 'zod';
import {
	createFn,
	FnError,
	createMiddleware,
	initCreateFn,
	isFnError,
} from '../src';

/**
 * Helper to create an error with a deeper, more realistic stack trace.
 * @param message The error message.
 * @returns An Error object with a simulated stack.
 */
const createOriginalError = (message: string): Error => {
	// We create the error here to capture this frame in the stack.
	const err = new Error(message);
	try {
		// These nested calls add more frames to the stack trace for a robust test.
		(function callFrame1() {
			(function callFrame2() {
				throw err;
			})();
		})();
	} catch (e) {
		// Return the error with its newly acquired stack trace.
		return e as Error;
	}
	return err; // Fallback, should not be reached.
};

describe.skip('Error Handling', () => {
	describe('Basic Validation and Handler Errors', () => {
		const basicFn = createFn({
			name: 'basicFn',
			inputSchema: z.object({ id: z.string().min(1) }),
			outputSchema: z.object({ success: z.boolean() }),
			handler: ({ input }) => {
				if (input.id === 'throw-raw') {
					throw new Error('Raw error from handler');
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
			expectTypeOf(error).toEqualTypeOf<FnError>({} as any);
		});

		test('direct call should wrap raw handler error in FnError', async () => {
			const promise = basicFn({ input: { id: 'throw-raw' } });
			await expect(promise).rejects.toThrow(FnError);
			const caughtError = await promise.catch((e) => e);
			expect(caughtError.code).toBe('INTERNAL_SERVER_ERROR');
			expect(caughtError.message).toBe('Raw error from handler');
			expect(caughtError.cause).toBeInstanceOf(Error);
			expect(caughtError.cause.message).toBe('Raw error from handler');
		});

		test('direct call should preserve and enhance a thrown FnError', async () => {
			const promise = basicFn({ input: { id: 'throw-fn-error' } });
			await expect(promise).rejects.toThrow(FnError);
			const caughtError = await promise.catch((e) => e);
			expect(caughtError.code).toBe('FORBIDDEN');
			expect(caughtError.message).toBe('Custom FnError from handler');
			// The error handler should have added its own context.
			expect(caughtError.meta.functionName).toBe('basicFn');
		});
	});

	describe('Stack Trace Preservation', () => {
		test('should preserve the original stack trace of a handler error', async () => {
			const originalError = createOriginalError('Original Sin');

			const fnWithTrace = createFn({
				name: 'fnWithTrace',
				handler: () => {
					throw originalError;
				},
			});

			const promise = fnWithTrace({});
			await expect(promise).rejects.toThrow(FnError);

			const caughtError = (await promise.catch((e) => e)) as FnError;

			// The `cause` should be the exact same error object.
			expect(caughtError.cause).toBe(originalError);
			expect(caughtError.cause?.stack).toBeDefined();
			// Check that the stack trace contains a reference to the helper function
			// that created the error, proving it's the original stack.
			expect(caughtError.cause?.stack).toContain('createOriginalError');
			expect(caughtError.cause?.stack).toContain('callFrame2');
		});
	});

	describe('Nested Calls and Duplicate Reporting', () => {
		// Mock logger to spy on error reporting.
		const mockLogger = {
			error: vi.fn(),
		};

		beforeEach(() => {
			mockLogger.error.mockClear();
		});

		// This middleware intercepts errors, reports them if they haven't been reported before,
		// marks them as reported, and then re-throws them to continue the normal error flow.
		const reportingMiddleware = createMiddleware(async ({ next, def }) => {
			try {
				return await next();
			} catch (error) {
				// If it's an FnError that has already been reported by a
				// lower-level function's middleware, just let it bubble up.
				if (isFnError(error) && error._reported) {
					throw error;
				}

				// This is a new error, or an unreported one.
				// We must enhance it here to get the correct function context before logging.
				// The default `withThrowingErrorHandler` will run later and add more context,
				// but our log will capture the error at its source.
				const enhancedError = new FnError({
					code: isFnError(error) ? error.code : 'INTERNAL_SERVER_ERROR',
					cause: error as Error,
					meta: { functionName: def.name },
				});

				mockLogger.error(enhancedError);
				enhancedError.markAsReported();

				// Throw the newly enhanced and reported error.
				throw enhancedError;
			}
		});

		// Create a function factory with our reporting middleware.
		const createReportingFn = initCreateFn([reportingMiddleware]);

		// Define a set of nested functions.
		const innerFn = createReportingFn({
			name: 'innerFn',
			handler: () => {
				throw new Error('Error inside inner function');
			},
		});

		const middleFn = createReportingFn({
			name: 'middleFn',
			handler: async () => {
				return await innerFn({});
			},
		});

		const outerFn = createReportingFn({
			name: 'outerFn',
			handler: async () => {
				return await middleFn({});
			},
		});

		test('should log an error only once as it bubbles up through nested calls', async () => {
			await expect(outerFn({})).rejects.toThrow(FnError);

			// Even though the error passed through three functions, it should only be logged once.
			expect(mockLogger.error).toHaveBeenCalledTimes(1);
		});

		test('the logged error should have context from the original throwing function', async () => {
			await expect(outerFn({})).rejects.toThrow();
			const loggedError = mockLogger.error.mock.calls[0][0] as FnError;

			// The error should be identified as coming from `innerFn`.
			expect(loggedError).toBeInstanceOf(FnError);
			expect(loggedError.meta.functionName).toBe('innerFn');
			expect(loggedError.cause?.message).toBe('Error inside inner function');
		});

		test('the final thrown error should have a complete function trace', async () => {
			const promise = outerFn({});
			const caughtError = (await promise.catch((e) => e)) as FnError;

			// The final error that the caller receives should have the full context.
			expect(caughtError.meta.functionName).toBe('outerFn');
			expect(caughtError.meta.functionTrace).toEqual([
				'outerFn',
				'middleFn',
				'innerFn',
			]);
		});
	});
});
