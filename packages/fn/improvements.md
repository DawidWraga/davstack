Problem: if use transform in input/output schema, does not reflect in types

- this is because we use z.infer for the input, but we should be using z.input

Problem: No sentry

- currently sentry not across express + railyway and next+vercel, so commmented out for now (and lots of ugly code)
- if we always passed logger to ctx, then we could inject the logger alongside the user ctx eg createNextContext createExpressContext

Problem: Obfuscated error messages

- We recreate errors in the wrapper, so we lose the original stack trace and get a loooong error message
- We should alawys keep logger.error first param as the original error, to avoid info loss

Improvements:

- replace "wrapper" with just middleware
- establish naming / meta pattern

NEW Fn API design:

OBJECTIVE: SUPER SIMPLE AND FAST

### baseFn => createFn

- The davstack/fn package createFn

instead of using builder method we simply wrap around the create fn function to add the middleware

Change Names:

- baseFn -> createFn
- authedService -> createAuthedFn
- publicService -> createPublicFn

```ts
// lib/create-server-fn.ts

export type User = {
	id: string;
	email: string;
	role: 'USER' | 'ADMIN';
};
export type ServerFnCtx = {
	logger: Logger;
	db: PrismaClient;
	user?: User;
};
export type ServerFnCtxAuthed = Required<ServerFnCtx>;

const loggingMiddleware = createMiddleware(({ ctx, next }) =>
// later we want indentation here to be based on the depth of the fn call, we can use logger.child or something like that, or add depth+1 to the ctx
	ctx.logger.info('-> fn called', {
		fn: ctx.fn.name,
		input: ctx.input,
		ctx: ctx.ctx,
	})

  const result = await next(ctx);

  ctx.logger.info('<- fn result', {
    fn: ctx.fn.name,
    result,
  })

  return result;
);
const authedMiddleware = createMiddleware(({ ctx, next }) => {
	if (!ctx.user.id) {
		throw new FnError({
			code: 'UNAUTHORIZED',
			message: 'Unauthorized',
		});
	}
	return next(ctx);
});

export const createPublicServerFn = (def: FnDef<PublicServerFnCtx>) => {
	return createFn<PublicServerFnCtx>({
		...def,
		middleware: [...def.middleware, ...baseContextMiddleware, loggingMiddleware],
	});
};

export const createAuthedServerFn = (def: FnDef<AuthedServerFnCtx>) => {
	return createFn<AuthedServerFnCtx>({
		...def,
		middleware: [...def.middleware, ...baseContextMiddleware, authedMiddleware, loggingMiddleware],
	});
};


export function createCtx(){
  const user= getUserFromCookie()
  return {
    user,
    db: enhance(prisma, { user }),
    logger: createLogger({
      level: 'info',
      format: format.json(),
    }),
  }
}
```

## Define Functions

```ts
// server/chat

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
```

## Usage: Inside nested functions

```ts
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
```

### Usage: TRPC

```ts
// router.ts

const createFnProcedure = initCreateFnProcedure({ createContext });

export const appRouter = createTRPCRouter({
	chat: {
		create: createFnProcedure(createChat, 'mutation'),
		get: createFnProcedure(getChat, 'query'),
	},
});
```

```ts
// app/api/[...trpc].ts

//psuedo code - the point is that we need to create the CTX here and pass it down to the handler
export { GET, POST } = createTRPCRequest(() => {
	const ctx = createCtx();
	handleRequest(ctx);
});
```

```ts
// app/chat/page.tsx
const ChatPage = () => {
	const { mutate } = api.chat.create.useMutation();
	const { data } = api.chat.get.useQuery();
};
```

### Usage: Server Actions

Using Next.js Server Actions. Particularly useful for working with FILE UPLOADS or STREAMING responses - as trpc isn't a good fit for these.

```ts
// actions.ts
'use server';

const createFnAction = initCreateFnAction({ createCtx });

export const createChatAction = createFnAction(createChat);
export const uploadFileAction = createFnAction(uploadFile);
```

```ts
// app/chat/page.tsx

import { useMutation } from '@tanstack/react-query';

const ChatPage = () => {
	const { mutateAsync } = useMutation({
		mutationFn: uploadFileAction,
	});
};
```

### Usage: LLM tools (FUTURE - ignore for now)

Using the AI SDK `tool` function.

```ts
// tools.ts
const createFnTool = fnToolOptions({ createCtx });

export const tools = {
	createChat: createFnTool(createChat),
	uploadFile: createFnTool(uploadFile),
};

// or maybe this is better (so that we can use tool directly)
// im trying to think of how to remove the dependency on ai sdk
const fnToolOptions = initFnToolOptions({ createCtx });

export const tools = {
	createChat: tool(fnToolOptions(createChat)),
	uploadFile: tool(fnToolOptions(uploadFile)),
};

// or maybe even:
export const createChatTool = tool(fnToolOptions(createChat));
export const uploadFileTool = tool(fnToolOptions(uploadFile));
export const tools = { createChatTool, uploadFileTool };
```

### Usage: trigger.dev (FUTURE - ignore for now)

```ts
// tasks.ts
const createFnTask = initCreateFnTask({ createCtx });

export const createChatTask = createFnTask(createChat);
export const uploadFileTask = createFnTask(uploadFile);

// or maybe this is better (so that we can use task directly)
// im trying to think of how to remove the dependency on trigger.dev
const fnTaskOptions = initFnTaskOptions({ createCtx });

export const createChatTask = task(fnTaskOptions(createChat));
export const uploadFileTask = task(fnTaskOptions(uploadFile));
```
