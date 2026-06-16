# @davstack/fn-trpc

tRPC adapter for [`@davstack/fn`](https://www.npmjs.com/package/@davstack/fn). Turn a directly-callable `fn` into a tRPC procedure.

`@davstack/fn` is a transport-agnostic server-function convention. This package provides `initProcedureFactory`, which bridges an `fn` into a tRPC `query` or `mutation` procedure while preserving the input/output types.

## Install

```bash
npm install @davstack/fn-trpc @davstack/fn @trpc/server zod
```

## Usage

```ts
import { initTRPC } from '@trpc/server';
import { createFn } from '@davstack/fn';
import { initProcedureFactory } from '@davstack/fn-trpc';
import { z } from 'zod';

const t = initTRPC.create();

// Build a factory bound to your base procedure
const fnProcedure = initProcedureFactory(t.procedure);

// Define a transport-agnostic fn
const createChat = createFn({
	name: 'createChat',
	inputSchema: z.object({ title: z.string() }),
	handler: async ({ input }) => {
		return { id: 'chat_123', title: input.title };
	},
});

// Turn it into a tRPC procedure
const createChatProcedure = fnProcedure(createChat, 'mutation');

// Use it in a router
const appRouter = t.router({
	createChat: createChatProcedure,
});
```

Pass `'query'` instead of `'mutation'` to produce a query procedure.
