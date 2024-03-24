'use client';
import { createStore } from '@davstack/store';

export const todoStore = createStore({
	todos: [] as { id: number; text: string; completed: boolean }[],
}).extend((store) => ({
	addTodo(text: string) {
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
			if (todo) {
				todo.completed = !todo.completed;
			}
		});
	},
	deleteTodo(id: number) {
		store.set((draft) => {
			const index = draft.todos.findIndex((todo) => todo.id === id);
			if (index !== -1) {
				draft.todos.splice(index, 1);
			}
		});
	},
}));

import React, { useState } from 'react';

export default function TodoPage() {
	const [newTodo, setNewTodo] = useState('');
	const todos = todoStore.todos.use();

	const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (newTodo.trim()) {
			todoStore.addTodo(newTodo.trim());
			setNewTodo('');
		}
	};

	return (
		<div className="container mx-auto px-4 py-8">
			<h1 className="text-4xl font-bold mb-8">Todo App</h1>
			<form onSubmit={handleSubmit} className="mb-8">
				<input
					type="text"
					value={newTodo}
					onChange={(e) => setNewTodo(e.target.value)}
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
		</div>
	);
}
