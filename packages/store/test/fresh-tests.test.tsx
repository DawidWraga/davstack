import {
	render,
	screen,
	fireEvent,
	act,
	waitFor,
} from '@testing-library/react';

import { describe, expect, it, test } from 'vitest';
import { createStore } from '../src';
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

describe('createStore', () => {
	test('should create a store with the correct initial state', () => {
		const counterStore = createStore({ count: 0 });
		expect(counterStore.count.get()).toBe(0);
	});

	test('should subscribe to state changes and update the state', () => {
		const counterStore = createStore({ count: 0 });

		const Counter = () => {
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

		const renderResult = render(<Counter />);
		const ui = getUi(renderResult);

		expect(ui.count).toBe('Count: 0');
		fireEvent.click(ui.increment);
		expect(ui.count).toBe('Count: 1');
	});

	test('should access state outside components', () => {
		const counterStore = createStore({ count: 0 });

		const handleSubmit = () => {
			const count = counterStore.count.get();
			expect(count).toBe(0);
		};

		handleSubmit();
	});

	test('should define actions and computed properties', () => {
		const counterStore = createStore({ count: 0 }).extend((store) => ({
			getDoubled() {
				return store.count.get() * 2;
			},
			increment() {
				store.count.set(store.count.get() + 1);
			},
			decrement() {
				store.count.set(store.count.get() - 1);
			},
		}));

		const Counter = () => {
			const count = counterStore.count.use();
			const doubled = counterStore.getDoubled();
			return (
				<div>
					<p data-testid={testIds.count}>Count: {count}</p>
					<p data-testid={testIds.doubledCount}>Doubled: {doubled}</p>
					<button
						data-testid={testIds.increment}
						onClick={counterStore.increment}
					>
						Increment
					</button>
					<button
						data-testid={testIds.decrement}
						onClick={counterStore.decrement}
					>
						Decrement
					</button>
				</div>
			);
		};

		const ui = getUi(render(<Counter />));

		expect(ui.count).toBe('Count: 0');
		expect(ui.doubledCount).toBe('Doubled: 0');
		fireEvent.click(ui.increment);
		expect(ui.count).toBe('Count: 1');
		expect(ui.doubledCount).toBe('Doubled: 2');
		fireEvent.click(ui.decrement);
		expect(ui.count).toBe('Count: 0');
		expect(ui.doubledCount).toBe('Doubled: 0');
	});

	test('should access and update the entire state', () => {
		const counterStore = createStore({ count: 0 });

		const counterValues = counterStore.get();
		expect(counterValues.count).toBe(0);

		counterStore.assign({ count: 10 });
		expect(counterStore.count.get()).toBe(10);

		counterStore.set((state) => {
			state.count = 20;
		});
		expect(counterStore.count.get()).toBe(20);

		counterStore.assign({ count: 30 });
		expect(counterStore.count.get()).toBe(30);
	});

	test('should use react-tracked for performance optimizations', async () => {
		const counterStore = createStore({ count: 0, name: 'Counter' });

		const Counter = () => {
			const state = counterStore.useTracked();
			const count = counterStore.count.useTracked();
			return (
				<div>
					<p data-testid={testIds.count}>Count: {count}</p>
					<p>Name: {state.name}</p>
				</div>
			);
		};

		const ui = getUi(render(<Counter />));

		expect(ui.count).toBe('Count: 0');
		expect(ui.getByText('Name: Counter')).toBeInTheDocument();

		counterStore.count.set(counterStore.count.get() + 1);
		await waitFor(() => {
			expect(ui.count).toBe('Count: 1');
		});
		// expect(ui.count).toBe('Count: 1');

		counterStore.assign({ name: 'Updated Counter' });

		await waitFor(() => {
			expect(ui.getByText('Name: Updated Counter')).toBeInTheDocument();
		});
	});

	describe('Should be able to extend hooks and rerender when the store changes', () => {
		const altStore = createStore({
			name: 'zustandX',
			stars: 0,
		})
			.extend((store) => ({
				getValidName: () => store.name.get().trim(),
			}))
			.extend((store) => ({
				useValidName: () => store.name.use().trim(),
			}));

		const ComponentUsingGet = () => {
			const renderCount = useRef(0);
			const _name = altStore.getValidName();
			renderCount.current++;
			return (
				<div data-testid={testIds.componentUsingGetRenderCount}>
					{renderCount.current}
				</div>
			);
		};

		const ComponentUsingUse = () => {
			const renderCount = useRef(0);
			const _name = altStore.useValidName();
			renderCount.current++;
			return (
				<div data-testid={testIds.componentUsingUseRenderCount}>
					{renderCount.current}
				</div>
			);
		};

		it('should update only the component using useValidName when the name changes', () => {
			const renderResult = render(
				<>
					<ComponentUsingGet />
					<ComponentUsingUse />
				</>
			);
			const ui = getUi(renderResult);

			expect(ui.componentUsingGetRenderCount).toBe('1');
			expect(ui.componentUsingUseRenderCount).toBe('1');

			act(() => {
				altStore.name.set('zustandX-updated');
			});

			expect(ui.componentUsingGetRenderCount).toBe('1');
			expect(ui.componentUsingUseRenderCount).toBe('2');

			act(() => {
				altStore.stars.set(10);
			});

			expect(ui.componentUsingGetRenderCount).toBe('1');
			expect(ui.componentUsingUseRenderCount).toBe('2');
		});
	});

	describe('Should be able to extend hooks and rerender when the store changes with useSearchBooks', () => {
		const books = [
			{ title: 'Book 1', category: 'Fiction' },
			{ title: 'Book 2', category: 'Science' },
			{ title: 'Book 3', category: 'Fiction' },
			{ title: 'Book 4', category: 'History' },
		];

		const altStore = createStore({
			searchTerm: '',
		}).extend((store) => ({
			useSearchBooks: (category: string) => {
				const [filteredBooks, setFilteredBooks] = useState([] as typeof books);
				const searchTerm = store.searchTerm.use();
				const prevSearchTermRef = useRef(searchTerm);

				useEffect(() => {
					if (prevSearchTermRef.current !== searchTerm) {
						setTimeout(() => {
							setFilteredBooks(
								books.filter((book) => {
									if (!searchTerm) return false;
									return (
										book.title
											.toLowerCase()
											.includes(searchTerm.toLowerCase()) &&
										book.category === category
									);
								})
							);
							prevSearchTermRef.current = searchTerm;
						}, 1);
					}
				}, [category, searchTerm]);

				return filteredBooks;
			},
		}));

		const ComponentUsingSearchBooks = () => {
			const renderCount = useRef(0);
			const filteredBooks = altStore.useSearchBooks('Fiction');
			renderCount.current++;
			return (
				<>
					<div data-testid={testIds.componentUsingSearchBooksRenderCount}>
						{renderCount.current}
					</div>
					<div data-testid={testIds.filteredBooks}>
						{JSON.stringify(filteredBooks)}
					</div>
				</>
			);
		};

		it('should update only the component using useSearchBooks when the searchTerm changes', async () => {
			const ui = getUi(render(<ComponentUsingSearchBooks />));

			expect(ui.componentUsingSearchBooksRenderCount).toBe('1');

			await waitFor(() => {
				expect(ui.filteredBooks).toBe('[]');
			});

			expect(ui.componentUsingSearchBooksRenderCount).toBe('1');

			act(() => {
				altStore.searchTerm.set('Book');
			});

			expect(ui.componentUsingSearchBooksRenderCount).toBe('2');

			await waitFor(() => {
				expect(ui.filteredBooks).toBe(
					JSON.stringify([
						{ title: 'Book 1', category: 'Fiction' },
						{ title: 'Book 3', category: 'Fiction' },
					])
				);
			});
		});
	});

	test('should create local stores with different initial values', async () => {
		const counterStore = createStore({ count: 0 });

		const Counter = () => {
			const localCounterStore = counterStore.useLocalStore();
			const count = localCounterStore.count.use();
			return (
				<div>
					<p data-testid={testIds.count}>Count: {count}</p>
					<button
						data-testid={testIds.increment}
						onClick={() =>
							localCounterStore.count.set(localCounterStore.count.get() + 1)
						}
					>
						Increment
					</button>
				</div>
			);
		};

		const MultipleCounters = () => {
			return (
				<>
					<counterStore.LocalProvider initialValue={{ count: 1 }}>
						<Counter />
					</counterStore.LocalProvider>
					<counterStore.LocalProvider initialValue={{ count: 5 }}>
						<Counter />
					</counterStore.LocalProvider>
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

	describe('local component store', () => {
		test('should be able to create and use local stores independently', async () => {
			const userStore = createStore({
				name: '',
				age: 25,
			}).extend((store) => ({
				incrementAge: () => store.age.set(store.age.get() + 1),
			}));

			const InnerComp = ({ id }: { id: string }) => {
				const localUserStore = userStore.useLocalStore();

				const name = localUserStore.name.use();
				const age = localUserStore.age.use();

				return (
					<>
						<div data-testid={`${testIds.userName}-${id}`}>{name}</div>
						<div data-testid={`${testIds.userAge}-${id}`}>{age}</div>
						<button
							type="button"
							data-testid={`${testIds.incrementAge}-${id}`}
							onClick={localUserStore.incrementAge}
						>
							Increment Age
						</button>
						<button
							type="button"
							data-testid={`${testIds.setAge}-${id}`}
							onClick={() =>
								localUserStore.age.set(localUserStore.age.get() + 1)
							}
						>
							Set Age
						</button>
					</>
				);
			};

			const Comp1 = () => {
				return (
					<userStore.LocalProvider initialValue={{ name: 'comp1' }}>
						<InnerComp id="comp1" />
					</userStore.LocalProvider>
				);
			};

			const Comp2 = () => {
				return (
					<userStore.LocalProvider initialValue={{ name: 'comp2' }}>
						<InnerComp id="comp2" />
					</userStore.LocalProvider>
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

	describe("should be able to use the store's state in a callback", () => {
		const countStore = createStore({ count: 0 }).extend((store) => ({
			incrementUsingCalback: () => {
				store.count.set((prev) => prev + 1);
			},
			incrementUsingGet: () => {
				store.count.set(store.count.get() + 1);
			},
		}));

		const Counter = () => {
			const count = countStore.count.use();

			return (
				<div>
					<p data-testid={testIds.count}>Count: {count}</p>
					<button
						data-testid={testIds.increment}
						onClick={countStore.incrementUsingCalback}
					>
						Increment
					</button>
					<button
						data-testid={testIds.increment + '-get'}
						onClick={countStore.incrementUsingGet}
					>
						Increment Using Get
					</button>
				</div>
			);
		};

		it('should increment the count using callback', () => {
			const ui = getUi(render(<Counter />));

			expect(ui.count).toBe('Count: 0');
			fireEvent.click(ui.increment);
			expect(ui.count).toBe('Count: 1');
		});

		it('should increment the count using get', () => {
			const ui = getUi(render(<Counter />));

			expect(ui.count).toBe('Count: 1');

			fireEvent.click(ui.getByTestId(testIds.increment + '-get'));
			expect(ui.count).toBe('Count: 2');
		});
	});
});
