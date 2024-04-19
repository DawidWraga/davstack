import { describe, expect, test, vi } from 'vitest';
import { createStoreContext, store } from '../src';

describe('should access and update the entire state', () => {
	const countStoreBuilder = store()
		.identify('countStore')
		.devtools()
		.input({ setting: false })
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

	test('assign', () => {
		// console.log('INSIDE ASSIGN NESTED OBJ: ', countStore);
		countStore.assign({
			count: 30,
		});

		expect(countStore.get()).toStrictEqual({
			count: 30,
		});
	});

	test('input', () => {
		expect(countStore.setting).toBe(false);
	});
	test('input with different instnes', () => {
		const countStore2 = countStoreBuilder.create({ setting: true });

		expect(countStore.setting).toBe(false);
		expect(countStore2.setting).toBe(true);
	});
});
