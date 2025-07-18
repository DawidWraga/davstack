// packages/fn/test/test-utils.ts
import { vi } from 'vitest';
import { z } from 'zod';
import { createMiddleware, FnError } from '../src';

// A mock logger to spy on calls
export const createMockLogger = () => ({
	info: vi.fn(),
	error: vi.fn(),
	warn: vi.fn(),
	debug: vi.fn(),
	// Method to clear mocks between tests
	cleanup: function () {
		this.info.mockClear();
		this.error.mockClear();
		this.warn.mockClear();
		this.debug.mockClear();
	},
});

// A mock DB client
export const mockDb = {
	chat: {
		create: vi.fn(async (data) => ({ id: 'chat_123', ...data.data })),
	},
	credits: {
		findFirst: vi.fn(async () => ({ amount: 100 })),
	},
};

// Define shared context types
export type ServerFnCtx = {
	logger: ReturnType<typeof createMockLogger>;
	db: typeof mockDb;
	user?: { id: string };
};
export type AuthedServerFnCtx = Required<ServerFnCtx>;

// Shared Zod schemas
export const commonSchemas = {
	createChatInput: z.object({ title: z.string() }),
	createChatOutput: z.object({ id: z.string(), title: z.string() }),
};

// --- Reusable Middleware Helpers ---

/**
 * Creates a logging middleware that logs function entry and exit
 */
export const createLoggingMiddleware = <TContext extends { logger: any }>() =>
	createMiddleware<TContext>(async ({ ctx, input, def, next }) => {
		ctx.logger.info(`-> Calling '${def.name}'`);
		const result = await next();
		ctx.logger.info(`<- Finished '${def.name}'`);
		return result;
	});

/**
 * Creates an error-handling logging middleware that also logs errors
 */
export const createErrorLoggingMiddleware = <
	TContext extends { logger: any },
>() =>
	createMiddleware<TContext>(async ({ ctx, input, def, next }) => {
		try {
			ctx.logger.info(`-> Calling '${def.name}'`);
			const result = await next();
			ctx.logger.info(`<- Finished '${def.name}'`);
			return result;
		} catch (error) {
			ctx.logger.error(error, `Error in '${def.name}'`);
			throw error;
		}
	});

/**
 * Creates an auth middleware that requires a user to be present
 */
export const createAuthMiddleware = <
	TContext extends { user?: { id: string } },
>() =>
	createMiddleware<TContext>(async ({ ctx, input, def, next }) => {
		if (!ctx.user?.id) {
			throw new FnError({
				code: 'UNAUTHORIZED',
				message: 'User is not authenticated.',
			});
		}
		return next();
	});

/**
 * Creates a simple timing middleware for performance testing
 */
export const createTimingMiddleware = <TContext extends { logger: any }>() =>
	createMiddleware<TContext>(async ({ ctx, input, def, next }) => {
		const start = Date.now();
		const result = await next();
		const duration = Date.now() - start;
		ctx.logger.info(`'${def.name}' took ${duration}ms`);
		return result;
	});

// --- Pre-configured Middleware Instances ---

export const loggingMiddleware = createLoggingMiddleware<ServerFnCtx>();
export const errorLoggingMiddleware =
	createErrorLoggingMiddleware<ServerFnCtx>();
export const authMiddleware = createAuthMiddleware<AuthedServerFnCtx>();
export const timingMiddleware = createTimingMiddleware<ServerFnCtx>();

// Authed versions
export const authedLoggingMiddleware =
	createLoggingMiddleware<AuthedServerFnCtx>();
export const authedErrorLoggingMiddleware =
	createErrorLoggingMiddleware<AuthedServerFnCtx>();
export const authedTimingMiddleware =
	createTimingMiddleware<AuthedServerFnCtx>();
