import { describe, expect, test } from 'vitest';
import { store } from '../src';

describe('should access and update the entire state', () => {
	const countStore = store()
		.state({
			count: 2,
		})
		.computed((store) => ({
			doubled: () => store.count.get() * 2,
		}))
		.actions((store) => ({
			increment() {
				store.count.set(store.count.get() + 1);
			},
			decrement() {
				store.count.set(store.count.get() - 1);
			},
		}));

	test('get', () => {
		const counterValues = countStore.count.get();

		expect(counterValues).toBe(2);
	});

	test('set', () => {
		countStore.count.set(10);

		expect(countStore.count.get()).toBe(10);
	});

	test('assign', () => {
		// console.log('INSIDE ASSIGN NESTED OBJ: ', countStore);
		countStore.assign({
			count: 30,
		});

		expect(countStore.get()).toStrictEqual({
			count: 30,
		});

    
	});
});
