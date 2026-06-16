# @davstack/fn-orpc

oRPC adapter for [`@davstack/fn`](https://www.npmjs.com/package/@davstack/fn). Turn a directly-callable `fn` into an [oRPC](https://orpc.unnoq.com/) procedure.

`@davstack/fn` is a transport-agnostic server-function convention. This package provides `initProcedureFactory`, which bridges an `fn` into an oRPC procedure while preserving the input/output types.

## Install

```bash
npm install @davstack/fn-orpc @davstack/fn @orpc/server zod
```

## Usage

```ts
import { os } from '@orpc/server';
import { createFn } from '@davstack/fn';
import { initProcedureFactory } from '@davstack/fn-orpc';
import { z } from 'zod';

// Build a factory bound to your oRPC builder.
// Use `os.$context<MyCtx>()` if your fns rely on a typed context.
const fnProcedure = initProcedureFactory(os);

// Define a transport-agnostic fn
const createChat = createFn({
	name: 'createChat',
	inputSchema: z.object({ title: z.string() }),
	handler: async ({ input }) => {
		return { id: 'chat_123', title: input.title };
	},
});

// Turn it into an oRPC procedure
const createChatProcedure = fnProcedure(createChat);

// A router is just a plain object of procedures
const router = {
	createChat: createChatProcedure,
};
```

The procedure's input and output types are preserved from the `fn`. oRPC has no
query/mutation distinction at the builder level, so the factory takes only the
`fn`. If you need OpenAPI metadata you can chain `.route(...)` on the result:

```ts
const createChatProcedure = fnProcedure(createChat).route({
	method: 'POST',
	path: '/chats',
});
```

When the `fn` declares an `outputSchema`, it is forwarded to oRPC's `.output(...)`
so responses are validated as well.
