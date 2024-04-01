"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/api/react";
import { useSession } from "next-auth/react";
import { type Todo } from "@prisma/client";

export interface CrudDemoProps {}

export function CrudDemo(props: CrudDemoProps) {
  const { ...passThroughProps } = props;
  const { data: session } = useSession();
  const isAuthed = !!session?.user;

  if (!isAuthed) return <>Sign in to see crud demo</>;

  return (
    <div className="w-full max-w-xs" {...passThroughProps}>
      <CreateTodoForm />
      <TodosList />
    </div>
  );
}
export interface TodosListProps {}

export function TodosList(props: TodosListProps) {
  const { data: todos, isPending, error } = api.todo.getTodos.useQuery();

  if (error) {
    return (
      <div className="rounded bg-red-500 p-4 text-white">
        <p className="font-bold">Error</p>
        <pre>{JSON.stringify(error, null, 4)}</pre>
      </div>
    );
  }

  if (isPending) {
    return <p>Loading...</p>;
  }

  if (!todos.length) {
    return <p>No todos yet</p>;
  }

  return (
    <>
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </>
  );
}

function TodoItem({ todo }: { todo: Todo }) {
  const apiUtils = api.useUtils();
  const apiClient = apiUtils.client;

  return (
    <div className="flex items-center gap-2">
      <input
        aria-label={`todo is ${todo.completed ? "completed" : "not completed"} `}
        type="checkbox"
        checked={todo.completed}
        onChange={(e) => {
          apiClient.todo.updateTodo.mutate({
            id: todo.id,
            completed: e.target.checked,
          });
        }}
      />
      <span>{todo.name}</span>
      <button
        onClick={() => {
          apiClient.todo.deleteTodo.mutate({ id: todo.id });
        }}
      >
        Delete
      </button>
    </div>
  );
}

function CreateTodoForm() {
  const router = useRouter();
  const [name, setName] = useState("");

  const apiUtils = api.useUtils();

  const createTodo = api.todo.createTodo.useMutation({
    onSuccess: () => {
      apiUtils.todo.getTodos.invalidate();
      setName("");
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        createTodo.mutate({ name });
      }}
      className="flex flex-col gap-2"
    >
      <input
        type="text"
        placeholder="Title"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-full px-4 py-2 text-black"
      />
      <button
        type="submit"
        className="rounded-full bg-white/10 px-10 py-3 font-semibold transition hover:bg-white/20"
        disabled={createTodo.isPending}
      >
        {createTodo.isPending ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
