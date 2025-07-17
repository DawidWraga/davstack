import { describe, expect, test } from 'vitest';
import { baseFn, Middleware } from '../src';
import { z } from 'zod';

type DB = {
	users: { id: string; name: string }[];
};

type AuthedFnCtx = {
	user: { id: string };
	db: DB;
};

type UnauthedFnCtx = {
	db: DB;
};

const getDb = (opts: { user: { id: string } }) => {
	return {
		users: [{ id: '1', name: 'John' }],
	};
};

describe('Nested Middleware Execution', () => {
	test('BASE CASE: re-running getUser 3 times', async () => {
		let getUserCount = 0;

		const getUser = () => {
			getUserCount++;
			return { id: '1', name: 'John' };
		};

		const fn = baseFn<UnauthedFnCtx>().use(async ({ ctx, next }) => {
			return await next({ db: getDb({ user: { id: '' } }) });
		});

		const authedFn = baseFn<AuthedFnCtx>().use(async ({ ctx, next }) => {
			const user = getUser();
			const db = getDb({ user });
			return await next({ user, db });
		});

		// two child functions with middleware
		const sendSms = authedFn
			.input({
				message: z.string(),
				phoneNumber: z.string(),
			})
			.mutation(async ({ ctx, input }) => {
				return { ctx, input, type: 'sms' };
			});

		const generateTextMessage = authedFn
			.input({
				prompt: z.string(),
			})
			.mutation(async ({ ctx, input }) => {
				return { ctx, input, type: 'generator', generated: 'message' };
			});

		// parent function
		const sendGeneratedText = authedFn.mutation(async ({ ctx }) => {
			const textMessage = await generateTextMessage({
				input: { prompt: 'Hello, world!' },
				ctx
			});
			const smsResponse = await sendSms({
				input: {
					message: textMessage.generated,
					phoneNumber: '1234567890'
				},
				ctx
			});
			return { textMessage, smsResponse, ctx };
		});

		const result = await sendGeneratedText({});

		// !!! OUR OBJECTIVE IS TO CHANGE THIS TO BE 1 INSTEAD OF 3
		expect(getUserCount).toBe(3);

		// !!! without disrubting these here:
		// children ran as expected, including with the correct context
		expect(result.textMessage.ctx?.user?.id).toBe('1');
		expect(result.textMessage.type).toBe('generator');

		expect(result.smsResponse.ctx?.user?.id).toBe('1');
		expect(result.smsResponse.type).toBe('sms');

		getUserCount = 0;
	});
});
