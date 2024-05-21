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
	const createCountStore = ({ id }: { id: string }) => {
		const count$ = state(0);
		const count = store(0);

		return {
			count,
			increment: () => count.set(count.get() + 1),
			decrement: () => count.set(count.get() - 1),
			effects: {
				log: () => count.onChange((state) => console.log('state', state)),
			},
		};
	};

	type TempType = State<number>;

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
