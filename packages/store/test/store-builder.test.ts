import { describe, expect, test, vi } from 'vitest';
import { createStoreContext, store } from '../src';

describe('should access and update the entire state', () => {
	const countStoreBuilder = store().state({
		count: 2,
	});

	// dont need to call create() as it will be created automatically when accessed!
	const countStore = countStoreBuilder;

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
	describe('ACTIONS', () => {
		const countStoreBuilder = store()
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

		const countStore = countStoreBuilder.create();

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

		test('actions', () => {
			expect(countStore.count.get()).toBe(30);
			countStore.increment();
			expect(countStore.count.get()).toBe(31);

			countStore.decrement();
			expect(countStore.count.get()).toBe(30);
		});
	});
});
describe('should access and update the entire state + INPUT METHODS', () => {
	const countStoreBuilder = store()
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

	describe('EFFECTS', () => {
		const someEffectCallback = vi.fn();

		const countStore = store()
			.state({ count: 2 })
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
				someEffect: someEffectCallback,
			}));

		test('should not create store instance until accessed', () => {
			expect(someEffectCallback).not.toHaveBeenCalled();
		});

		test('should create store instance when accessed', () => {
			// const countStore = countStoreBuilder.create();
			countStore.count.get();
			expect(someEffectCallback).toHaveBeenCalledTimes(1);
		});
		test('store insatnce should not be recreated ', () => {
			// const countStore = countStoreBuilder.create();
			countStore.count.get();
			expect(someEffectCallback).toHaveBeenCalledTimes(1);
		});

		// this fully works which means the following:
		/**
		 * The store is NOT created until it is accessed
		 * therefore you can us ethe store() syntax to define non-creating stores eg for context, without redundant store instances being created
		 *
		 * however, if you want to use a global store insatnce, you dont need to call .create() as it will be created automatically when accessed eg store.count.get()
		 */
	});
});
describe('should access and update the entire state + INPUT METHODS V2', () => {
	const countStoreBuilder = store()
		.input({ setting: false })
		.state({
			count: 2,
		})
		.computed((store) => ({
			doubled: () => {
				if (!store.setting) return '12345';
				store.count.get() * 2;
			},
		}))
		.actions((store) => ({
			increment() {
				store.count.set(store.count.get() + 1);
			},
			decrement() {
				store.count.set(store.count.get() - 1);
			},
		}))
		.extend((store) => {
			if (store.setting) {
				store.count.set(10);
			}

			return {};
		});

	const countStore = countStoreBuilder.create();

	const countStoreCtx = createStoreContext(countStoreBuilder);

	test('get', () => {
		const countValue = countStore.count.get();
		expect(countValue).toBe(2);
		const doubledValue = countStore.doubled.get();

		expect(doubledValue).toBe('12345');
	});
	test('get 2', () => {
		const counterStore2 = countStoreBuilder.create({ setting: true });
		const doubledValue = counterStore2.doubled.get();

		const countValue = counterStore2.count.get();

		setTimeout(() => {
			expect(countValue).toBe(10);
			expect(doubledValue).not.toBe('12345');
		}, 100);
		// expect(countValue).toBe(10);

		expect(doubledValue).not.toBe('12345');
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

	describe('EFFECTS', () => {
		const someEffectCallback = vi.fn();

		const countStore = store()
			.state({ count: 2 })
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
				someEffect: someEffectCallback,
			}));

		test('should not create store instance until accessed', () => {
			expect(someEffectCallback).not.toHaveBeenCalled();
		});

		test('should create store instance when accessed', () => {
			// const countStore = countStoreBuilder.create();
			countStore.count.get();
			expect(someEffectCallback).toHaveBeenCalledTimes(1);
		});
		test('store insatnce should not be recreated ', () => {
			// const countStore = countStoreBuilder.create();
			countStore.count.get();
			expect(someEffectCallback).toHaveBeenCalledTimes(1);
		});

		// this fully works which means the following:
		/**
		 * The store is NOT created until it is accessed
		 * therefore you can us ethe store() syntax to define non-creating stores eg for context, without redundant store instances being created
		 *
		 * however, if you want to use a global store insatnce, you dont need to call .create() as it will be created automatically when accessed eg store.count.get()
		 */
	});
});
