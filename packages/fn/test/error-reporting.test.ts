import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
	createFn,
	FnError,
	createMiddleware,
	initCreateFn,
	isFnError,
} from '../src';

// --- Test Setup: A Simple Logger and a Focused Middleware ---

/**
 * A helper to create an error with a distinct, deep stack trace for testing.
 */
const createOriginalError = (message: string): Error => {
	try {
		// Use named functions so they are clearly identifiable in the stack trace.
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

/**
 * A simple logger that adheres to the principle of not being "too smart".
 * It has a single `error` method that we can spy on.
 */
const createSimpleLogger = () => ({
	error: vi.fn((_error: Error, _context?: Record<string, unknown>) => {
		// In a real implementation, this would send the error and context
		// to a service like Sentry, Pino, etc.
	}),
	cleanup: () => {
		vi.clearAllMocks();
	},
});

type TestContext = {
	logger: ReturnType<typeof createSimpleLogger>;
};

/**
 * This middleware embodies the new, simpler philosophy. It's designed to:
 * 1. Catch any error.
 * 2. If the error is new, pass the ORIGINAL error to the logger.
 * 3. Mark the error as reported to prevent duplicates.
 * 4. Re-throw the error to allow it to bubble up and be decorated by other middleware.
 */
const reportingMiddleware = createMiddleware<TestContext>(
	async ({ ctx, def, next }) => {
		try {
			return await next();
		} catch (error) {
			const fnError = FnError.from(error);

			if (!fnError._reported) {
				// --- Key Change: Logging the *original* cause ---
				// If there's a cause, log that. Otherwise, log the error itself.
				// This ensures the logger gets the error with the original stack trace.
				const errorToLog =
					fnError.cause instanceof Error ? fnError.cause : fnError;
				ctx.logger.error(errorToLog, {
					functionName: def.name,
					message: 'An error was reported',
				});

				fnError.markAsReported();
			}

			// Re-throw the (potentially wrapped) error to allow the default
			// error handler to build the `functionTrace`.
			throw fnError;
		}
	}
);

// --- The Test Suite ---

describe('Robust Error Reporting with a Simple Logger', () => {
	const logger = createSimpleLogger();

	// Create a function factory with our realistic reporting middleware.
	const createReportingFn = initCreateFn<TestContext>([reportingMiddleware]);

	// Define a set of nested functions.
	const innerFn = createReportingFn({
		name: 'innerFn',
		handler: () => {
			throw createOriginalError('Critical failure in the core.');
		},
	});

	const middleFn = createReportingFn({
		name: 'middleFn',
		handler: async ({ ctx }) => {
			return await innerFn({ ctx });
		},
	});

	const outerFn = createReportingFn({
		name: 'outerFn',
		handler: async ({ ctx }) => {
			return await middleFn({ ctx });
		},
	});

	beforeEach(() => {
		logger.cleanup();
	});

	test('should report the error exactly once', async () => {
		await expect(outerFn({ ctx: { logger } })).rejects.toThrow(FnError);
		expect(logger.error).toHaveBeenCalledTimes(1);
	});

	test('EMPIRICAL PROOF: The logger receives the ORIGINAL, untouched error object', async () => {
		const originalError = createOriginalError('test error');
		const fnThatThrows = createReportingFn({
			name: 'fnThatThrows',
			handler: () => {
				throw originalError;
			},
		});

		await expect(fnThatThrows({ ctx: { logger } })).rejects.toThrow();

		// --- THE KEY ASSERTION ---
		// We check the first argument passed to our simple logger's `error` method.
		// It should be the *exact same object* as the one we originally threw.
		const loggedError = logger.error.mock.calls[0][0];
		expect(loggedError).toBe(originalError);

		// Verify its stack trace is the original one.
		expect(loggedError.stack).toContain('createErrorFrame1');
		expect(loggedError.stack).toContain('createErrorFrame2');
	});

	test('The final THROWN error contains the complete, ordered function trace for the caller', async () => {
		const promise = outerFn({ ctx: { logger } });
		const caughtError = (await promise.catch((e) => e)) as FnError;

		// The final error that the user/caller catches should be the fully decorated FnError.
		expect(caughtError).toBeInstanceOf(FnError);

		// The metadata should be from the outermost function that handled the error.
		expect(caughtError.meta.functionName).toBe('outerFn');

		// The functionTrace should show the full path the error bubbled up through.
		expect(caughtError.meta.functionTrace).toEqual([
			'outerFn',
			'middleFn',
			'innerFn',
		]);
	});

	test('The logged error and the final thrown error are different objects with different stacks', async () => {
		// Run the function only ONCE and capture the thrown error.
		const thrownError = (await outerFn({ ctx: { logger } }).catch(
			(e) => e
		)) as FnError;

		// Now, get the error that was logged during that single run.
		const loggedError = logger.error.mock.calls[0][0] as Error;

		// The logged error is the original, the thrown error is the wrapper.
		expect(loggedError).not.toBe(thrownError);
		expect(thrownError.cause).toBe(loggedError);

		// Their stacks should be different.
		const loggedStack = loggedError.stack;
		const thrownStack = thrownError.stack;

		// console.log('loggedError', loggedError);
		// console.log('--------------------------------');
		// console.log('thrownError', thrownError);
		// console.log('--------------------------------');
		// console.log('loggedStack', loggedStack);
		// console.log('--------------------------------');
		// console.log('thrownStack', thrownStack);

		expect(loggedStack).not.toEqual(thrownStack);
		expect(loggedStack).toContain('createErrorFrame2'); // Original error's stack
		expect(thrownStack).toContain('Function.from'); // Wrapper's stack
	});
});
