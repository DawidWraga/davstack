"use client";
/* eslint-disable @typescript-eslint/no-floating-promises */
import { Suspense, useState } from "react";

import { api } from "@/api/react-ssr";
import { type Todo } from "@prisma/client";
import { useSession } from "next-auth/react";
import { getTodos } from "@/app/server-actions/actions";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import { TodosList } from "@/app/server-actions/server-crud-demo";

/**
 * This is the client side for a todo application.
 *
 * IMPORTANT: This is **THE EXACT SAME** as using regular tRPC + react query. Davstack store does not make any changes to regular tRPC usage.
 *
 * The only difference that Davstack store makes is how you define the tRPC router
 * (@see api folder)
 */

export interface ServerCrudDemoClientProps {
  todosPromise: Promise<Todo[]>;
}

export function ServerCrudDemoClient(props: ServerCrudDemoClientProps) {
  const { todosPromise, ...passThrough } = props;

  // const { data: session } = useSession();
  // const isAuthed = !!session?.user;

  // if (!isAuthed) return <>Sign in to see crud demo</>;

  return (
    <div className="w-full max-w-xs" {...passThrough}>
      <CreateTodoForm />

      <Suspense fallback={<p>Loading...</p>}>
        <TodosList />
      </Suspense>
    </div>
  );
}

function CreateTodoForm() {
  const [name, setName] = useState("");

  return (
    <form
      // onSubmit={async (e) => {

      //   await api.todo.createTodo({ name });
      //   // createTodo.mutate({ name });
      // }}
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
        // disabled={createTodo.isPending}
        onClick={async () => {
          await api.todo.createTodo({ name });
        }}
      >
        add
        {/* {createTodo.isPending ? "loading" : "add"} */}
      </button>
    </form>
  );
}
