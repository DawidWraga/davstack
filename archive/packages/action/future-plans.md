CURRENT SITATION:

```tsx

// todo-page.tsx
export function TodosList() {
  const {
    data: todos,
    isPending,
    error,
  } = useQuery({
    queryKey: ["todos"],
    queryFn: () => getTodos(),
  });


  return (/* ... */)
}

const invalidateTodos = () =>
  queryClient?.invalidateQueries({ queryKey: ["todos"] });


function CreateTodoForm() {
  const [name, setName] = useState("");

  const createTodoMutation = useMutation({
    mutationFn: createTodo,
    onSuccess: () => {
      invalidateTodos();
      setName("");
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        createTodoMutation.mutate({ name });
      }}
      className="flex  "
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
        {createTodoMutation.isPending ? "loading" : "add"}
      </button>
    </form>
  );
}


// todo-actions.ts
"use server";

import { unstable_cache } from 'next/cache';
import { authedAction } from "@/lib/action";
import { revalidatePath } from "next/cache";
import { z } from "zod";

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
    return ctx.db.todo
      .create({
        data: {
          name: input.name,
          createdBy: { connect: { id: ctx.user.id } },
        },
      })
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

- invalidating react query cache is a bit of a pain

ideal API:

```ts
export const createTodo = authedAction
	.meta({ tags: ['todo', 'create'] })
	.input({ name: z.string().min(1) })
	.mutation(async ({ ctx, input }) => {
		return ctx.db.todo.create({
			data: {
				name: input.name,
				createdBy: { connect: { id: ctx.user.id } },
			},
		});
	});

export const getTodos = authedAction
	.meta({ tags: ['todo', 'get'] })
	.query(async ({ ctx }) => {
		return ctx.db.todo.findMany({
			where: {
				createdBy: { id: ctx.user.id },
			},
		});
	});
```

- inputs should autioamtically be part of query keys
- when mutation and mathcing tags should invalidate the query
- coudld either invlaidate react query (cause refetch but then double request) or invalidate next query (fewer requests but less table)

could currently achieve his using revalidate tags nextjs api

https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations#fetch-optionsnexttags-and-revalidatetag

however the tags can only be placed on the fetch funtion OR by suing unstable_cache (see https://nextjs.org/docs/app/api-reference/functions/unstable_cache)

given its unstable right now avoiding until it becomes stable

could try to found a work around with react query but reallity itsno t a big enough issue

by just exporting the react query singleton can use it across your app without calling hook and then just call invalidateQueries it's not that big a deal
