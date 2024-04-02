# Davstack Service

Davstack Service is beautifly simple and flexible library for building backend services with TypeScript.

The API is heavily inspired by the [tRPC](https://trpc.io/) procedure builder, providing an extremely intuitive and familiar DX.

The key difference is that Davstack Service is a **service** builder, not a procedure API builder.

### Why Use Davstack Service?

- **Full Reusability**: Services can be called directly from anywhere in your backend, including within other services, without the overhead of unnecessary API calls.

- **Flexible & Portable**: Services are lightweight wrappers around typescript functions, so they can be integrated into any backend eg Next.js server components / actions and support broad range of content types (eg files, streams, etc).

- **Seamless Integration with tRPC**: Davstack Service is built to complement tRPC. You can easily turn your services into tRPC procedures / routers with 0 boilerplate.

### Installation

```bash
npm install zod @davstack/service
```

Visit the [DavStack Service Docs](https://davstack.com/service/overview) for more information and examples, such as this [trpc usage example](https://davstack.com/service/trpc-usage-example).

### Demo Usage

```ts
// api/services/invoice.ts
import { authedService, publicService } from '@/lib/service';

// Service composed from range of other services:

export const mailAiGeneratedInvoice = authedService
	.input(z.object({ to: z.string(), projectId: z.string() }))
	.query(async ({ ctx, input }) => {
		// each service is called directly, no API calls
		await checkSufficientCredits(ctx, { amount: 10 });

		// The inputs / outputs are type safe and validated by Zod
		const pdf = await generatePdf(ctx, { html: project.invoiceHtml });

		// Services are just functions - so no limitaitons of content types (eg files, streams, etc, can be passed around easily)
		await sendEmail(ctx, {
			to: input.to,
			subject: 'Invoice',
			body: 'Please find attached your invoice',
			attachments: [{ filename: 'invoice.pdf', content: pdf }],
		});

		await deductCredits(ctx, { amount: 10 });

		return 'Invoice sent';
	});

// Each service is a small, reusable function
// Easy to test, easy to understand, easy to maintain

export const generatePdf = authedService
	.input(z.object({ html: z.string() }))
	.query(async ({ ctx, input }) => {
		// complex business logic here
		return pdf;
	});

export const sendEmail = authedService
	.input(z.object({ to: z.string(), subject: z.string(), body: z.string() }))
	.query(async ({ ctx, input }) => {
		// complex business logic here
		return 'Email sent';
	});

export const checkSufficientCredits = authedService
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

## Getting Started

### Set up services in your project

Define your services in a separate file, and export them for use in your backend.

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
export const publicService = service<PublicServiceCtx>();

export const authedService = service<AuthedServiceCtx>().use(
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

### Defining a Service

Import the public / authed service builders from the service file, and define your services. You can use the `query` or `mutation` methods to define the service function.

```ts
// api/services/some-service.ts
import { publicService, authedService } from '@/lib/service';

export const getSomePublicData = publicService.query(async ({ ctx }) => {
	return 'Public data';
});

export const getSomeUserData = authedService.query(async ({ ctx }) => {
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

### Using Services

### Direct Service Usage

Unlike tRPC procedures, services can be called directly from anywhere in your backend, including within other services.

```typescript
const ctx = createServiceCtx();
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

# Comparison with tRPC

## Similarities

The fluent API is heavily inspired by the [tRPC](https://trpc.io/) procedure builder, providing an extremely intuitive and familiar DX.

Services still have access to ctx from middleware, use input/output schemas, and outputs can also be inferred from the query/mutation function, just like tRPC.

## Differences

The key difference is that Davstack Service is a **service** builder, not a procedure API builder.

This brings several benefits by decoupling your _service logic_ (eg database read/write operations), from the _transport layer_ (eg REST or tRPC APIs).

### Acknowledgements

Davstack Store has been heavily inspired by [tRPC](https://trpc.io/), a fantastic library for building type-safe APIs. A big shout-out to the tRPC team for their amazing work.

Nick-Lucas, a tRPC contributor, inspired the creation of Davstack Service with his [github comment](https://github.com/trpc/trpc/discussions/4839#discussioncomment-8224476). He suggested "making controllers minimal" and "to separate your business logic from the API logic", which is exactly what Davstack Service aims to do.

### Contributing

Contributions are welcome! Please read our [contributing guide](link-to-contributing-guide) for details on our code of conduct and the submission process.

### License

This project is licensed under the [MIT License](link-to-license). See the LICENSE file for details.
