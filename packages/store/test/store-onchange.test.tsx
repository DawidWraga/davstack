import { describe, expect, it, test, vi } from 'vitest';
import { store } from '../src';
import { shallow } from 'zustand/shallow';

describe('Store onChange method', () => {
	describe('Primitive values store', () => {
		const countStore = store(2);

		it('should call the listener when the store value changes', () => {
			const cb = vi.fn();
			countStore.set(11);
			const unsub = countStore.onChange(cb);
			countStore.set(12);
			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith(12, 11);
			unsub();
			countStore.set(13);
			expect(cb).toHaveBeenCalledTimes(1);
		});

		it('should call the listener immediately if fireImmediately option is true', async () => {
			const mockCallback = vi.fn();
			const unsub = countStore.onChange(mockCallback, {
				fireImmediately: true,
			});
			expect(mockCallback).toHaveBeenCalledTimes(1);
			expect(mockCallback).toHaveBeenCalledWith(13, 13);
			unsub();
		});

		it('should respect the custom equality checker', () => {
			const mockCallback = vi.fn();
			const unsub = countStore.onChange(mockCallback, {
				equalityChecker: () => true,
			});
			countStore.set(14);
			expect(mockCallback).toHaveBeenCalledTimes(0);
			unsub();
		});
	});

	describe('Nested object store', () => {
		const nestedStore = store({ parent: { count: 2 }, parent2: { count: 3 } });

		it('should call the listener when a nested value changes', () => {
			const cb = vi.fn();
			nestedStore.parent.count.set(8);
			const unsub = nestedStore.parent.count.onChange(cb);
			nestedStore.parent.count.set(9);
			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith(9, 8);
			unsub();
			nestedStore.parent.count.set(10);
			expect(cb).toHaveBeenCalledTimes(1);
		});

		it('should not fire other subscribes when a nested value changes', () => {
			const cb1 = vi.fn();
			const cb2 = vi.fn();
			const unsub1 = nestedStore.parent.onChange(cb1);
			const unsub2 = nestedStore.parent2.onChange(cb2);
			nestedStore.parent.count.set(11);
			expect(cb1).toHaveBeenCalledTimes(1);
			expect(cb2).toHaveBeenCalledTimes(0);
			unsub1();
			unsub2();
		});
	});

	describe('onChange options', () => {
		const myStore = store({ num: 1, otherNum: 2, parent: { child: 3 } });

		it('should trigger the callback when deps array values change', () => {
			const mockCallback = vi.fn();
			const unsub = myStore.onChange(mockCallback, { deps: ['num'] });
			myStore.num.set(5);
			expect(mockCallback).toHaveBeenCalledTimes(1);
			myStore.otherNum.set(3);
			expect(mockCallback).toHaveBeenCalledTimes(1);
			unsub();
		});

		it('should trigger the callback when deps callback dependencies change', () => {
			const mockCallback1 = vi.fn();
			const unsub1 = myStore.onChange(mockCallback1, {
				deps: (state) => [state.num, state.otherNum],
			});
			myStore.num.set(6);
			expect(mockCallback1).toHaveBeenCalledTimes(1);
			myStore.otherNum.set(4);
			expect(mockCallback1).toHaveBeenCalledTimes(2);
			unsub1();

			const mockCallback2 = vi.fn();
			const unsub2 = myStore.onChange(mockCallback2, {
				deps: ['num', 'otherNum'],
			});
			myStore.num.set(7);
			expect(mockCallback2).toHaveBeenCalledTimes(1);
			myStore.otherNum.set(5);
			myStore.otherNum.set(6);
			myStore.otherNum.set(7);
			expect(mockCallback2).toHaveBeenCalledTimes(4);
			unsub2();
		});
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
