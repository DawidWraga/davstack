import { describe, expect, test } from 'vitest';
import { store } from '../../src';
type Todo = {
	id: number;
	text: string;
	completed: boolean;
};

const createTodoStore = () => {
	const $todos = store<Todo[]>([]);

	function addTodo(todo: Todo) {
		$todos.set((draft) => {
			draft.push(todo);
		});
	}

	function toggleTodo(id: number) {
		$todos.set((draft) => {
			const todo = draft.find((todo) => todo.id === id);
			if (todo) {
				todo.completed = !todo.completed;
			}
		});
	}

	function removeTodo(id: number) {
		$todos.set((draft) => {
			const index = draft.findIndex((todo) => todo.id === id);
			if (index !== -1) {
				draft.splice(index, 1);
			}
		});
	}

	return {
		$todos,
		addTodo,
		toggleTodo,
		removeTodo,
	};
};

describe('todo store', () => {
	test('add todo item', () => {
		const { $todos, addTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		expect($todos.get()).toStrictEqual([
			{ id: 1, text: 'Buy groceries', completed: false },
		]);
	});

	test('add multiple todo items', () => {
		const { $todos, addTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		expect($todos.get()).toStrictEqual([
			{ id: 1, text: 'Buy groceries', completed: false },
			{ id: 2, text: 'Do laundry', completed: false },
		]);
	});

	test('toggle todo item', () => {
		const { $todos, addTodo, toggleTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		toggleTodo(1);
		expect($todos.get()).toStrictEqual([
			{ id: 1, text: 'Buy groceries', completed: true },
		]);
	});

	test('toggle non-existent todo item', () => {
		const { $todos, addTodo, toggleTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		toggleTodo(2);
		expect($todos.get()).toStrictEqual([
			{ id: 1, text: 'Buy groceries', completed: false },
		]);
	});

	test('remove todo item', () => {
		const { $todos, addTodo, removeTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		removeTodo(1);
		expect($todos.get()).toStrictEqual([
			{ id: 2, text: 'Do laundry', completed: false },
		]);
	});

	test('remove non-existent todo item', () => {
		const { $todos, addTodo, removeTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		removeTodo(2);
		expect($todos.get()).toStrictEqual([
			{ id: 1, text: 'Buy groceries', completed: false },
		]);
	});

	test('update todo item text', () => {
		const { $todos, addTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		$todos.set((draft) => {
			const todo = draft.find((todo) => todo.id === 1);
			if (todo) {
				todo.text = 'Buy milk';
			}
		});
		expect($todos.get()).toStrictEqual([
			{ id: 1, text: 'Buy milk', completed: false },
		]);
	});

	test('clear all todo items', () => {
		const { $todos, addTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		$todos.set([]);
		expect($todos.get()).toStrictEqual([]);
	});

	// Add more test cases as needed
});
