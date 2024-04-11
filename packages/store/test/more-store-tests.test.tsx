import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { store } from '../src';

// Define testIds only once, avoiding repetition
const testIds = {
	count: 'count',
	doubledCount: 'doubled-count',
	increment: 'increment',
	decrement: 'decrement',
	componentUsingGetRenderCount: 'component-using-get-render-count',
	componentUsingUseRenderCount: 'component-using-use-render-count',
};

// Simpler UI retrieval without redundant getByTestId spread
const getUi = ({ getByTestId, ...rest }: ReturnType<typeof render>) => {
	return {
		getByTestId,
		...rest,
		get count() {
			return getByTestId(testIds.count).textContent;
		},
		get doubledCount() {
			return getByTestId(testIds.doubledCount).textContent;
		},
		getCount: () => getByTestId(testIds.count).textContent,
		getDoubledCount: () => getByTestId(testIds.doubledCount).textContent,
		fireIncrement: () => fireEvent.click(getByTestId(testIds.increment)),
		fireDecrement: () => fireEvent.click(getByTestId(testIds.decrement)),
		get componentUsingGetRenderCount() {
			return getByTestId(testIds.componentUsingGetRenderCount).textContent;
		},
		get componentUsingUseRenderCount() {
			return getByTestId(testIds.componentUsingUseRenderCount).textContent;
		},
	};
};

describe('store', () => {
	describe('primative values store', () => {
		describe('should access and update the entire state', () => {
			const countStore = store(2);

			test('get', () => {
				const counterValues = countStore.get();
				expect(counterValues).toBe(2);
			});

			test('set', () => {
				countStore.set(10);
				expect(countStore.get()).toBe(10);
			});

			test('assign', () => {
				countStore.assign(20);
				expect(countStore.get()).toBe(20);
			});

			test('subscribe', () => {
				const cb = vi.fn();
				countStore.set(11);
				countStore.subscribe(cb);
				countStore.set(12);
				expect(cb).toHaveBeenCalledTimes(1);
				expect(cb).toHaveBeenCalledWith(12, 11);
			});
		});

		test('should subscribe to state changes and update the state', () => {
			const countStore = store(0);

			const Counter = () => {
				const count = countStore.use();
				return (
					<div>
						<p data-testid={testIds.count}>Count: {count}</p>
						<button
							data-testid={testIds.increment}
							onClick={() => countStore.set(countStore.get() + 1)}
						>
							Increment
						</button>
					</div>
				);
			};

			const renderResult = render(<Counter />);
			const ui = getUi(renderResult);

			expect(ui.count).toBe('Count: 0');
			ui.fireIncrement();
			expect(ui.count).toBe('Count: 1');
		});

		test('should be able to extend store to define actions and computed properties', () => {
			const countStore = store(0).extend((store) => ({
				getDoubled() {
					return store.get() * 2;
				},
				increment() {
					store.set(store.get() + 1);
				},
				decrement() {
					store.set(store.get() - 1);
				},
			}));

			const Counter = () => {
				const count = countStore.use();
				const doubled = countStore.getDoubled();
				return (
					<div>
						<p data-testid={testIds.count}>Count: {count}</p>
						<p data-testid={testIds.doubledCount}>Doubled: {doubled}</p>
						<button
							data-testid={testIds.increment}
							onClick={countStore.increment}
						>
							Increment
						</button>
						<button
							data-testid={testIds.decrement}
							onClick={countStore.decrement}
						>
							Decrement
						</button>
					</div>
				);
			};

			const ui = getUi(render(<Counter />));

			expect(ui.count).toBe('Count: 0');
			expect(ui.doubledCount).toBe('Doubled: 0');
			ui.fireIncrement();
			expect(ui.count).toBe('Count: 1');
			expect(ui.doubledCount).toBe('Doubled: 2');
			ui.fireDecrement();
			expect(ui.count).toBe('Count: 0');
			expect(ui.doubledCount).toBe('Doubled: 0');
		});

		test('should update only the component using the primitive store when the value changes', () => {
			const countStore = store(0);

			const ComponentUsingGet = () => {
				const renderCount = useRef(0);
				const _count = countStore.get();
				renderCount.current++;
				return (
					<div data-testid={testIds.componentUsingGetRenderCount}>
						{renderCount.current}
					</div>
				);
			};

			const ComponentUsingUse = () => {
				const renderCount = useRef(0);
				const _count = countStore.use();
				renderCount.current++;
				return (
					<div data-testid={testIds.componentUsingUseRenderCount}>
						{renderCount.current}
					</div>
				);
			};

			const ui = getUi(
				render(
					<>
						<ComponentUsingGet />
						<ComponentUsingUse />
					</>
				)
			);

			expect(ui.componentUsingGetRenderCount).toBe('1');
			expect(ui.componentUsingUseRenderCount).toBe('1');

			act(() => {
				countStore.set(10);
			});

			expect(ui.componentUsingGetRenderCount).toBe('1');
			expect(ui.componentUsingUseRenderCount).toBe('2');
		});
	});

	describe('nested object store', () => {
		describe('should access and update the entire state', () => {
			const countStore = store({ parent: { count: 2 } });

			test('get', () => {
				const counterValues = countStore.parent.count.get();
				expect(counterValues).toBe(2);
			});

			test('set', () => {
				countStore.parent.count.set(10);

				expect(countStore.parent.count.get()).toBe(10);
			});

			test('assign', () => {
				// console.log('INSIDE ASSIGN NESTED OBJ: ', countStore);
				countStore.assign({
					parent: {
						count: 30,
					},
				});

				expect(countStore.get()).toStrictEqual({
					parent: { count: 30 },
				});
			});

			test('subscribe', () => {
				const cb = vi.fn();
				countStore.parent.count.set(8);
				countStore.parent.count.subscribe(cb);
				countStore.parent.count.set(9);
				expect(cb).toHaveBeenCalledTimes(1);
				// 1st = current; 2 = prev
				expect(cb).toHaveBeenCalledWith(9, 8);
			});

			// // @ts-expect-error
			// expect(countStore.parent.count.get()).toBe(20);
		});

		test('should update only the component using the nested store when a nested value changes', () => {
			const userStore = store({ user: { name: 'John', age: 25 } });

			const ComponentUsingGet = () => {
				const renderCount = useRef(0);

				const _name = userStore.user.name.get();
				renderCount.current++;
				return (
					<div data-testid={testIds.componentUsingGetRenderCount}>
						{renderCount.current}
					</div>
				);
			};

			const ComponentUsingUse = () => {
				const renderCount = useRef(0);

				const _name = userStore.user.name.use();
				renderCount.current++;
				return (
					<div data-testid={testIds.componentUsingUseRenderCount}>
						{renderCount.current}
					</div>
				);
			};

			const ui = getUi(
				render(
					<>
						<ComponentUsingGet />
						<ComponentUsingUse />
					</>
				)
			);

			expect(ui.componentUsingGetRenderCount).toBe('1');
			expect(ui.componentUsingUseRenderCount).toBe('1');

			act(() => {
				userStore.user.name.set('Jane');
			});

			expect(ui.componentUsingGetRenderCount).toBe('1');
			expect(ui.componentUsingUseRenderCount).toBe('2');

			act(() => {
				userStore.user.age.set(30);
			});

			expect(ui.componentUsingGetRenderCount).toBe('1');
			expect(ui.componentUsingUseRenderCount).toBe('2');
		});
	});

	describe('subscribe should not fire other subscribes', () => {
		const countStore = store({ parent1: { count: 1 }, parent2: { count: 2 } });

		test('v1', () => {
			const cb1 = vi.fn();
			const cb2 = vi.fn();

			countStore.parent1.count.subscribe(cb1);
			countStore.parent2.count.subscribe(cb2);

			countStore.parent1.count.set(10);

			expect(cb1).toHaveBeenCalledTimes(1);
			expect(cb2).toHaveBeenCalledTimes(0);
		});

		test('v2', () => {
			const cb1 = vi.fn();
			const cb2 = vi.fn();

			countStore.parent1.subscribe(cb1);
			countStore.parent2.subscribe(cb2);

			countStore.parent2.count.set(20);

			expect(cb1).toHaveBeenCalledTimes(0);
			expect(cb2).toHaveBeenCalledTimes(1);
		});
	});

	describe('TEMP: should max out at 2 levels of nesting', () => {
		const countStore = store({
			level1: {
				count1: 1,
				level2: {
					count2: 2,
				},
			},
		});

		test('get', () => {
			const counterValues = countStore.level1.level2.get();
			expect(counterValues).toStrictEqual({ count2: 2 });

			// @ts-expect-error
			expect(() => countStore.level1.level2.level3.get()).toThrow();
		});

		test('set', () => {
			countStore.level1.level2.set((prev) => ({ count2: prev.count2 + 8 }));

			expect(countStore.level1.level2.get()).toStrictEqual({ count2: 10 });

			// @ts-expect-error
			expect(() => countStore.level1.level2.level3.set(20)).toThrow();
		});

		test('assign', () => {
			countStore.assign({
				level1: {
					count1: 1,
					level2: {
						count2: 20,
					},
				},
			});

			expect(countStore.get()).toStrictEqual({
				level1: {
					count1: 1,
					level2: {
						count2: 20,
					},
				},
			});
		});
	});

	// CURRENTLY NOT WORKING. easy solution is to just use store({items: []}) instead of store([]) for arrays.

	// describe('should work with array state', () => {
	// 	const listStore = store([1, 2, 3]);

	// 	test('get', () => {
	// 		const counterValues = listStore.get();

	// 		expect(counterValues).toStrictEqual([1, 2, 3]);
	// 	});

	// 	test('set', () => {
	// 		listStore.set((draft) => {
	// 			draft.push(4);
	// 		});
	// 		expect(listStore.get()).toStrictEqual([1, 2, 3, 4]);
	// 	});
	// });
});
