// @ts-nocheck

import { baseFn, FnError, redactSensitive } from '@ream/fn';

import { logger, redactSensitiveDataFromClaudeErrors } from '@api/lib/logger';
import { enhance, prisma, type PrismaClient } from '@ream/db';

import { z, ZodType } from 'zod';

// const createServerFn = baseFn(key)
// 		.use(baseContextMiddleware)
// 		.use(loggingMiddleware)
// 		.use(authedMiddleware)
// 		.use(errorMiddleware);

// const baseContextMiddleware = createMiddleware(({ ctx, next }) =>
// 	next(createServiceCtx(ctx.user))
// );


// const errorMiddleware = createMiddleware(({ ctx, next }) => {
// 	// wrap function in error handling
// 	return next(ctx);
// });

// const loggingMiddleware = createMiddleware(({ ctx, next }) =>
// 	// wrap function in logging
// 	return next(ctx);
// );
// const authedMiddleware = createMiddleware(({ ctx, next }) => {
// 	if (!ctx.user.id) {
// 		throw new FnError({
// 			code: 'UNAUTHORIZED',
// 			message: 'Unauthorized',
// 		});
// 	}
// 	return next(ctx);
// });

export const createServiceCtx = (
	_user?: Partial<User> & { db?: PrismaClient }
) => {
	const user = {
		id: _user?.id ?? '',
		email: _user?.email ?? '',
		role: 'USER' as const,
	};

	const db = _user?.db ?? enhance(prisma, { user });

	return { db, user };
};

export type User = {
	id: string;
	email: string;
	role?: 'USER' | 'ADMIN';
};
export type ServerFnCtx = {
	logger: Logger;
	db: PrismaClient;
	user?: User;
};
export type ServerFnCtxAuthed = Required<ServerFnCtx>;

export const createAuthedServerFn = createServerFn.use(
	async ({ ctx, next }) => {
		if (!ctx.user.id) {
			throw new FnError({
				code: 'UNAUTHORIZED',
				message: 'Unauthorized',
			});
		}
		return next(ctx);
	}
);

export const createPublicServerFn = createServerFn;

// Easier to type, but less ideal:
// export const createAuthedServerFn = (key: string) =>
// 	createServerFn<ServerFnCtxAuthed>(key).use(async ({ ctx, next }) => {
// 		if (!ctx.user.id) {
// 			throw new FnError({
// 				code: 'UNAUTHORIZED',
// 				message: 'Unauthorized',
// 			});
// 		}
// 		return next(ctx);
// 	});

// export const createPublicServerFn = (key: string) =>
// 	createServerFn<ServerFnCtx>(key).use(async ({ ctx, next }) => {
// 		return next(ctx);
// 	});

// ===== Define Server Functions =====

// basic example:

const createChat = createAuthedServerFn({
	name: 'createChat',
	tags: ['chat'],
	inputSchema: z.object({
		title: z.string(),
	}),
	handler: async ({ input, ctx }) => {
		return ctx.db.chat.create({
			data: {
				title: input.title,
			},
		});
	},
});

// nested example:

const sendWelcomeText = createAuthedServerFn({
	name: 'sendWelcomeText',
	tags: ['sms', 'credits'],
	description: ` 
	- Ensures the user has enough credits
  - Generates a personalized welcome text
  - Sends the welcome text to the user
	`,
	inputSchema: z.object({
		chatId: z.string(),
	}),
	outputSchema: z.object({
		success: z.boolean(),
	}),
	handler: async ({ input, ctx }) => {
		const canSend = checkCredits({
			ctx,
			input: {
				actionType: 'send-welcome-text',
			},
		});

		if (!canSend) {
			throw new FnError({
				code: 'INSUFFICIENT_CREDITS',
				message: 'Insufficient credits',
			});
		}

		const personalizedWelcomeText = await generatePersonalizedWelcomeText({
			ctx,
		});

		const status = await sendSms({
			ctx,
			input: {
				phoneNumber: input.phoneNumber,
				message: personalizedWelcomeText,
			},
		});

		return status;
	},
});

// ===== Use Server Functions =====

const 

const ctx = createServiceCtx(await getUser(cookies()));

const chat = createChat({
	ctx,
	input: {
		title: 'Hello',
	},
});