import { act, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, it, test, vi } from 'vitest';
import { store, StoreApi } from '../src';
import { a } from 'vitest/dist/suite-a18diDsI';

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

describe('store onchange', () => {
	describe('primative values store', () => {
		const countStore = store(2);

		test('onChange', () => {
			const cb = vi.fn();
			countStore.set(11);
			countStore.onChange(cb);
			countStore.set(12);
			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith(12, 11);
		});
	});

	describe('nested object store', () => {
		const countStore = store({ parent: { count: 2 } });

		test('onChange', () => {
			const cb = vi.fn();
			countStore.parent.count.set(8);
			countStore.parent.count.onChange(cb);
			countStore.parent.count.set(9);
			expect(cb).toHaveBeenCalledTimes(1);
			// 1st = current; 2 = prev
			expect(cb).toHaveBeenCalledWith(9, 8);
		});
	});

	describe('onChange should not fire other subscribes', () => {
		const countStore = store({ parent1: { count: 1 }, parent2: { count: 2 } });

		test('v1', () => {
			const cb1 = vi.fn();
			const cb2 = vi.fn();

			countStore.parent1.count.onChange(cb1);
			countStore.parent2.count.onChange(cb2);

			countStore.parent1.count.set(10);

			expect(cb1).toHaveBeenCalledTimes(1);
			expect(cb2).toHaveBeenCalledTimes(0);
		});

		test('v2', () => {
			const cb1 = vi.fn();
			const cb2 = vi.fn();

			countStore.parent1.onChange(cb1);
			countStore.parent2.onChange(cb2);

			countStore.parent2.count.set(20);

			expect(cb1).toHaveBeenCalledTimes(0);
			expect(cb2).toHaveBeenCalledTimes(1);
		});
	});
	// describe('store effect helper ', () => {
	// 	const countStore = store({
	// 		parent1: { count: 1 },
	// 		parent2: { count: 2 },
	// 	});

	// 	test('v1', () => {
	// 		const cb1 = vi.fn();
	// 		const cb2 = vi.fn();

	// 		countStore.parent1.count.onChange(cb1);
	// 		countStore.parent2.count.onChange(cb2);

	// 		countStore.parent1.count.set(10);

	// 		expect(cb1).toHaveBeenCalledTimes(1);
	// 		expect(cb2).toHaveBeenCalledTimes(0);
	// 	});

	// 	test('v2', () => {
	// 		const cb1 = vi.fn();
	// 		const cb2 = vi.fn();

	// 		countStore.parent1.onChange(cb1);
	// 		countStore.parent2.onChange(cb2);

	// 		countStore.parent2.count.set(20);

	// 		expect(cb1).toHaveBeenCalledTimes(0);
	// 		expect(cb2).toHaveBeenCalledTimes(1);
	// 	});
	// });
});

describe('Store onChange method', () => {
	it('should call the listener immediately if immediate option is true', async () => {
		const initialState = { data: 'initial' };
		const myStore = store(initialState);

		const mockCallback = vi.fn();
		myStore.onChange(mockCallback, { fireImmediately: true });

		expect(mockCallback).toHaveBeenCalledTimes(1);
		expect(mockCallback).toHaveBeenCalledWith(initialState, initialState);
	});

	it('should respect the custom equality function', () => {
		const myStore = store({ num: 1 });

		const mockCallback2 = vi.fn();
		myStore.onChange(mockCallback2, {
			equalityFn: () => true,
		});

		myStore.num.set(5);
		expect(mockCallback2).toHaveBeenCalledTimes(0);
		myStore.num.set(3);

		expect(mockCallback2).toHaveBeenCalledTimes(0);
		myStore.assign({ num: 5 });
		expect(mockCallback2).toHaveBeenCalledTimes(0);
	});

	it("additional dependencies should trigger the callback when they're changed", () => {
		const myStore = store({ num: 1, otherNum: 2 });

		const mockCallback = vi.fn();
		myStore.onChange(mockCallback, { additionalDeps: ['otherNum'] });

		myStore.num.set(5);
		expect(mockCallback).toHaveBeenCalledTimes(1);
		myStore.otherNum.set(3);
		expect(mockCallback).toHaveBeenCalledTimes(2);
	});
	it('custom selector should work as intended', () => {
		const myStore = store({ num: 1, otherNum: 2 });

		const mockCallback1 = vi.fn();
		myStore.num.onChange(mockCallback1, { additionalDeps: ['otherNum'] });

		myStore.num.set(5);
		expect(mockCallback1).toHaveBeenCalledTimes(1);
		myStore.otherNum.set(3);
		expect(mockCallback1).toHaveBeenCalledTimes(2);

		const mockCallback2 = vi.fn();
		myStore.num.onChange(mockCallback2, { additionalDeps: [] });

		myStore.num.set(9);
		expect(mockCallback2).toHaveBeenCalledTimes(1);
		myStore.otherNum.set(3);
		expect(mockCallback2).toHaveBeenCalledTimes(1); // this time, the callback should not be called
	});
});