# Davstack Action

Davstack Action is simple and flexible library for building backend services with TypeScript.

### Why Use Davstack Action?

- 🏠 Simple and familiar syntax - middleware, input and outputs inspired by trpc procedures
- 🧩 Flexible - Works well with next js server actions as well as trpc
- ✅ Typescript first - inferred input/output types and middleware

### Installation

```bash
npm install zod @davstack/service
```

Visit the [DavStack Action Docs](https://davstack.com/service/overview) for more information and examples, such as this [trpc usage example](https://davstack.com/service/trpc-usage-example).

## Demo Usage

- The service definition replaces tRPC procedures, but the syntax is very similar.
- Once the service is integrated into tRPC routers, the API is the same as any other tRPC router.

## directly calling service example

```tsx
export const generatePdf = authedAction
	.input(z.object({ html: z.string() }))
	.query(async ({ ctx, input }) => {
		// complex business logic here
		return pdf;
	});

/**
 * safe call  eg from front end (usign nextjs server actions)
 * - will run authed middleware
 * - will parse inputs/outputs if defined
 */
const pdf = await generatePdf({ html: '...' });

/**
 * raw call eg from backend such inside another action
 * - will NOT run middlweare
 * - will NOT parse inputs/outputs
 */
const pdf = await generatePdf.raw(ctx, { html: '...' });
```

## Composing Services example

```ts
// api/services/invoice.ts
import { authedAction, publicAction } from '@/lib/service';

// Action composed from range of other services:

export const mailAiGeneratedInvoice = authedAction
	.input(z.object({ to: z.string(), projectId: z.string() }))
	.query(async ({ ctx, input }) => {
		await checkSufficientCredits(ctx, { amount: 10 });

		const pdf = await generatePdf(ctx, { html: project.invoiceHtml });

		await sendEmail(ctx, {
			to: input.to,
			subject: 'Invoice',
			body: 'Please find attached your invoice',
			attachments: [{ filename: 'invoice.pdf', content: pdf }],
		});

		await deductCredits(ctx, { amount: 10 });

		return 'Invoice sent';
	});

export const generatePdf = authedAction
	.input(z.object({ html: z.string() }))
	.query(async ({ ctx, input }) => {
		// complex business logic here
		return pdf;
	});

export const sendEmail = authedAction
	.input(z.object({ to: z.string(), subject: z.string(), body: z.string() }))
	.query(async ({ ctx, input }) => {
		// complex business logic here
		return 'Email sent';
	});

export const checkSufficientCredits = authedAction
	.input(z.object({ amount: z.number() }))
	.query(async ({ ctx, input }) => {
		// complex business logic here
		return 'Sufficient funds';
	});

// ... etc
```

Integrate your services with tRPC with 0 boilerplate. Works just like any other tRPC router.

```ts
// api/router.ts

import * as invoiceServices from '@/api/services/invoice';
import { createTRPCRouter } from '@/lib/trpc';
import {
	createTrpcProcedureFromService,
	createTrpcRouterFromServices,
} from '@davstack/service';

export const appRouter = createTRPCRouter({
	invoice: createTrpcRouterFromServices(invoiceServices),
});
```

### Middleware Example

Define your services with reusable middleware in a separate file, and export them for reuse.

```ts
// lib/service.ts
import { service } from '@davstack/service';
import { db } from '@/lib/db';

// Define the context types for your services
export type PublicServiceCtx = {
	user: { id: string; role: string } | undefined;
	db: typeof db;
};
export type AuthedServiceCtx = Required<PublicServiceCtx>;

// export your services
export const publicAction = service<PublicServiceCtx>();

export const authedAction = service<AuthedServiceCtx>().use(
	async ({ ctx, next }) => {
		// Only allows authenticate users to access this service
		if (!ctx.user) {
			throw new Error('Unauthorized');
		}
		return next(ctx);
	}
);

export function createServiceCtx() {
	const user = auth();
	return { user, db };
}
```

Import the public / authed service builders from the service

```ts
// api/services/some-service.ts
import { publicAction, authedAction } from '@/lib/service';

export const getSomePublicData = publicAction.query(async ({ ctx }) => {
	return 'Public data';
});

export const getSomeUserData = authedAction.query(async ({ ctx }) => {
	// will throw an error if ctx.user is undefined
	return 'Protected data';
});
```

Specify the input and output schemas for your service for validation and type safety, and use the ctx/input arguments to access the service context and input data.

```ts
// api/services/task-services.ts
import { service } from '@davstack/service';
import { z } from 'zod';

const getTasks = service()
	.input(z.object({ projectId: z.string() }))
	.query(async ({ ctx, input }) => {
		return ctx.db.tasks.findMany({ where: { projectId: input.projectId } });
	});
```

### Direct Action Usage

Unlike tRPC procedures, services can be called directly from anywhere in your backend, including within other services.

```typescript
const ctx = createServiceCtx(); // or get ctx from parent service
const tasks = await getTasks(ctx, { projectId: '...' });
```

This allows you to build complex service logic by composing multiple services together.

```typescript
const getProjectDetails = service()
	.input(z.object({ projectId: z.string() }))
	.output(
		z.object({
			id: z.string(),
			name: z.string(),
			tasks: getTasks.outputSchema,
		})
	)
	.query(async ({ ctx, input }) => {
		const project = await getProject(ctx, { projectId: input.projectId });
		const tasks = await getTasks(ctx, { projectId: input.projectId });
		return { ...project, tasks };
	});
```

### tRPC Integration

Seamlessly integrate with tRPC to create type-safe API endpoints.

```ts
import { initTRPC } from '@trpc/server';
import { createTrpcRouterFromServices } from '@davstack/service';
import * as taskServices from './services/tasks';
import * as projectServices from './services/projects';
import { sendFeedback } from './services/send-feedback';

const t = initTRPC();

const appRouter = t.router({
	tasks: createTrpcRouterFromServices(taskServices),
	projects: createTrpcRouterFromServices(projectServices),
	// or create a single procedure from a service
	sendFeedback: createTrpcProcedureFromService(sendFeedback),
});
```

NOTE: it is recommended to use the `* as yourServicesName` syntax. Otherwise, ctrl+click on the tRPC client handler will navigate you to the app router file, instead of the specific service definition.

### Acknowledgements

Davstack Store has been heavily inspired by [tRPC](https://trpc.io/), a fantastic library for building type-safe APIs. A big shout-out to the tRPC team for their amazing work.

Nick-Lucas, a tRPC contributor, inspired the creation of Davstack Action with his [github comment](https://github.com/trpc/trpc/discussions/4839#discussioncomment-8224476). He suggested "making controllers minimal" and "to separate your business logic from the API logic", which is exactly what Davstack Action aims to do.

### Contributing

Contributions are welcome! Please read our [contributing guide](link-to-contributing-guide) for details on our code of conduct and the submission process.

### License

This project is licensed under the [MIT License](link-to-license). See the LICENSE file for details.
