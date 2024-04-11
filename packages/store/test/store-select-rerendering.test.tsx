import React, { useContext, useMemo, useRef, useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import { create as createZustandStore } from 'zustand';

import { store } from '../src/store';

import { describe, expect, test } from 'vitest';

describe('store performance', () => {
	describe('parent / child automatic render optimization / selectors', () => {
		const testIds = {
			parentRenderCount: 'parent-render-count',
			childRenderCount: 'child-render-count',
		};

		const getUi = ({ getByTestId }: ReturnType<typeof render>) => {
			return {
				get parentRenderCount() {
					return getByTestId(testIds.parentRenderCount).textContent;
				},
				get childRenderCount() {
					return getByTestId(testIds.childRenderCount).textContent;
				},
			};
		};

		test('context: non-selective rerendering', async () => {
			const MyContext = React.createContext(0);

			const Child = () => {
				const renderCount = useRef(0);
				const contextValue = useContext(MyContext);
				renderCount.current++;
				return (
					<span data-testid={testIds.childRenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const Parent = () => {
				const renderCount = useRef(0);
				const [contextValue, setContextValue] = useState(0);
				renderCount.current++;
				return (
					<MyContext.Provider value={contextValue}>
						<button
							type="button"
							onClick={() => setContextValue((prevValue) => prevValue + 1)}
						>
							Increment
						</button>
						<span data-testid={testIds.parentRenderCount}>
							{renderCount.current}
						</span>
						<Child />
					</MyContext.Provider>
				);
			};

			const renderResult = render(<Parent />);
			const ui = getUi(renderResult);
			const { getByText } = renderResult;

			// Initial render
			expect(ui.parentRenderCount).toBe('1');
			expect(ui.childRenderCount).toBe('1');

			fireEvent.click(getByText('Increment'));

			await waitFor(() => {
				// both Parent and Child should re-render
				expect(ui.parentRenderCount).toBe('2');
				expect(ui.childRenderCount).toBe('2');
			});
		});
	});

	describe('sibling automatic render optimization / selectors', () => {
		const testId = {
			componentARenderCount: 'component-a-render-count',
			componentBRenderCount: 'component-b-render-count',
			ctxWrapperRenderCount: 'ctx-wrapper-render-count',
		};

		const getUi = ({ getByTestId }: ReturnType<typeof render>) => {
			return {
				get componentARenderCount() {
					return getByTestId(testId.componentARenderCount).textContent;
				},
				get componentBRenderCount() {
					return getByTestId(testId.componentBRenderCount).textContent;
				},
				get ctxWrapperRenderCount() {
					return getByTestId(testId.ctxWrapperRenderCount).textContent;
				},
			};
		};

		test('context: non-selective rerendering', async () => {
			const CountContext = React.createContext({ countA: 0, countB: 0 });

			const ComponentA = () => {
				const renderCount = useRef(0);
				const { countA } = useContext(CountContext);
				renderCount.current++;
				return (
					<span data-testid={testId.componentARenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const ComponentB = () => {
				const renderCount = useRef(0);
				const { countB } = useContext(CountContext);
				renderCount.current++;
				return (
					<span data-testid={testId.componentBRenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const CtxWrapper = ({ children }: { children: React.ReactNode }) => {
				const [count, setCount] = useState({ countA: 0, countB: 0 });
				const renderCount = useRef(0);
				renderCount.current++;
				return (
					<CountContext.Provider value={count}>
						<span data-testid={testId.ctxWrapperRenderCount}>
							{renderCount.current}
						</span>
						<button
							type="button"
							onClick={() =>
								setCount((prevCount) => ({
									...prevCount,
									countA: prevCount.countA + 1,
								}))
							}
						>
							Increment A
						</button>
						<button
							type="button"
							onClick={() =>
								setCount((prevCount) => ({
									...prevCount,
									countB: prevCount.countB + 1,
								}))
							}
						>
							Increment B
						</button>
						{children}
					</CountContext.Provider>
				);
			};

			const renderResult = render(
				<CtxWrapper>
					<ComponentA />
					<ComponentB />
				</CtxWrapper>
			);
			const ui = getUi(renderResult);

			// Initial render
			expect(ui.componentARenderCount).toBe('1');
			expect(ui.componentBRenderCount).toBe('1');
			expect(ui.ctxWrapperRenderCount).toBe('1');

			act(() => {
				fireEvent.click(renderResult.getByText('Increment A'));
			});

			await waitFor(() => {
				// All components should re-render
				expect(ui.componentARenderCount).toBe('2');
				expect(ui.componentBRenderCount).toBe('2');
				expect(ui.ctxWrapperRenderCount).toBe('2');
			});

			act(() => {
				fireEvent.click(renderResult.getByText('Increment B'));
			});

			await waitFor(() => {
				// All components should re-render
				expect(ui.componentARenderCount).toBe('3');
				expect(ui.componentBRenderCount).toBe('3');
				expect(ui.ctxWrapperRenderCount).toBe('3');
			});
		});

		test('zustand: selective rerendering', async () => {
			type ZustandStore = {
				countA: number;
				countB: number;
				incrementB: () => void;
			};

			const useStore = createZustandStore<ZustandStore>((set) => ({
				countA: 0,
				countB: 0,
				incrementB: () => set((state) => ({ countB: state.countB + 1 })),
			}));

			const ComponentA = () => {
				const renderCount = useRef(0);
				const countA = useStore((state) => state.countA);
				// const countA = useStore((state) => state.countA);
				renderCount.current++;
				return (
					<span data-testid={testId.componentARenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const ComponentB = () => {
				const renderCount = useRef(0);
				const countB = useStore((state) => state.countB);
				renderCount.current++;
				return (
					<span data-testid={testId.componentBRenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const renderResult = render(
				<>
					<ComponentA />
					<ComponentB />
				</>
			);
			const ui = getUi(renderResult);

			// Initial render
			expect(useStore.getState().countA).toBe(0);
			expect(useStore.getState().countB).toBe(0);
			expect(ui.componentARenderCount).toBe('1');
			expect(ui.componentBRenderCount).toBe('1');

			act(() => {
				useStore.getState().incrementB();
			});

			await waitFor(() => {
				// Only ComponentB should re-render
				expect(ui.componentARenderCount).toBe('1');
				expect(ui.componentBRenderCount).toBe('2');
				expect(useStore.getState().countB).toBe(1);
			});
		});

		test('davstack store: selective rerendering', async () => {
			const myStore = store({
				countA: 0,
				countB: 0,
			}).extend((store) => ({
				incrementB: () => {
					store.countB.set(store.countB.get() + 1);
				},
			}));
			const ComponentA = () => {
				const renderCount = useRef(0);

				renderCount.current++;
				return (
					<span data-testid={testId.componentARenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const ComponentB = () => {
				const renderCount = useRef(0);
				const countB = myStore.countB.use();
				renderCount.current++;
				return (
					<span data-testid={testId.componentBRenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const renderResult = render(
				<>
					<ComponentA />
					<ComponentB />
				</>
			);
			const ui = getUi(renderResult);

			// Initial render
			expect(myStore.countA.get()).toBe(0);
			expect(myStore.countB.get()).toBe(0);
			expect(ui.componentARenderCount).toBe('1');
			expect(ui.componentBRenderCount).toBe('1');

			act(() => {
				// myStore.set.incrementB();
				myStore.countB.set(myStore.countB.get() + 1);
			});

			await waitFor(() => {
				// Only ComponentB should re-render
				expect(ui.componentARenderCount).toBe('1');
				expect(ui.componentBRenderCount).toBe('2');
				expect(myStore.countB.get()).toBe(1);
			});
		});
		test('davstack store: selective rerendering: nested', async () => {
			const myStore = store({
				parent: {
					countA: 0,
					countB: 0,
				},
			}).extend((store) => ({
				incrementB: () => {
					store.parent.countB.set(store.parent.countB.get() + 1);
				},
			}));
			const ComponentA = () => {
				const renderCount = useRef(0);

				renderCount.current++;
				return (
					<span data-testid={testId.componentARenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const ComponentB = () => {
				const renderCount = useRef(0);
				const countB = myStore.parent.countB.use();
				renderCount.current++;
				return (
					<span data-testid={testId.componentBRenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const renderResult = render(
				<>
					<ComponentA />
					<ComponentB />
				</>
			);
			const ui = getUi(renderResult);

			// Initial render
			expect(myStore.parent.countA.get()).toBe(0);
			expect(myStore.parent.countB.get()).toBe(0);
			expect(ui.componentARenderCount).toBe('1');
			expect(ui.componentBRenderCount).toBe('1');

			act(() => {
				// myStore.set.incrementB();
				myStore.parent.countB.set(myStore.parent.countB.get() + 1);
			});

			await waitFor(() => {
				// Only ComponentB should re-render
				expect(ui.componentARenderCount).toBe('1');
				expect(ui.componentBRenderCount).toBe('2');
				expect(myStore.parent.countB.get()).toBe(1);
			});
		});
		test('davstack store: selective rerendering: nested DIFFERENT', async () => {
			const counterStore = store({
				count: 0,
			})
				.computed((store) => ({
					doubleCount: () => store.count.get() * 2,
				}))
				.extend((store) => ({
					increment: () => store.count.set(store.count.get() + 1),
					decrement: () => store.count.set(store.count.get() - 1),
				}));

			const ComponentA = () => {
				const renderCount = useRef(0);

				renderCount.current++;

				counterStore.count.use();
				return (
					<span data-testid={testId.componentARenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const ComponentB = () => {
				const renderCount = useRef(0);

				const doubleCount = counterStore.doubleCount.use();
				renderCount.current++;
				return (
					<span data-testid={testId.componentBRenderCount}>
						{renderCount.current}
					</span>
				);
			};

			const renderResult = render(
				<>
					<ComponentA />
					<ComponentB />
				</>
			);
			const ui = getUi(renderResult);

			// Initial render
			expect(counterStore.count.get()).toBe(0);
			expect(counterStore.doubleCount.get()).toBe(0);
			expect(ui.componentARenderCount).toBe('1');
			expect(ui.componentBRenderCount).toBe('1');

			act(() => {
				// myStore.set.incrementB();
				counterStore.count.set(counterStore.count.get() + 1);
			});

			await waitFor(() => {
				// Only ComponentB should re-render
				expect(ui.componentARenderCount).toBe('2');
				expect(ui.componentBRenderCount).toBe('1');
				expect(counterStore.count.get()).toBe(1);
				expect(counterStore.doubleCount.get()).toBe(2);
			});
		});
	});
});
