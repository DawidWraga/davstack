'use client';
import { createStore } from '@davstack/store';
import { soundStore } from './sound-store';

type Todo = {
	id: number;
	text: string;
	completed: boolean;
};

export const todoStore = createStore({
	// Only need to cast the default value if the type can't be inferred
	todos: [] as Todo[],
}).extend((store) => ({
	addTodo(text: string) {
		soundStore.playSound('pop');
		// .set method uses immer, so we can mutate the draft while keeping state immutable
		store.set((draft) => {
			draft.todos.push({
				id: Date.now(),
				text,
				completed: false,
			});
		});
	},
	toggleTodo(id: number) {
		store.set((draft) => {
			const todo = draft.todos.find((todo) => todo.id === id);
			if (!todo) return;

			const newCompletedValue = !todo.completed;
			todo.completed = newCompletedValue;

			if (newCompletedValue) {
				soundStore.playSound('switchOn');
			} else {
				soundStore.playSound('switchOff');
			}
		});
	},
	deleteTodo(id: number) {
		store.set((draft) => {
			const index = draft.todos.findIndex((todo) => todo.id === id);
			const exists = index !== -1;
			if (!exists) return;

			soundStore.playSound('pop');
			draft.todos.splice(index, 1);
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
						<span className={todo.completed ? 'line-through' : ''}>
							{todo.text}
						</span>
					</label>
					<button
						onClick={() => todoStore.deleteTodo(todo.id)}
						className="text-red-500 ml-4"
					>
						Delete
					</button>
				</li>
			))}
		</ul>
	);
}

const todoFormStore = createStore({
	todoText: '',
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
				todoFormStore.todoText.set('');
			}}
			className="mb-8"
		>
			<input
				type="text"
				value={todoText}
				onChange={(e) => todoFormStore.todoText.set(e.target.value)}
				placeholder="Enter a new todo"
				className="border border-gray-300 rounded px-4 py-2 mr-4"
			/>
			<button
				type="submit"
				className="bg-blue-500 text-white rounded px-4 py-2"
			>
				Add Todo
			</button>
		</form>
	);
}

export default function TodoPage() {
	return (
		<div className="container mx-auto px-4 py-8">
			<h1 className="text-4xl font-bold mb-8">Todo App</h1>
			<NewTodoForm />
			<TodoItems />
			<soundStore.InitAllSounds />
		</div>
	);
}
