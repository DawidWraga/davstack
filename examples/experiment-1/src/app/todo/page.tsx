/* eslint-disable @typescript-eslint/consistent-type-imports */
"use client";
import { apiUtils } from "@/api/react";
import { createStore } from "@davstack/store";
import { PersistStorage } from "zustand/middleware";

type Todo = {
  id: string;
  name: string;
  completed: boolean;
};

const customStorage: PersistStorage<{ todos: Todo[] }> = {
  getItem: (name) => {
    console.log(name, "has been retrieved");
    return null;
  },
  setItem: async (name, value) => {
    // console.log(name, "with value \n", value, "\nhas been saved");

    const todos = value.state.todos;

    console.log("todos saved:", todos);

    // try {
    //   console.log("apiUtils:", apiUtils);

    //   const res = await apiUtils?.client.todo.syncLocalTodosToDb.mutate({
    //     todos,
    //   });

    //   console.log("res:", res);
    // } catch (e) {
    //   console.log("error:", e);
    // }
  },
  removeItem: async (name) => {
    console.log(name, "has been deleted");
  },
};
export const todoStore = createStore(
  {
    // Only need to cast the default value if the type can't be inferred
    todos: [] as Todo[],
  },
  {
    persist: {
      enabled: true,
      name: "todo-storage",
      storage: customStorage,
      // storage: createJSONStorage(() => customStorage),
      // Add any additional persist options here
    },
  },
).extend((store) => ({
  addTodo(name: string) {
    // .set method uses immer, so we can mutate the draft while keeping state immutable
    store.set((draft) => {
      draft.todos.push({
        id: Date.now().toString(),
        name,
        completed: false,
      });
    });
  },
  toggleTodo(id: string) {
    store.set((draft) => {
      const todo = draft.todos.find((todo) => todo.id === id);
      if (todo) {
        todo.completed = !todo.completed;
      }
    });
  },
  deleteTodo(id: string) {
    store.set((draft) => {
      const index = draft.todos.findIndex((todo) => todo.id === id);
      if (index !== -1) {
        draft.todos.splice(index, 1);
      }
    });
  },
}));

function TodoItems() {
  const todos = todoStore.todos.use();

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id} className="mb-4">
          <label className="flex items-center">
            <input
              type="checkbox"
              checked={todo.completed}
              onChange={() => todoStore.toggleTodo(todo.id)}
              className="mr-2"
            />
            <span className={todo.completed ? "line-through" : ""}>
              {todo.name}
            </span>
          </label>
          <button
            onClick={() => todoStore.deleteTodo(todo.id)}
            className="ml-4 text-red-500"
          >
            Delete
          </button>
        </li>
      ))}
    </ul>
  );
}

const todoFormStore = createStore({
  todoText: "",
});

function NewTodoForm() {
  const todoText = todoFormStore.todoText.use();

  return (
    <form
      onSubmit={(ev) => {
        ev.preventDefault();
        if (!todoText.trim()) return;
        // Add a new todo
        todoStore.addTodo(todoText.trim());
        // Clear the input
        todoFormStore.todoText.set("");
      }}
      className="mb-8"
    >
      <input
        type="text"
        value={todoText}
        onChange={(e) => todoFormStore.todoText.set(e.target.value)}
        placeholder="Enter a new todo"
        className="mr-4 rounded border border-gray-300 px-4 py-2"
      />
      <button
        type="submit"
        className="rounded bg-blue-500 px-4 py-2 text-white"
      >
        Add Todo
      </button>
    </form>
  );
}

export default function TodoPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-8 text-4xl font-bold">Todo App</h1>
      <NewTodoForm />
      <TodoItems />
    </div>
  );
}
