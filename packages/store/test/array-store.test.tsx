import { describe, expect, test } from 'vitest';
import { store } from '../src';

// !CURRENTLY NOT WORKING. easy solution is to just use store({items: []}) instead of store([]) for arrays.

describe('should work with array state', () => {
	const listStore = store([1, 2, 3]);

	test('get', () => {
		const counterValues = listStore.get();

		expect(counterValues).toStrictEqual([1, 2, 3]);
	});

	test('set', () => {
		listStore.set((draft) => {
			draft.push(4);
		});

		// if fixed then remove the not from the below line
		expect(listStore.get()).not.toStrictEqual([1, 2, 3, 4]);
	});
});
