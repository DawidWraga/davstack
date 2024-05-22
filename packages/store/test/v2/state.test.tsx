/* eslint-disable no-unused-vars */
import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, test } from 'vitest';
import { state } from '../../src/create-store/create-inner-immer-store';
import { State } from '../../src/create-state-methods';
import { store } from '../../src';

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
	describe('should init with correct type', () => {
		test('null', () => {
			const count = state(null, { name: 'this wan' });
			expect(count.get()).toBe(null);
		});
		test('undefined', () => {
			const count = state();
			expect(count.get()).toBe(undefined);

			count.set('hello');
			expect(count.get()).toBe('hello');
		});

		test('number - 0', () => {
			const count = state(0);
			expect(count.get()).toBe(0);
		});
		test('number - non-zero', () => {
			const count = state(1);
			expect(count.get()).toBe(1);
		});

		test('string - empty', () => {
			const count = state('');
			expect(count.get()).toBe('');
		});

		test('string - non-empty', () => {
			const count = state('hello');
			expect(count.get()).toBe('hello');
		});

		test('boolean - false', () => {
			const count = state(false);
			expect(count.get()).toBe(false);
		});

		test('boolean - true', () => {
			const count = state(true);
			expect(count.get()).toBe(true);
		});

		test('object - empty', () => {
			const count = state({});
			expect(count.get()).toEqual({});
		});

		test('object - non-empty', () => {
			const count = state({ hello: 'world' });
			expect(count.get()).toEqual({ hello: 'world' });
		});

		test('array - empty', () => {
			const count = state([]);
			expect(count.get()).toEqual([]);
		});

		test('array - non-empty', () => {
			const count = state([1, 2, 3]);
			expect(count.get()).toEqual([1, 2, 3]);
		});

		test('array - after changes', () => {
			const count = state([1, 2, 3]);
			expect(count.get()).toEqual([1, 2, 3]);
			count.set([4, 5, 6]);
			expect(count.get()).toEqual([4, 5, 6]);
		});
	});

	const createCountStore = ({ id }: { id: string }) => {
		const count = state(0);
		// const count = store(0);

		return {
			count,
			increment: () => count.set(count.get() + 1),
			decrement: () => count.set(count.get() - 1),
			effects: {
				log: () => count.onChange((state) => console.log('state', state)),
			},
		};
	};



	// type TempType = State<number>;

	describe('basic methods', () => {
		describe('should access and update the entire state', () => {
			const countStore = createCountStore({ id: 'test' });

			test('get', () => {
				const counterValues = countStore.count.get();
				expect(counterValues).toBe(0);
			});

			test('set', () => {
				countStore.count.set(10);
				expect(countStore.count.get()).toBe(10);
			});

			test('assign', () => {
				countStore.count.assign(20);
				expect(countStore.count.get()).toBe(20);
			});
		});

		test('should subscribe to state changes and update the state', () => {
			const countStore = createCountStore({ id: 'test2' });

			const Counter = () => {
				const count = countStore.count.use();
				return (
					<div>
						<p data-testid={testIds.count}>Count: {count}</p>
						<button
							data-testid={testIds.increment}
							onClick={() => countStore.count.set(countStore.count.get() + 1)}
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
	});

	test('should update only the component using the primitive store when the value changes', () => {
		const countStore = createCountStore({ id: 'test3' });

		const ComponentUsingGet = () => {
			const renderCount = useRef(0);
			const _count = countStore.count.get();
			renderCount.current++;
			return (
				<div data-testid={testIds.componentUsingGetRenderCount}>
					{renderCount.current}
				</div>
			);
		};

		const ComponentUsingUse = () => {
			const renderCount = useRef(0);
			const _count = countStore.count.use();
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
			countStore.count.set(10);
		});

		expect(ui.componentUsingGetRenderCount).toBe('1');
		expect(ui.componentUsingUseRenderCount).toBe('2');
	});
});
