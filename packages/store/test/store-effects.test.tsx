import { describe, expect, it, vi } from 'vitest';
import { store } from '../src';
// const countStore = store(2)
//   .computed((store) => ({
//     count: () => store.get() * 2,
//   }))
//   .effects((store) => ({
//     saveToDb: () =>
//       store.onChange((value, prevValue) => {
//         console.log('Saving to DB', store.get());
//       }),
//     log: () => store.onChange(console.log),
//   }));

describe('Store effects', () => {
	describe('Primitive values store', () => {
		it('should call the effect when the store value changes', () => {
			const cb = vi.fn();
			const countStore = store(2)
				.computed((store) => ({
					count: () => store.get() * 2,
				}))
				.effects((store) => ({
					testEffect: () => store.onChange(cb),
				}));

			expect(cb).toHaveBeenCalledTimes(0);
			countStore.set(11);

			expect(cb).toHaveBeenCalledTimes(1);
			countStore.set(12);
			expect(cb).toHaveBeenCalledTimes(2);
			expect(cb).toHaveBeenCalledWith(12, 11);

			countStore.unsubscribeFromEffects();
			countStore.set(13);
			expect(cb).toHaveBeenCalledTimes(2);
		});

		it('should call multiple effects when the store value changes', () => {
			const cb1 = vi.fn();
			const cb2 = vi.fn();
			const countStore = store(2)
				.computed((store) => ({
					count: () => store.get() * 2,
				}))
				.effects((store) => ({
					testEffect1: () => store.onChange(cb1),
					testEffect2: () => store.onChange(cb2),
				}));


				
			countStore.set(11);

			expect(cb1).toHaveBeenCalledTimes(1);
			expect(cb2).toHaveBeenCalledTimes(1);

			countStore.unsubscribeFromEffects();
			countStore.set(12);
			expect(cb1).toHaveBeenCalledTimes(1);
			expect(cb2).toHaveBeenCalledTimes(1);
		});

		it('should not call the effect after unsubscribing', () => {
			const cb = vi.fn();
			const countStore = store(2)
				.computed((store) => ({
					count: () => store.get() * 2,
				}))
				.effects((store) => ({
					testEffect: () => store.onChange(cb),
				}));

			countStore.set(11);
			expect(cb).toHaveBeenCalledTimes(1);

			countStore.unsubscribeFromEffects();
			countStore.set(12);
			expect(cb).toHaveBeenCalledTimes(1);
		});
	});

	describe('Nested values store', () => {
		it('should call the effect when a nested value changes', () => {
			const cb = vi.fn();
			const nestedStore = store({ parent: { count: 2 } }).effects((store) => ({
				testEffect: () => store.parent.count.onChange(cb),
			}));

			nestedStore.parent.count.set(11);

			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith(11, 2);

			nestedStore.unsubscribeFromEffects();
			nestedStore.parent.count.set(12);
			expect(cb).toHaveBeenCalledTimes(1);
		});

		it('should call the effect when a parent value changes', () => {
			const cb = vi.fn();
			const nestedStore = store({ parent: { count: 2 } }).effects((store) => ({
				testEffect: () => store.parent.onChange(cb),
			}));

			nestedStore.parent.count.set(11);

			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith({ count: 11 }, { count: 2 });

			nestedStore.unsubscribeFromEffects();
			nestedStore.parent.count.set(12);
			expect(cb).toHaveBeenCalledTimes(1);
		});
	});

	describe('Effects with dependencies', () => {
		it('should call the effect when a dependency changes', () => {
			const cb = vi.fn();
			const myStore = store({ num: 1, otherNum: 2 }).effects((store) => ({
				testEffect: () => store.onChange(cb, { deps: ['num'] }),
			}));

			myStore.num.set(5);
			expect(cb).toHaveBeenCalledTimes(1);

			myStore.otherNum.set(3);
			expect(cb).toHaveBeenCalledTimes(1);

			myStore.unsubscribeFromEffects();
			myStore.num.set(6);
			expect(cb).toHaveBeenCalledTimes(1);
		});

		it('should call the effect when a dependency callback returns different values', () => {
			const cb = vi.fn();
			const myStore = store({ num: 1, otherNum: 2 }).effects((store) => ({
				testEffect: () =>
					store.onChange(cb, {
						deps: (state) => [state.num, state.otherNum],
					}),
			}));

			myStore.num.set(5);
			expect(cb).toHaveBeenCalledTimes(1);

			myStore.otherNum.set(3);
			expect(cb).toHaveBeenCalledTimes(2);

			myStore.unsubscribeFromEffects();
			myStore.num.set(6);
			expect(cb).toHaveBeenCalledTimes(2);
		});
	});
});
