/* eslint-disable no-unused-vars */
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
			const countStore = store(0)
				.computed((store) => ({
					doubled: () => store.get() * 2,
				}))
				.actions((store) => ({
					increment() {
						store.set(store.get() + 1);
					},
					decrement() {
						store.set(store.get() - 1);
					},
				}));

			const Counter = () => {
				const count = countStore.use();
				const doubled = countStore.doubled.use();
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
			// the store should NOT be created yet - someone may want to use a context store and no global store.
			const countStore = store({ parent: { count: 2 } });

			test('get', () => {
				// check if the store is created and if it's not then just create it in real time
				const counterValues = countStore.parent.count.get();
				expect(counterValues).toBe(2);
			});

			test('set', () => {
				// at this point we should NOT recreate a new store, we should reuse the global instance from  the previous test
				countStore.parent.count.set(10);

				expect(countStore.parent.count.get()).toBe(10);
			});

			test('assign', () => {
				countStore.assign({
					parent: {
						count: 30,
					},
				});

				expect(countStore.get()).toStrictEqual({
					parent: { count: 30 },
				});
			});
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

		/**
		 * this test is here because built in method names eg "name" and "length" were conflicting with the store properties inside the proxy. THis has been fixed inside create-recrusive-proxy.ts using excludeKeys
		 */
		test('should update only the component using the nested store when a nested value changes - RISKY WORDS', () => {
			const userStore = store({
				user: { name: 'John', length: 25, books: [1, 2, 3] },
			});

			expect(userStore.user.books.get()).toStrictEqual([1, 2, 3]);
			expect(userStore.user.books.get().length).toBe(3);

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
				userStore.user.length.set(30);
			});

			expect(ui.componentUsingGetRenderCount).toBe('1');
			expect(ui.componentUsingUseRenderCount).toBe('2');
		});
	});

	describe('should be able to have infinite nesting', () => {
		const countStore = store({
			level1: {
				count1: 1,
				level2: {
					count2: 2,
					level3: {
						count3: 3,
					},
				},
			},
		});

		test('get', () => {
			const counterValues = countStore.level1.level2.get();
			expect(counterValues).toStrictEqual({
				count2: 2,
				level3: {
					count3: 3,
				},
			});
			expect(countStore.level1.level2.level3.get()).toStrictEqual({
				count3: 3,
			});
		});

		test('set', () => {
			countStore.level1.level2.count2.set((prev) => prev + 2);
			expect(countStore.level1.level2.get()).toStrictEqual({
				count2: 4,
				level3: {
					count3: 3,
				},
			});

			countStore.level1.level2.level3.count3.set(20);
			expect(countStore.level1.level2.level3.get()).toStrictEqual({
				count3: 20,
			});
		});

		test('assign', () => {
			countStore.level1.assign({
				count1: 10,
				level2: {
					count2: 20,
					level3: {
						count3: 30,
					},
				},
			});
			expect(countStore.get()).toStrictEqual({
				level1: {
					count1: 10,
					level2: {
						count2: 20,
						level3: {
							count3: 30,
						},
					},
				},
			});

			countStore.level1.level2.level3.assign({ count3: 40 });
			expect(countStore.level1.level2.level3.get()).toStrictEqual({
				count3: 40,
			});
		});
	});
});
