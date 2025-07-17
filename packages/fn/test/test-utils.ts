// packages/fn/test/test-utils.ts
import { vi } from 'vitest';
import { z } from 'zod';

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
		// ... etc
	},
});

// A mock DB client
export const mockDb = {
	chat: {
		create: vi.fn(async (data) => ({ id: 'chat_123', ...data.data })),
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
