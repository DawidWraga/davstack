import { describe, expect, test, vi } from 'vitest';
import { createStoreContext, store } from '../src';

describe('should access and update the entire state', () => {
	const countStoreBuilder = store()
		.options({
			name: 'countStore',
		})
		.state({
			count: 2,
			nums: [] as number[],
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
		}))
		.effects((store) => ({
			log: () => store.onChange(console.log),
		}));

	const countStore = countStoreBuilder.create();

	const countStoreCtx = createStoreContext(countStoreBuilder);

	test('get', () => {
		const counterValues = countStore.count.get();

		expect(counterValues).toBe(2);
	});

	test('set', () => {
		countStore.count.set(10);

		expect(countStore.count.get()).toBe(10);
	});
	test('set nested callback', () => {
		countStore.count.set((draft) => {
			// draft = 20;
			return 11;
		});

		expect(countStore.count.get()).toBe(11);
	});
	test('set nested callback with array', () => {
		countStore.nums.set((draft) => {
			draft.push(1);
		});

		expect(countStore.nums.get()).toStrictEqual([1]);
	});

	test('assign', () => {
		// console.log('INSIDE ASSIGN NESTED OBJ: ', countStore);
		countStore.assign({
			count: 30,
		});

		expect(countStore.count.get()).toBe(30);
	});
});
