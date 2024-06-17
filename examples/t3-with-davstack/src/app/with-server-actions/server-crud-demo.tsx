import { api } from "@/api/react-ssr";
import { getTodos } from "@/app/server-actions/actions";
import { createServiceContext } from "@/lib/service";
import { type Todo } from "@prisma/client";

export interface TodosListProps {
  todosPromise: Promise<Todo[]>;
}

export async function TodosList(props: TodosListProps) {
  const todos = await props.todosPromise;
  // const todos = await api.todo.getTodos();

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
  return (
    <div className={"flex items-center gap-2 border border-gray-500 p-1 "}>
      <input
        // checked={updateTodo.variables?.completed ?? todo.completed}
        checked={todo.completed}
        onChange={async (e) => {
          await api.todo.updateTodo({
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
        onClick={async () => {
          await api.todo.deleteTodo({ id: todo.id });
        }}
      >
        Delete
      </button>
    </div>
  );
}
