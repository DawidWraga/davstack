import { vi, type Mock } from 'vitest';
import { z } from 'zod';

/**
 * Common test data used across tests
 */
export const testData = {
	input: z.object({
		name: z.string(),
	}),
	output: z.object({
		id: z.string(),
		email: z.string(),
	}),
	defaultOutput: {
		id: '1',
		email: '',
	},
	ctx: {
		user: { id: '1' },
		db: (() => {}) as any,
		sb: (() => {}) as any,
	},
};

export type PublicActionCtx = {
	user?: { id: string };
};

export type AuthedActionCtx = {
	user: { id: string };
};

export const createMockLogger = () => {
	const log = vi.fn();
	const error = vi.fn();
	const warn = vi.fn();
	const info = vi.fn();
	const debug = vi.fn();
	const trace = vi.fn();

	const cleanup = () => {
		log.mockClear();
		error.mockClear();
		warn.mockClear();
		info.mockClear();
		debug.mockClear();
		trace.mockClear();
	};
	return { log, error, warn, info, debug, trace, cleanup };
};
