// import React, { useEffect, useRef, useState } from 'react';
// import {
// 	act,
// 	fireEvent,
// 	render,
// 	renderHook,
// 	waitFor,
// } from '@testing-library/react';

// import { createZustandStore } from '../src/createStore';
// import { createAltStore } from '../src/createStoreAlt';
// import { beforeEach, describe, expect, it, test } from 'vitest';

// describe('createAtomStore', () => {
// 	describe('single provider', () => {
// 		type MyTestStoreValue = {
// 			name: string;
// 			age: number;
// 		};

// 		const INITIAL_NAME = 'John';
// 		const INITIAL_AGE = 42;

// 		const initialTestStoreValue: MyTestStoreValue = {
// 			name: INITIAL_NAME,
// 			age: INITIAL_AGE,
// 		};

// 		const store = createZustandStore('myTestStore')(initialTestStoreValue);
// 		const useSelectors = () => store.use;
// 		const actions = store.set;
// 		const selectors = store.get;

// 		const ReadOnlyConsumer = () => {
// 			const name = useSelectors().name();
// 			const age = useSelectors().age();

// 			return (
// 				<div>
// 					<span>{name}</span>
// 					<span>{age}</span>
// 				</div>
// 			);
// 		};

// 		const WriteOnlyConsumer = () => {
// 			return (
// 				<button
// 					type="button"
// 					onClick={() => {
// 						selectors.age();
// 						actions.age(selectors.age() + 1);
// 					}}
// 				>
// 					consumerSetAge
// 				</button>
// 			);
// 		};

// 		beforeEach(() => {
// 			renderHook(() => actions.name(INITIAL_NAME));
// 			renderHook(() => actions.age(INITIAL_AGE));
// 		});

// 		it('read only', () => {
// 			const { getByText } = render(<ReadOnlyConsumer />);

// 			expect(getByText(INITIAL_AGE)).toBeInTheDocument();
// 		});

// 		it('actions', () => {
// 			const { getByText } = render(
// 				<>
// 					<ReadOnlyConsumer />
// 					<WriteOnlyConsumer />
// 				</>
// 			);
// 			expect(getByText(INITIAL_NAME)).toBeInTheDocument();
// 			expect(getByText(INITIAL_AGE)).toBeInTheDocument();

// 			act(() => getByText('consumerSetAge').click());

// 			expect(getByText(INITIAL_NAME)).toBeInTheDocument();
// 			expect(getByText(INITIAL_AGE + 1)).toBeInTheDocument();
// 			expect(store.store.getState().age).toBe(INITIAL_AGE + 1);
// 		});
// 	});

// 	describe('multiple unrelated stores', () => {
// 		type MyFirstTestStoreValue = { name: string };
// 		type MySecondTestStoreValue = { age: number };

// 		const initialFirstTestStoreValue: MyFirstTestStoreValue = {
// 			name: 'My name',
// 		};

// 		const initialSecondTestStoreValue: MySecondTestStoreValue = {
// 			age: 72,
// 		};

// 		const myFirstTestStoreStore = createZustandStore('myFirstTestStore')(
// 			initialFirstTestStoreValue
// 		);
// 		const mySecondTestStoreStore = createZustandStore('mySecondTestStore')(
// 			initialSecondTestStoreValue
// 		);

// 		const FirstReadOnlyConsumer = () => {
// 			const name = myFirstTestStoreStore.use.name();

// 			return (
// 				<div>
// 					<span>{name}</span>
// 				</div>
// 			);
// 		};

// 		const SecondReadOnlyConsumer = () => {
// 			const age = mySecondTestStoreStore.use.age();

// 			return (
// 				<div>
// 					<span>{age}</span>
// 				</div>
// 			);
// 		};

// 		it('returns the value for the correct store', () => {
// 			const { getByText } = render(
// 				<>
// 					<FirstReadOnlyConsumer />
// 					<SecondReadOnlyConsumer />
// 				</>
// 			);

// 			expect(getByText('My name')).toBeInTheDocument();
// 			expect(getByText(72)).toBeInTheDocument();
// 		});
// 	});
// });

// describe('createAltStore', () => {
// 	describe('single provider', () => {
// 		type MyTestStoreValue = {
// 			name: string;
// 			age: number;
// 		};

// 		const INITIAL_NAME = 'John';
// 		const INITIAL_AGE = 42;

// 		const initialTestStoreValue: MyTestStoreValue = {
// 			name: INITIAL_NAME,
// 			age: INITIAL_AGE,
// 		};

// 		const store = createAltStore('myTestStore')(initialTestStoreValue);

// 		const ReadOnlyConsumer = () => {
// 			const name = store.name.use();
// 			const age = store.age.use();

// 			return (
// 				<div>
// 					<span>{name}</span>
// 					<span>{age}</span>
// 				</div>
// 			);
// 		};

// 		const WriteOnlyConsumer = () => {
// 			return (
// 				<button
// 					type="button"
// 					onClick={() => {
// 						store.age.set(store.age.get() + 1);
// 					}}
// 				>
// 					consumerSetAge
// 				</button>
// 			);
// 		};

// 		beforeEach(() => {
// 			renderHook(() => store.name.set(INITIAL_NAME));
// 			renderHook(() => store.age.set(INITIAL_AGE));
// 		});

// 		it('read only', () => {
// 			const { getByText } = render(<ReadOnlyConsumer />);

// 			expect(getByText(INITIAL_NAME)).toBeInTheDocument();
// 			expect(getByText(INITIAL_AGE)).toBeInTheDocument();
// 		});

// 		it('actions', () => {
// 			const { getByText } = render(
// 				<>
// 					<ReadOnlyConsumer />
// 					<WriteOnlyConsumer />
// 				</>
// 			);
// 			expect(getByText(INITIAL_NAME)).toBeInTheDocument();
// 			expect(getByText(INITIAL_AGE)).toBeInTheDocument();

// 			act(() => getByText('consumerSetAge').click());

// 			expect(getByText(INITIAL_NAME)).toBeInTheDocument();
// 			expect(getByText(INITIAL_AGE + 1)).toBeInTheDocument();
// 			expect(store.age.get()).toBe(INITIAL_AGE + 1);
// 		});
// 	});
// 	describe('Should be able to extend hooks and rerender when the store changes', () => {
// 		const altStore = createAltStore('repo')({
// 			name: 'zustandX',
// 			stars: 0,
// 		})
// 			.withComputed((store) => ({
// 				getValidName: () => store.name.get().trim(),
// 			}))
// 			.withComputed((store) => ({
// 				useValidName: () => store.name.use().trim(),
// 			}));

// 		const ComponentUsingGet = () => {
// 			const renderCount = useRef(0);
// 			const _name = altStore.getValidName();
// 			renderCount.current++;
// 			return (
// 				<div data-testid="component-using-get-render-count">
// 					{renderCount.current}
// 				</div>
// 			);
// 		};

// 		const ComponentUsingUse = () => {
// 			const renderCount = useRef(0);
// 			const _name = altStore.useValidName();
// 			renderCount.current++;
// 			return (
// 				<div data-testid="component-using-use-render-count">
// 					{renderCount.current}
// 				</div>
// 			);
// 		};

// 		it('should update only the component using useValidName when the name changes', () => {
// 			const { getByTestId } = render(
// 				<>
// 					<ComponentUsingGet />
// 					<ComponentUsingUse />
// 				</>
// 			);

// 			expect(getByTestId('component-using-get-render-count')).toHaveTextContent(
// 				'1'
// 			);
// 			expect(getByTestId('component-using-use-render-count')).toHaveTextContent(
// 				'1'
// 			);

// 			act(() => {
// 				altStore.name.set('zustandX-updated');
// 			});

// 			expect(getByTestId('component-using-get-render-count')).toHaveTextContent(
// 				'1'
// 			);
// 			expect(getByTestId('component-using-use-render-count')).toHaveTextContent(
// 				'2'
// 			);

// 			act(() => {
// 				altStore.stars.set(10);
// 			});

// 			expect(getByTestId('component-using-get-render-count')).toHaveTextContent(
// 				'1'
// 			);
// 			expect(getByTestId('component-using-use-render-count')).toHaveTextContent(
// 				'2'
// 			);
// 		});
// 	});

// 	describe('Should be able to extend hooks and rerender when the store changes with useSearchBooks', () => {
// 		const books = [
// 			{ title: 'Book 1', category: 'Fiction' },
// 			{ title: 'Book 2', category: 'Science' },
// 			{ title: 'Book 3', category: 'Fiction' },
// 			{ title: 'Book 4', category: 'History' },
// 		];

// 		const altStore = createAltStore('repo')({
// 			searchTerm: '',
// 		}).withComputed((store) => ({
// 			useSearchBooks: (category: string) => {
// 				const [filteredBooks, setFilteredBooks] = useState([] as typeof books);
// 				const searchTerm = store.searchTerm.use();
// 				const prevSearchTermRef = useRef(searchTerm);

// 				useEffect(() => {
// 					if (prevSearchTermRef.current !== searchTerm) {
// 						setTimeout(() => {
// 							setFilteredBooks(
// 								books.filter((book) => {
// 									if (!searchTerm) return false;
// 									return (
// 										book.title
// 											.toLowerCase()
// 											.includes(searchTerm.toLowerCase()) &&
// 										book.category === category
// 									);
// 								})
// 							);
// 							prevSearchTermRef.current = searchTerm;
// 						}, 1);
// 					}
// 				}, [category, searchTerm]);

// 				return filteredBooks;
// 			},
// 		}));

// 		const ComponentUsingSearchBooks = () => {
// 			const renderCount = useRef(0);
// 			const filteredBooks = altStore.useSearchBooks('Fiction');
// 			renderCount.current++;
// 			return (
// 				<>
// 					<div data-testid="component-using-search-books-render-count">
// 						{renderCount.current}
// 					</div>
// 					<div data-testid="filtered-books">
// 						{JSON.stringify(filteredBooks)}
// 					</div>
// 				</>
// 			);
// 		};

// 		it('should update only the component using useSearchBooks when the searchTerm changes', async () => {
// 			const { getByTestId } = render(<ComponentUsingSearchBooks />);

// 			expect(
// 				getByTestId('component-using-search-books-render-count')
// 			).toHaveTextContent('1');

// 			await waitFor(() => {
// 				expect(getByTestId('filtered-books')).toHaveTextContent(
// 					JSON.stringify([])
// 				);
// 			});

// 			expect(
// 				getByTestId('component-using-search-books-render-count')
// 			).toHaveTextContent('1');

// 			act(() => {
// 				altStore.searchTerm.set('Book');
// 			});

// 			expect(
// 				getByTestId('component-using-search-books-render-count')
// 			).toHaveTextContent('2'); // correct now!

// 			await waitFor(() => {
// 				expect(getByTestId('filtered-books')).toHaveTextContent(
// 					JSON.stringify([
// 						{ title: 'Book 1', category: 'Fiction' },
// 						{ title: 'Book 3', category: 'Fiction' },
// 					])
// 				);
// 			});
// 		});
// 	});

// 	describe('local component store', () => {
// 		test('should be able to create and use local stores independently', async () => {
// 			const userStore = createAltStore('userStore')({
// 				name: '',
// 				age: 25,
// 			}).withComputed((store) => ({
// 				incrementAge: () => store.age.set(store.age.get() + 1),
// 			}));

// 			const InnerComp = ({ id }: { id: string }) => {
// 				const localUserStore = userStore.useLocalStore();

// 				const name = localUserStore.name.use();
// 				const age = localUserStore.age.use();

// 				console.log('INSIDE InnerComp', name, age);

// 				return (
// 					<>
// 						<div data-testid={`user-name-${id}`}>{name}</div>
// 						<div data-testid={`user-age-${id}`}>{age}</div>
// 						<button
// 							type="button"
// 							data-testid={`increment-age-${id}`}
// 							onClick={localUserStore.incrementAge}
// 						>
// 							Increment Age
// 						</button>
// 						<button
// 							type="button"
// 							data-testid={`set-age-${id}`}
// 							onClick={() =>
// 								localUserStore.age.set(localUserStore.age.get() + 1)
// 							}
// 						>
// 							Increment Age
// 						</button>
// 					</>
// 				);
// 			};

// 			const Comp1 = () => {
// 				return (
// 					<userStore.LocalProvider initialValue={{ name: 'comp1' }}>
// 						<InnerComp id="comp1" />
// 					</userStore.LocalProvider>
// 				);
// 			};

// 			const Comp2 = () => {
// 				return (
// 					<userStore.LocalProvider initialValue={{ name: 'comp2' }}>
// 						<InnerComp id="comp2" />
// 					</userStore.LocalProvider>
// 				);
// 			};

// 			const { getByTestId } = render(
// 				<>
// 					<Comp1 />
// 					<Comp2 />
// 				</>
// 			);

// 			expect(getByTestId('user-name-comp1')).toHaveTextContent('comp1');
// 			expect(getByTestId('user-name-comp2')).toHaveTextContent('comp2');

// 			act(() => {
// 				fireEvent.click(getByTestId('set-age-comp1'));
// 			});

// 			await waitFor(() => {
// 				expect(getByTestId('user-age-comp1')).toHaveTextContent('26'); // direct set methods working as expected
// 				expect(getByTestId('user-age-comp2')).toHaveTextContent('25');
// 			});

// 			act(() => {
// 				fireEvent.click(getByTestId('increment-age-comp2'));
// 				fireEvent.click(getByTestId('increment-age-comp2'));
// 				fireEvent.click(getByTestId('increment-age-comp2'));
// 			});

// 			await waitFor(() => {
// 				expect(getByTestId('user-age-comp1')).toHaveTextContent('26');
// 				// however the withComputed method is not working as expected
// 				expect(getByTestId('user-age-comp2')).toHaveTextContent('28');
// 			});
// 		});
// 	});
// });
