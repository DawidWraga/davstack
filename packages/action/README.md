# Davstack Action

Davstack Action is a simple and flexible library for building backend services with TypeScript. It is designed to work seamlessly with Next.js server actions and tRPC.

### Why Use Davstack Action?

- ⚡️ Super Simple API with zero boiler plate
- 🔋 Batteries included - input/output parsing, auth middlewares, file uploads
- 🏠 Simple and familiar syntax, works well with react query and react hook form
- ✅ TypeScript-first - inputs, outputs and middleware are inferred

### Installation

```bash
npm install zod @davstack/action
```

Visit the [DavStack Action Docs](https://davstack.com/action/overview) for more information and examples.

## Demo Usage

### Defining Actions

Import the public/authed action builders from the action file, and define your actions. You can use the `query` or `mutation` methods to define the action function.

```ts
// api/actions/todo-actions.ts
'use server';
import { authedAction } from '@/lib/action';
import { z } from 'zod';

export const getTodos = authedAction.query(async ({ ctx }) => {
	return ctx.db.todo.findMany({
		where: {
			createdBy: { id: ctx.user.id },
		},
	});
});

export const createTodo = authedAction
	.input({ name: z.string().min(1) })
	.mutation(async ({ ctx, input }) => {
		return ctx.db.todo.create({
			data: {
				name: input.name,
				createdBy: { connect: { id: ctx.user.id } },
			},
		});
	});

export const updateTodo = authedAction
	.input({
		id: z.string(),
		completed: z.boolean().optional(),
		name: z.string().optional(),
	})
	.mutation(async ({ ctx, input }) => {
		const { id, ...data } = input;
		return ctx.db.todo.update({
			where: { id },
			data,
		});
	});

export const deleteTodo = authedAction
	.input({ id: z.string() })
	.mutation(async ({ ctx, input }) => {
		return ctx.db.todo.delete({ where: { id: input.id } });
	});
```

### Using Actions

#### Direct usage

Actions can also be called safely from the frontend without the need to provide the `ctx` manually.

```typescript
const todos = await getTodos();
```

Safe calls will run the defined middleware and parse the inputs/outputs based on the specified schemas.

This means that inputs and auth states will be validate with very little boilerplate.

#### Frontend Usage with React Query

Here's an example of using actions in a frontend component with React Query:

```tsx
// components/TodoList.tsx
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
	createTodo,
	deleteTodo,
	getTodos,
	updateTodo,
} from '@/app/actions/todo';

export function TodosList() {
	const {
		data: todos,
		isPending,
		error,
	} = useQuery({
		queryKey: ['todos'],
		queryFn: () => getTodos(),
	});

	// ...

	return (
		<div className="flex flex-col gap-1 py-4">
			{todos.map((todo) => (
				<TodoItem key={todo.id} todo={todo} />
			))}
		</div>
	);
}

function TodoItem({ todo }) {
	return (
		<div className="flex items-center gap-2 border border-gray-500 p-1">
			<input
				checked={todo.completed}
				onChange={(e) => {
					updateTodo({ id: todo.id, completed: e.target.checked }).then(
						invalidateTodos
					);
				}}
				type="checkbox"
				name={todo.name}
			/>
			<label htmlFor={todo.name} className="flex-1">
				{todo.name}
			</label>
			<button
				onClick={() => {
					deleteTodo({ id: todo.id }).then(invalidateTodos);
				}}
			>
				Delete
			</button>
		</div>
	);
}

function CreateTodoForm() {
	const [name, setName] = useState('');

	const createTodoMutation = useMutation({
		mutationFn: createTodo,
		onSuccess: () => {
			invalidateTodos();
			setName('');
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				createTodoMutation.mutate({ name });
			}}
			className="flex"
		>
			<input
				type="text"
				placeholder="Enter todo name"
				value={name}
				onChange={(e) => setName(e.target.value)}
				className="w-full rounded-full px-2 py-1 text-black"
			/>
			<button
				type="submit"
				className="rounded-full bg-white/10 px-2 py-1 font-semibold transition hover:bg-white/20"
				disabled={createTodoMutation.isPending}
			>
				{createTodoMutation.isPending ? 'loading' : 'add'}
			</button>
		</form>
	);
}
```

### Defining middlwares / auth protected actions

Define your actions in a separate file, and export them for use in your backend.

```ts
// lib/action.ts
import { getServerAuthSession } from '@/lib/auth';
import { db } from '@/lib/db';
import { action } from '@davstack/action';
import { type User } from 'next-auth';

export const createActionCtx = async () => {
	const session = await getServerAuthSession();
	const user = session?.user;
	return { db, user };
};

export type PublicActionCtx = {
	user?: User;
	db: typeof db;
};

export const publicAction = action<PublicActionCtx>().use(
	async ({ ctx, next }) => {
		const nextCtx = await createActionCtx();
		return next({
			...ctx,
			...nextCtx,
		});
	}
);

export type AuthedActionCtx = {
	user: User;
	db: typeof db;
};

export const authedAction = action<AuthedActionCtx>().use(
	async ({ ctx, next }) => {
		const nextCtx = await createActionCtx();

		if (!nextCtx.user) {
			throw new Error('Unauthorized');
		}
		return next({
			...ctx,
			...nextCtx,
			user: nextCtx.user as User,
		});
	}
);
```

### File uploads

##### Frontend

```tsx
'use client';
import { objectToFormData } from '@davstack/action';
import { uploadFile } from './file.action';

export default function UploadFileViaActionCall() {
	return (
		<button
			onClick={async () => {
				const file = new Blob([], { type: 'text/plain' });
				await uploadFile(objectToFormData({ file }));
			}}
		>
			upload via direct action call
		</button>
	);
}
```

##### Backend

```ts
// file.action.ts
'use server';
import { action, zodFile } from '@davstack/action';

export const uploadFile = action()
	.input({
		file: zodFile({ type: 'image/*' }),
	})
	.mutation(async ({ input, ctx }) => {
		console.log('FILE UPLOADING! ', { input, ctx });
	});
```

See the docs for more info

### Direct Action Usage

You can call an action WITHOUT invoking the middleware or input/output parsing

This is useful for composing actions together without unnecessarily validating auth state

```typescript
export const mailAiGeneratedInvoice = authedService
	.input({ to: z.string(), projectId: z.string() })
	.query(async ({ ctx, input }) => {
		await checkSufficientCredits.raw(ctx, { amount: 10 });

		const project = await getProject.raw(ctx, { id: input.projectId });
		const pdf = await generatePdf.raw(ctx, { html: project.invoiceHtml });

		await sendEmail.raw(ctx, {
			to: input.to,
			attachments: [pdf],
		});

		await deductCredits(ctx, { amount: 10 });

		return 'Invoice sent';
	});
```

### Contributing

Contributions are welcome! Please read our [contributing guide](link-to-contributing-guide) for details on our code of conduct and the submission process.

### License

This project is licensed under the [MIT License](link-to-license). See the LICENSE file for details.
