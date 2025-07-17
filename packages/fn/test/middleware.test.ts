import { beforeEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { createFn, createMiddleware, FnError } from '../src';
import { createMockLogger, mockDb, ServerFnCtx } from './test-utils';

describe('Middleware System', () => {
	const logger = createMockLogger();
	beforeEach(() => logger.cleanup());

	test('should work without any custom middleware', async () => {
		const simpleFn = createFn({
			name: 'simple',
			handler: async () => 'hello world',
		});

		const result = await simpleFn({});
		expect(result).toBe('hello world');
	});

	test('should work with custom middleware', async () => {
		const loggingMiddleware = createMiddleware<ServerFnCtx>((def, handler) => {
			return async (opts) => {
				opts.ctx.logger.info(`-> Calling '${def.name}'`);
				const result = await handler(opts);
				opts.ctx.logger.info(`<- Finished '${def.name}'`);
				return result;
			};
		});

		const testFn = createFn(
			{
				name: 'testWithLogging',
				handler: async ({ ctx }) => `Hello ${ctx.user?.id || 'anonymous'}`,
			},
			[loggingMiddleware]
		);

		const result = await testFn({
			ctx: { logger, db: mockDb, user: { id: 'user123' } },
		});

		expect(result).toBe('Hello user123');
		expect(logger.info).toHaveBeenCalledWith("-> Calling 'testWithLogging'");
		expect(logger.info).toHaveBeenCalledWith("<- Finished 'testWithLogging'");
	});

	test('should handle input validation with custom middleware', async () => {
		const loggingMiddleware = createMiddleware<ServerFnCtx>((def, handler) => {
			return async (opts) => {
				opts.ctx.logger.info(`Processing ${def.name}`);
				return handler(opts);
			};
		});

		const testFn = createFn(
			{
				name: 'testValidation',
				inputSchema: z.object({ title: z.string() }),
				handler: async ({ input }) => `Title: ${input.title}`,
			},
			[loggingMiddleware]
		);

		// Valid input should work
		const validResult = await testFn.safeCall({
			input: { title: 'Test Title' },
		});
		expect(validResult.data).toBe('Title: Test Title');
		expect(validResult.error).toBeNull();

		// Invalid input should be caught
		const invalidResult = await testFn.safeCall({
			input: { title: 123 } as any,
		});
		expect(invalidResult.data).toBeNull();
		expect(invalidResult.error).toBeInstanceOf(FnError);
		expect((invalidResult.error as FnError).code).toBe('INVALID_INPUT');
	});

	test('should preserve original error in middleware and logging', async () => {
		const originalError = new Error('Database connection failed!');

		const loggingMiddleware = createMiddleware<ServerFnCtx>((def, handler) => {
			return async (opts) => {
				try {
					opts.ctx.logger.info(`-> ${def.name}`);
					const result = await handler(opts);
					opts.ctx.logger.info(`<- ${def.name} success`);
					return result;
				} catch (error) {
					// Log the original error
					opts.ctx.logger.error(error, `Error in ${def.name}`);
					throw error; // Re-throw to let other middleware handle it
				}
			};
		});

		const faultyFn = createFn(
			{
				name: 'faulty',
				handler: async () => {
					throw originalError;
				},
			},
			[loggingMiddleware]
		);

		await expect(faultyFn({ ctx: { logger, db: mockDb } })).rejects.toThrow(
			FnError
		);

		// Verify the original error was logged by our middleware
		expect(logger.error).toHaveBeenCalledWith(originalError, 'Error in faulty');
	});

	test('should handle multiple middleware in correct order', async () => {
		const callOrder: string[] = [];

		const middleware1 = createMiddleware((def, handler) => {
			return async (opts) => {
				callOrder.push('middleware1-start');
				const result = await handler(opts);
				callOrder.push('middleware1-end');
				return result;
			};
		});

		const middleware2 = createMiddleware((def, handler) => {
			return async (opts) => {
				callOrder.push('middleware2-start');
				const result = await handler(opts);
				callOrder.push('middleware2-end');
				return result;
			};
		});

		const testFn = createFn(
			{
				name: 'orderTest',
				handler: async () => {
					callOrder.push('handler');
					return 'done';
				},
			},
			[middleware1, middleware2]
		);

		await testFn({});

		// Middleware should wrap in reverse order: middleware2 wraps middleware1 wraps handler
		expect(callOrder).toEqual([
			'middleware2-start',
			'middleware1-start',
			'handler',
			'middleware1-end',
			'middleware2-end',
		]);
	});
});
