import { describe, expect, it, expectTypeOf } from 'vitest';
import { os, createRouterClient } from '@orpc/server';
import { createFn, FnError } from '@davstack/fn';
import { z } from 'zod';
import { initProcedureFactory } from '../src';

describe('initProcedureFactory', () => {
	it('returns a function', () => {
		const fnProcedure = initProcedureFactory(os);
		expect(typeof fnProcedure).toBe('function');
	});

	it('builds a procedure from a fn with inputSchema + handler and calls it via a router client', async () => {
		const fnProcedure = initProcedureFactory(os);

		const createChat = createFn({
			name: 'createChat',
			description: 'Create a chat',
			inputSchema: z.object({ title: z.string() }),
			handler: async ({ input }) => {
				return { id: 'chat_123', title: input.title };
			},
		});

		const createChatProcedure = fnProcedure(createChat);
		expect(createChatProcedure).toBeDefined();

		const router = { createChat: createChatProcedure };
		const client = createRouterClient(router, { context: {} });

		const result = await client.createChat({ title: 'hello' });
		expect(result).toEqual({ id: 'chat_123', title: 'hello' });
	});

	it('works for a fn with no inputSchema (callable with no args)', async () => {
		const fnProcedure = initProcedureFactory(os);

		const ping = createFn({
			name: 'ping',
			handler: async () => {
				return { ok: true };
			},
		});

		const pingProcedure = fnProcedure(ping);
		const router = { ping: pingProcedure };
		const client = createRouterClient(router, { context: {} });

		const result = await client.ping();
		expect(result).toEqual({ ok: true });
	});

	it('maps oRPC context to fn ctx', async () => {
		const fnProcedure = initProcedureFactory(os.$context<{ userId: string }>());

		const whoami = createFn({
			name: 'whoami',
			handler: async ({ ctx }: { ctx: { userId: string } }) => {
				return { userId: ctx.userId };
			},
		});

		const whoamiProcedure = fnProcedure(whoami);
		const router = { whoami: whoamiProcedure };
		const client = createRouterClient(router, {
			context: { userId: 'u_1' },
		});

		const result = await client.whoami();
		expect(result).toEqual({ userId: 'u_1' });
	});

	it('propagates a FnError thrown by the handler', async () => {
		const fnProcedure = initProcedureFactory(os);

		const findChat = createFn({
			name: 'findChat',
			inputSchema: z.object({ id: z.string() }),
			handler: async () => {
				throw new FnError({ code: 'NOT_FOUND' });
			},
		});

		const findChatProcedure = fnProcedure(findChat);
		const router = { findChat: findChatProcedure };
		const client = createRouterClient(router, { context: {} });

		await expect(client.findChat({ id: 'missing' })).rejects.toMatchObject({
			code: 'NOT_FOUND',
		});
	});

	it('rejects when called with invalid input', async () => {
		const fnProcedure = initProcedureFactory(os);

		const createChat = createFn({
			name: 'createChat',
			inputSchema: z.object({ title: z.string() }),
			handler: async ({ input }) => ({ id: '1', title: input.title }),
		});

		const router = { createChat: fnProcedure(createChat) };
		const client = createRouterClient(router, { context: {} });

		// title should be a string; passing a number must reject validation.
		await expect(
			// @ts-expect-error - invalid input on purpose
			client.createChat({ title: 123 }),
		).rejects.toThrow();
	});

	it('validates output against the fn outputSchema when present', async () => {
		const fnProcedure = initProcedureFactory(os);

		const getCount = createFn({
			name: 'getCount',
			outputSchema: z.object({ count: z.number() }),
			handler: async () => {
				return { count: 7 };
			},
		});

		const router = { getCount: fnProcedure(getCount) };
		const client = createRouterClient(router, { context: {} });

		const result = await client.getCount();
		expect(result).toEqual({ count: 7 });
	});

	it('preserves input/output types through the router client (type-level)', async () => {
		const fnProcedure = initProcedureFactory(os);

		const createChat = createFn({
			name: 'createChat',
			inputSchema: z.object({ title: z.string() }),
			handler: async ({ input }) => {
				return { id: 'chat_123', title: input.title };
			},
		});

		const router = { createChat: fnProcedure(createChat) };
		const client = createRouterClient(router, { context: {} });

		const result = await client.createChat({ title: 'x' });

		expectTypeOf(result).toEqualTypeOf<{ id: string; title: string }>();
		expectTypeOf(client.createChat)
			.parameter(0)
			.toEqualTypeOf<{ title: string }>();
	});
});
