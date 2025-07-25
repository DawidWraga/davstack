import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { createFn, createMiddleware, initCreateFn } from '../src';

// --- Test Setup: A Realistic Logger and Tracing Middleware ---

/**
 * A realistic, generic logger interface.
 */
interface ILogger {
	info(message: string, ...data: any[]): void;
	error(error: Error, ...data: any[]): void;
	warn(message: string, ...data: any[]): void;
	debug(message: string, ...data: any[]): void;
	child(bindings: { name: string }): ILogger;
}

/**
 * A logger implementation that writes to the console and manages
 * a hierarchical prefix for context.
 */
class ConsoleLogger implements ILogger {
	private context: string;

	constructor(context: string = '') {
		this.context = context;
	}

	info(message: string, ...data: any[]): void {
		console.info(this.context, message, ...data);
	}

	error(error: Error, ...data: any[]): void {
		console.error(this.context, error, ...data);
	}

	warn(message: string, ...data: any[]): void {
		console.warn(this.context, message, ...data);
	}

	debug(message: string, ...data: any[]): void {
		console.debug(this.context, message, ...data);
	}

	child(bindings: { name: string }): ILogger {
		const newContext = this.context
			? `${this.context} -> [${bindings.name}]`
			: `[${bindings.name}]`;
		return new ConsoleLogger(newContext);
	}
}

type LogContext = {
	logger: ILogger;
};

/**
 * A middleware specifically for tracing function execution.
 * It uses the generic logger to output trace information.
 */
const tracingMiddleware = createMiddleware<LogContext>(
	async ({ ctx, def, input, next }) => {
		const childLogger = ctx.logger.child({ name: def.name });
		const startTime = Date.now();

		childLogger.info('->', { input });

		const result = await next({ ...ctx, logger: childLogger });
		const durationMs = Date.now() - startTime;

		childLogger.info('<-', { output: result, durationMs });
		return result;
	}
);

// --- The Test Suite ---

describe('Hierarchical Tracing with a Console-Based Logger', () => {
	// We will spy on console.info to capture log output.
	const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

	const createTracedFn = initCreateFn<LogContext>([tracingMiddleware]);

	// Define nested functions.
	const innerFn = createTracedFn({
		name: 'innerFn',
		handler: async () => {
			await new Promise((resolve) => setTimeout(resolve, 10));
			return { result: 'inner-ok' };
		},
	});

	const middleFn = createTracedFn({
		name: 'middleFn',
		handler: async ({ ctx }) => {
			const innerResult = await innerFn({ ctx });
			return { result: `middle-ok-for-${innerResult.result}` };
		},
	});

	const outerFn = createTracedFn({
		name: 'outerFn',
		handler: async ({ ctx }) => {
			const middleResult = await middleFn({ ctx });
			return { result: `outer-ok-for-${middleResult.result}` };
		},
	});

	// Ensure the spy is reset before each test.
	beforeEach(() => {
		consoleSpy.mockClear();
	});

	// Restore the original console.info after all tests.
	afterEach(() => {
		consoleSpy.mockRestore();
	});

	test('should call console.info with hierarchical context and rich objects', async () => {
		const rootLogger = new ConsoleLogger();
		await outerFn({ ctx: { logger: rootLogger } });

		// Check that our logger was called the correct number of times.
		expect(consoleSpy).toHaveBeenCalledTimes(6);

		// --- Assert Entry Traces ---
		expect(consoleSpy).toHaveBeenNthCalledWith(1, '[outerFn]', '->', {
			input: undefined,
		});
		expect(consoleSpy).toHaveBeenNthCalledWith(
			2,
			'[outerFn] -> [middleFn]',
			'->',
			{ input: undefined }
		);
		expect(consoleSpy).toHaveBeenNthCalledWith(
			3,
			'[outerFn] -> [middleFn] -> [innerFn]',
			'->',
			{ input: undefined }
		);

		// --- Assert Exit Traces ---
		const innerExitCall = consoleSpy.mock.calls[3];
		expect(innerExitCall[0]).toBe('[outerFn] -> [middleFn] -> [innerFn]');
		expect(innerExitCall[1]).toBe('<-');
		expect(innerExitCall[2].output).toEqual({ result: 'inner-ok' });
		expect(innerExitCall[2].durationMs).toBeGreaterThanOrEqual(10);

		const middleExitCall = consoleSpy.mock.calls[4];
		expect(middleExitCall[0]).toBe('[outerFn] -> [middleFn]');
		expect(middleExitCall[1]).toBe('<-');
		expect(middleExitCall[2].output).toEqual({
			result: 'middle-ok-for-inner-ok',
		});
		expect(middleExitCall[2].durationMs).toBeGreaterThanOrEqual(10);

		const outerExitCall = consoleSpy.mock.calls[5];
		expect(outerExitCall[0]).toBe('[outerFn]');
		expect(outerExitCall[1]).toBe('<-');
		expect(outerExitCall[2].output).toEqual({
			result: 'outer-ok-for-middle-ok-for-inner-ok',
		});
		expect(outerExitCall[2].durationMs).toBeGreaterThanOrEqual(10);
	});
});
