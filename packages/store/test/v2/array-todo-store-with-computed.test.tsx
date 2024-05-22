import { describe, expect, test } from 'vitest';
import { computed, store } from '../../src';
type Todo = {
	id: number;
	text: string;
	completed: boolean;
};

const createTodoStore = () => {
	const $todos = store<Todo[]>([]);
	const $activeTodoId = store<number | null>(null);

	const $activeTodo = computed((method) => {
		const get = () => {
			const todos = $todos[method]();
			const activeTodoId = $activeTodoId[method]();
			return todos.find((todo) => todo.id === activeTodoId);
		};

		const set = (todo: Todo) => {
			const activeTodo = get();
			if (!activeTodo) return;

			$todos.set((draft) => {
				const todoIndex = draft.findIndex((todo) => todo.id === activeTodo.id);
				if (todoIndex !== -1) {
					draft[todoIndex] = todo;
				}
			});
		};

		return { get, set };
	});

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
		$activeTodoId,
		$activeTodo,
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

describe('computed tests', () => {
	test('set active todo ID', () => {
		const { addTodo, $activeTodoId } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		$activeTodoId.set(1);
		expect($activeTodoId.get()).toBe(1);
	});

	test('get active todo', () => {
		const { addTodo, $activeTodoId, $activeTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		$activeTodoId.set(1);
		const activeTodo = $activeTodo.get();

		expect(activeTodo).toStrictEqual({
			id: 1,
			text: 'Buy groceries',
			completed: false,
		});
	});

	test('get active todo when no active todo ID is set', () => {
		const { addTodo, $activeTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		expect($activeTodo.get()).toBeUndefined();
	});

	test('get active todo when active todo ID does not exist', () => {
		const { addTodo, $activeTodoId, $activeTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		$activeTodoId.set(3);
		expect($activeTodo.get()).toBeUndefined();
	});

	test('update active todo', () => {
		const { $todos, addTodo, $activeTodoId, $activeTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		$activeTodoId.set(1);
		$activeTodo.set({ id: 1, text: 'Buy milk', completed: false });
		expect($todos.get()).toStrictEqual([
			{ id: 1, text: 'Buy milk', completed: false },
			{ id: 2, text: 'Do laundry', completed: false },
		]);
	});

	test('update active todo when no active todo ID is set', () => {
		const { $todos, addTodo, $activeTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		$activeTodo.set({ id: 1, text: 'Buy milk', completed: false });
		expect($todos.get()).toStrictEqual([
			{ id: 1, text: 'Buy groceries', completed: false },
			{ id: 2, text: 'Do laundry', completed: false },
		]);
	});

	test('update active todo when active todo ID does not exist', () => {
		const { $todos, addTodo, $activeTodoId, $activeTodo } = createTodoStore();
		addTodo({ id: 1, text: 'Buy groceries', completed: false });
		addTodo({ id: 2, text: 'Do laundry', completed: false });
		$activeTodoId.set(3);
		$activeTodo.set({ id: 3, text: 'Buy milk', completed: false });
		expect($todos.get()).toStrictEqual([
			{ id: 1, text: 'Buy groceries', completed: false },
			{ id: 2, text: 'Do laundry', completed: false },
		]);
	});
});
