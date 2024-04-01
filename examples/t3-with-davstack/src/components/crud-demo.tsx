/* eslint-disable @typescript-eslint/no-floating-promises */
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/api/react";
import { useSession } from "next-auth/react";
import { type Todo } from "@prisma/client";
import { useMutationState } from "@tanstack/react-query";

export interface CrudDemoProps {}

export function CrudDemo(props: CrudDemoProps) {
  const { ...passThrough } = props;

  const { data: session } = useSession();
  const isAuthed = !!session?.user;

  if (!isAuthed) return <>Sign in to see crud demo</>;

  return (
    <div className="w-full max-w-xs" {...passThrough}>
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

function TodoItem({ todo }: { todo: Todo }) {
  const apiUtils = api.useUtils();
  const updateTodo = api.todo.updateTodo.useMutation({
    onSettled: () => {
      apiUtils.todo.getTodos.invalidate();
    },
  });

  const deleteTodo = api.todo.deleteTodo.useMutation({
    onSettled: () => {
      apiUtils.todo.getTodos.invalidate();
    },
  });

  if (deleteTodo.isPending || deleteTodo.variables?.id === todo.id) {
    return null;
  }

  return (
    <div className={"flex items-center gap-2 border border-gray-500 p-1 "}>
      <input
        checked={updateTodo.variables?.completed ?? todo.completed}
        onChange={(e) => {
          updateTodo.mutate({
            id: todo.id,
            completed: e.target.checked,
          });
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
          deleteTodo.mutate({ id: todo.id });
        }}
      >
        Delete
      </button>
    </div>
  );
}

function CreateTodoForm() {
  const [name, setName] = useState("");

  const apiUtils = api.useUtils();

  const createTodo = api.todo.createTodo.useMutation({
    onSuccess: () => {
      apiUtils.todo.getTodos.invalidate();
      setName("");
    },
    mutationKey: ["addTodo"],
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        createTodo.mutate({ name });
      }}
      className="flex  "
    >
      <input
        type="text"
        placeholder="Title"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full rounded-full px-2 py-1 text-black"
      />
      <button
        type="submit"
        className="rounded-full bg-white/10 px-2 py-1 font-semibold transition hover:bg-white/20"
        disabled={createTodo.isPending}
      >
        {createTodo.isPending ? "loading" : "add"}
      </button>
    </form>
  );
}
