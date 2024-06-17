/* eslint-disable @typescript-eslint/no-floating-promises */
"use client";
import { useState } from "react";

import { api, queryClient } from "@/api/react";
import { type Todo } from "@prisma/client";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTodo,
  deleteTodo,
  getTodos,
  updateTodo,
} from "@/app/with-server-actions/actions";

export interface CrudDemoProps {}

export default function WithServerActionsPage(props: CrudDemoProps) {
  const { ...passThrough } = props;

  const { data: session } = useSession();
  const isAuthed = !!session?.user;

  if (!isAuthed) return <>Sign in to see crud demo</>;

  return (
    <div className="mx-auto mt-10 w-full max-w-lg" {...passThrough}>
      <CreateTodoForm />
      <TodosList />
    </div>
  );
}
export interface TodosListProps {}

export function TodosList(props: TodosListProps) {
  const {
    data: todos,
    isPending,
    error,
  } = useQuery({
    queryKey: ["todos"],
    queryFn: () => getTodos(),
  });

  if (error) {
    return (
      <div className="rounded bg-red-500 p-4 text-white">
        <p className="font-bold">Error</p>
        <p>{error.message}</p>
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
    <div className="flex flex-col gap-1 py-4">
      {todos.map((todo) => (
        <TodoItem key={todo.id} todo={todo} />
      ))}
    </div>
  );
}

const invalidateTodos = () =>
  queryClient?.invalidateQueries({ queryKey: ["todos"] });

function TodoItem({ todo }: { todo: Todo }) {
  return (
    <div className={"flex items-center gap-2 border border-gray-500 p-1 "}>
      <input
        checked={todo.completed}
        onChange={(e) => {
          updateTodo({ id: todo.id, completed: e.target.checked }).then(
            invalidateTodos,
          );
        }}
        aria-label={`todo is ${todo.completed ? "completed" : "not completed"} `}
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
