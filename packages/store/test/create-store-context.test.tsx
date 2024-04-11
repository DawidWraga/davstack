import {
	render,
	screen,
	fireEvent,
	act,
	waitFor,
} from '@testing-library/react';

import { beforeEach, describe, expect, it, test } from 'vitest';
import { createStoreContext, store } from '../src';
import { useEffect, useRef, useState } from 'react';
const testIds = {
	count: 'count',
	doubledCount: 'doubled-count',
	increment: 'increment',
	decrement: 'decrement',
	componentUsingGetRenderCount: 'component-using-get-render-count',
	componentUsingUseRenderCount: 'component-using-use-render-count',
	componentUsingSearchBooksRenderCount:
		'component-using-search-books-render-count',
	filteredBooks: 'filtered-books',
	userName: 'user-name',
	userAge: 'user-age',
	incrementAge: 'increment-age',
	setAge: 'set-age',
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
		get increment() {
			return getByTestId(testIds.increment);
		},
		get decrement() {
			return getByTestId(testIds.decrement);
		},
		get componentUsingGetRenderCount() {
			return getByTestId(testIds.componentUsingGetRenderCount).textContent;
		},
		get componentUsingUseRenderCount() {
			return getByTestId(testIds.componentUsingUseRenderCount).textContent;
		},
		get componentUsingSearchBooksRenderCount() {
			return getByTestId(testIds.componentUsingSearchBooksRenderCount)
				.textContent;
		},
		get filteredBooks() {
			return getByTestId(testIds.filteredBooks).textContent;
		},
		getUserName: (id: string) =>
			getByTestId(`${testIds.userName}-${id}`).textContent,
		getUserAge: (id: string) =>
			getByTestId(`${testIds.userAge}-${id}`).textContent,
		getIncrementAgeButton: (id: string) =>
			getByTestId(`${testIds.incrementAge}-${id}`),
		getSetAgeButton: (id: string) => getByTestId(`${testIds.setAge}-${id}`),
	};
};

describe('local component store', () => {
	test('should create local stores with different initial values', async () => {
		const globalCounterStore = store({ count: 0 });
		const counterStoreContext = createStoreContext(globalCounterStore);

		const Counter = () => {
			const counterStore = counterStoreContext.useStore();
			const count = counterStore.count.use();
			return (
				<div>
					<p data-testid={testIds.count}>Count: {count}</p>
					<button
						data-testid={testIds.increment}
						onClick={() => counterStore.count.set(counterStore.count.get() + 1)}
					>
						Increment
					</button>
				</div>
			);
		};

		const MultipleCounters = () => {
			return (
				<>
					<counterStoreContext.Provider initialValue={{ count: 1 }}>
						<Counter />
					</counterStoreContext.Provider>
					<counterStoreContext.Provider initialValue={{ count: 5 }}>
						<Counter />
					</counterStoreContext.Provider>
				</>
			);
		};

		const { getAllByTestId } = render(<MultipleCounters />);
		const countElements = getAllByTestId(testIds.count);

		await waitFor(() => {
			expect(countElements[0]).toHaveTextContent('Count: 1');
			expect(countElements[1]).toHaveTextContent('Count: 5');
		});
	});

	test('should be able to create and use local stores independently', async () => {
		const globalUserStore = store({
			name: '',
			age: 25,
		}).extend((store) => ({
			incrementAge: () => store.age.set(store.age.get() + 1),
		}));

		const userStoreContext = createStoreContext(globalUserStore);

		const InnerComp = ({ id }: { id: string }) => {
			const userStore = userStoreContext.useStore();

			const name = userStore.name.use();
			const age = userStore.age.use();

			return (
				<>
					<div data-testid={`${testIds.userName}-${id}`}>{name}</div>
					<div data-testid={`${testIds.userAge}-${id}`}>{age}</div>
					<button
						type="button"
						data-testid={`${testIds.incrementAge}-${id}`}
						onClick={userStore.incrementAge}
					>
						Increment Age
					</button>
					<button
						type="button"
						data-testid={`${testIds.setAge}-${id}`}
						onClick={() => userStore.age.set(userStore.age.get() + 1)}
					>
						Set Age
					</button>
				</>
			);
		};

		const Comp1 = () => {
			return (
				<userStoreContext.Provider initialValue={{ name: 'comp1' }}>
					<InnerComp id="comp1" />
				</userStoreContext.Provider>
			);
		};

		const Comp2 = () => {
			return (
				<userStoreContext.Provider initialValue={{ name: 'comp2' }}>
					<InnerComp id="comp2" />
				</userStoreContext.Provider>
			);
		};

		const ui = getUi(
			render(
				<>
					<Comp1 />
					<Comp2 />
				</>
			)
		);

		await waitFor(() => {
			expect(ui.getUserName('comp1')).toBe('comp1');
			expect(ui.getUserName('comp2')).toBe('comp2');
		});

		act(() => {
			fireEvent.click(ui.getSetAgeButton('comp1'));
		});

		await waitFor(() => {
			expect(ui.getUserAge('comp1')).toBe('26');
			expect(ui.getUserAge('comp2')).toBe('25');
		});

		act(() => {
			fireEvent.click(ui.getIncrementAgeButton('comp2'));
			fireEvent.click(ui.getIncrementAgeButton('comp2'));
			fireEvent.click(ui.getIncrementAgeButton('comp2'));
		});

		await waitFor(() => {
			expect(ui.getUserAge('comp1')).toBe('26');
			expect(ui.getUserAge('comp2')).toBe('28');
		});
	});
});
