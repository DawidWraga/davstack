import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, test } from 'vitest';
import { createStore } from '../src';

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

describe('createStore', () => {
	describe('primative values store', () => {
		test('should access and update the entire state', () => {
			const countStore = createStore(2);

			const counterValues = countStore.get();
			expect(counterValues).toBe(2);

			countStore.set(10);
			expect(countStore.get()).toBe(10);

			countStore.assign(20);

			expect(countStore.get()).toBe(20);
		});

		test('should subscribe to state changes and update the state', () => {
			const countStore = createStore(0);

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
			const countStore = createStore(0).extend((store) => ({
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
	});
	describe('nested object store', () => {
		test('should access and update the entire state', () => {
			const countStore = createStore({ parent: { count: 2 } });

			// @ts-expect-error
			const counterValues = countStore.parent.count.get();
			expect(counterValues).toBe(2);

			// @ts-expect-error
			countStore.parent.count.set(10);
			// @ts-expect-error
			expect(countStore.parent.count.get()).toBe(10);

			countStore.assign({
				parent: {
					count: 20,
				},
			});
			countStore.set((draft) => {
				console.log('DRAFT', draft);
				draft.parent.count = 30;
			});

			expect(countStore.get()).toStrictEqual({
				parent: { count: 30 },
			});
			// // @ts-expect-error
			// expect(countStore.parent.count.get()).toBe(20);
		});
	});
});
