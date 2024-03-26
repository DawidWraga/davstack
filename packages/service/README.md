# Davstack Service

Davstack Service is beautifly simple and flexible typescript library for building backend services for your applications.

The fluent API is heavily inspired by the [tRPC](https://trpc.io/) procedure builder, providing an extremely intuitive and familiar DX.

The key difference is that Davstack Service is a **service** builder, which provides some distinct advantages.

### Why Use Davstack Service?

Davstack service provides a structured service builder, decoupling your _service logic_ (eg database read/write operations), from the _transport layer_ (eg REST or tRPC APIs). This has several benefits:

- **Full Reusability**: Services can be called directly from anywhere in your backend, including within other services, without the overhead of unnecessary API calls. This allows for more modular and reusable backend logic.

- **Flexible & Portable**: Services are lightweight wrappers around typescript functions, so they can be integrated into any backend eg Next.js server components / actions.

- **Fully Featured**: Get the best of tRPC - fully type safety, input/output parsing, middlewares - without the limitations of having to define everything in a single procedure, or build your own service layer from scratch.

- **Seamless Integration with tRPC**: Davstack Service is built to complement tRPC. You can easily turn your services into tRPC procedures / routers with 0 boilerplate.

### Installation

```bash
npm install zod @davstack/service
```

Visit the [DavStack Service Docs](https://davstack.com/service/overview) for more information and examples, such as this [trpc usage example](https://davstack.com/service/trpc-usage-example).

### Defining a Service

Define a service by specifying the input schema, output schema, and resolver function.

```typescript
import { service } from '@davstack/service';
import { z } from 'zod';

const getTasks = service()
	.input(z.object({ projectId: z.string() }))
	.output(z.array(z.object({ id: z.string(), title: z.string() })))
	.query(async ({ ctx, input }) => {
		// Complex logic to fetch tasks based on projectId
		return tasks;
	});
```

### Direct Service Usage

Invoke your services directly with type-safe calls.

```typescript
const projectId = '123';
const tasks = await getTasks({ projectId });
```

### Reusing Services

Reuse schemas and functions across multiple services.

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
		const project = await db.getProjectById(input.projectId);
		const tasks = await getTasks({ projectId: input.projectId });
		return { ...project, tasks };
	});
```

### Using Middleware

Middleware allows you to perform common tasks like authentication, authorization, and error handling. You can add middleware to your services using the `use` method.

```ts filename="service.ts"
export type ServiceContext = {
	user?: { id: string; role: string };
};

export const publicService = service<ServiceContext>();

const protectedService = service<Required<ServiceContext>>().use(
	async ({ ctx, next }) => {
		if (!ctx.user) {
			throw new Error('Unauthorized');
		}
		return next();
	}
);
```

```ts filename="usage.ts"
export const publicService = publicService().query(async ({ ctx }) => {
	return 'Public data';
});

export const protectedService = protectedService().query(async ({ ctx }) => {
	return 'Protected data';
});
```

### tRPC Integration

Seamlessly integrate with tRPC to create type-safe API endpoints.

```ts
import { initTRPC } from '@trpc/server';
import { createTrpcRouterFromServices } from '@davstack/service';
import * as taskServices from './services/tasks';
import * as projectServices from './services/projects';

const t = initTRPC();

const appRouter = t.router({
	tasks: createTrpcRouterFromServices(taskServices),
	projects: createTrpcRouterFromServices(projectServices),
});
```

NOTE: it is recommended to use the `* as yourServicesName` syntax. Otherwise, ctrl+click on the tRPC client handler will navigate you to the app router file, instead of the specific service definition.

### Acknowledgements

Davstack Store has been heavily inspired by [tRPC](https://trpc.io/), a fantastic library for building type-safe APIs. A big shout-out to the tRPC team for their amazing work.

Nick-Lucas, a tRPC contributor, inspired the creation of Davstack Service with his [github comment](https://github.com/trpc/trpc/discussions/4839#discussioncomment-8224476). He suggested "making controllers minimal" and "to separate your business logic from the API logic", which is exactly what Davstack Service aims to do.

### Contributing

Contributions are welcome! Please read our [contributing guide](link-to-contributing-guide) for details on our code of conduct and the submission process.

### License

This project is licensed under the [MIT License](link-to-license). See the LICENSE file for details.
