import { describe, expect, test } from 'vitest';
import { store } from '../src';

describe('should work with array state', () => {
	test('get initial state', () => {
		const listStore = store([1, 2, 3]);
		const values = listStore.get();
		expect(values).toStrictEqual([1, 2, 3]);
	});

	test('set new array', () => {
		const listStore = store([1, 2, 3]);
		listStore.set([4, 5, 6]);
		expect(listStore.get()).toStrictEqual([4, 5, 6]);
	});

	test('set new array with different length', () => {
		const listStore = store([1, 2, 3]);
		listStore.set([4, 5]);
		expect(listStore.get()).toStrictEqual([4, 5]);
	});

	test('set empty array', () => {
		const listStore = store([1, 2, 3]);
		listStore.set([]);
		expect(listStore.get()).toStrictEqual([]);
	});

	test('push item to array', () => {
		const listStore = store([1, 2, 3]);
		listStore.set((draft) => {
			draft.push(4);
		});
		expect(listStore.get()).toStrictEqual([1, 2, 3, 4]);
	});

	test('pop item from array', () => {
		const listStore = store([1, 2, 3]);
		listStore.set((draft) => {
			draft.pop();
		});
		expect(listStore.get()).toStrictEqual([1, 2]);
	});

	test('shift item from array', () => {
		const listStore = store([1, 2, 3]);
		listStore.set((draft) => {
			draft.shift();
		});
		expect(listStore.get()).toStrictEqual([2, 3]);
	});

	test('unshift item to array', () => {
		const listStore = store([1, 2, 3]);
		listStore.set((draft) => {
			draft.unshift(0);
		});
		expect(listStore.get()).toStrictEqual([0, 1, 2, 3]);
	});

	test('splice items from array', () => {
		const listStore = store([1, 2, 3, 4, 5]);
		listStore.set((draft) => {
			draft.splice(1, 2);
		});
		expect(listStore.get()).toStrictEqual([1, 4, 5]);
	});

	test('splice and insert items to array', () => {
		const listStore = store([1, 2, 3, 4, 5] as (number | string)[]);
		listStore.set((draft) => {
			draft.splice(1, 2, 'a', 'b');
		});
		expect(listStore.get()).toStrictEqual([1, 'a', 'b', 4, 5]);
	});

	test('update item in array', () => {
		const listStore = store([1, 2, 3] as (number | string)[]);
		listStore.set((draft) => {
			draft[1] = 'x';
		});
		expect(listStore.get()).toStrictEqual([1, 'x', 3]);
	});

	test('clear array', () => {
		const listStore = store([1, 2, 3]);
		listStore.set((draft) => {
			draft.length = 0;
		});
		expect(listStore.get()).toStrictEqual([]);
	});

	// Add more test cases as needed
});
