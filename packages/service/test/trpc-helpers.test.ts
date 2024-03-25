/* eslint-disable no-unused-vars */
import { z } from 'zod';

// import { service } from "./service";

import { describe, expect, test } from 'vitest';
import { service } from '../src';
import {
	createTrpcProcedureFromService,
	createTrpcRouterFromServices,
} from '../src/trpc-helpers';
import { initTRPC } from '@trpc/server';

/**
 * dummy data
 */
const d = {
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
	// createCtxParams: {
	//   user: { id: "1" },
	//   db: (() => {}) as any,
	//   sb: (() => {}) as any,
	// },
};

type ApiContext = {
	user?: { id: string };
};

const publicService = service<ApiContext>();

const privateService = service<Required<ApiContext>>().use(
	async ({ ctx, next }) => {
		if (!ctx.user) {
			throw new Error('No user');
		}
		return await next({ user: { id: ctx.user.id } });
	}
);

describe('integrate with trpc router', () => {
	const createUser = service()
		.input(d.input)
		.output(d.output)
		.mutation(async ({ input, ctx }) => {
			return d.defaultOutput;
		});

	const t = initTRPC.create();
	const createCallerFactory = t.createCallerFactory;
	const createRouter = t.router;
	// const createTrpcProcedureFromService = createTrpcProcedureFromService(t)

	test('should be able to create a procedure', async () => {
		const router = t.router({
			createUser: createTrpcProcedureFromService(createUser),
		});

		const createCaller = createCallerFactory(router);
		const caller = createCaller(d.ctx).createUser;

		expect(caller).toBeDefined();

		const result = await caller({ name: 'test' });
		expect(result).toStrictEqual(d.defaultOutput);
	});

	test('Should be able to quickly create router with helper', () => {
		const createUser = service()
			.input(d.input)
			.output(d.output)
			.mutation(async ({ input, ctx }) => {
				return d.defaultOutput;
			});
		const router = createTrpcRouterFromServices({
			createUser,
		});

		// @ts-expect-error
		const createCaller = createCallerFactory(router);
		const caller = createCaller(d.ctx).createUser!;

		expect(caller).toBeDefined();

		const resultPromise = caller({ name: 'test' });
		expect(resultPromise).resolves.toStrictEqual(d.defaultOutput);
	});

	test('Should handle public procedures', async () => {
		const publicCreateUser = publicService
			.input(d.input)
			.output(d.output)
			.mutation(async ({ input, ctx }) => {
				return d.defaultOutput;
			});

		const router = createRouter({
			createUser: createTrpcProcedureFromService(publicCreateUser),
		});

		const createCaller = createCallerFactory(router);
		const caller = createCaller({
			user: null as any,
			db: 'hello' as any,
			sb: 'hello' as any,
		}).createUser;

		await expect(caller({ name: 'test' })).resolves.not.toThrowError();
	});

	test('Should handle authed procedures', async () => {
		const authedCreateUser = privateService
			.input(d.input)
			.output(d.output)
			.mutation(async ({ input, ctx }) => {
				return d.defaultOutput;
			});

		const router = createRouter({
			createUser: createTrpcProcedureFromService(authedCreateUser as any),
		});

		const createCaller = createCallerFactory(router);
		const authedCaller = createCaller({
			user: { id: 'testingId' },
			db: 'hello' as any,
			sb: 'hello' as any,
		}).createUser;

		await expect(authedCaller({ name: 'test' })).resolves.not.toThrowError();

		const publicCaller = createCaller({
			user: null as any,
			db: 'hello' as any,
			sb: null as any,
		}).createUser;

		await expect(publicCaller({ name: 'test' })).rejects.toThrowError();
	});

	// testing this because it caused a bug
	test('Should handle procedures without input', async () => {
		const createUser = service().query(async ({ ctx }) => {
			return d.defaultOutput;
		});

		const router = createRouter({
			createUser: createTrpcProcedureFromService(createUser),
		});

		const createCaller = createCallerFactory(router);
		const caller = createCaller(d.ctx).createUser;

		expect(caller).toBeDefined();

		const result = await caller();
		expect(result).toStrictEqual(d.defaultOutput);
	});
});
