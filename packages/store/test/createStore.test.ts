/* eslint-disable @typescript-eslint/no-shadow */
/* eslint-disable prettier/prettier */
import { describe, expect, it } from 'vitest';
import { createStore } from '../src/createStore';
import { createAltStore } from '../src/createStoreAlt';
describe('zustandX', () => {
	describe('when get', () => {
		const store = createStore('repo')({
			name: 'zustandX',
			stars: 0,
		});

		const altStore = createAltStore('repo')({
			name: 'zustandX',
			stars: 0,
		});

		it('should be', () => {
			expect(store.get.name()).toEqual('zustandX');
			expect(altStore.name.get()).toEqual('zustandX');
		});
	});

	describe('when extending actions', () => {
		const store = createStore('repo')({
			name: 'zustandX',
			stars: 0,
		})
			.extendActions((set, get, api) => ({
				validName: (name: string) => {
					set.name(name.trim());
				},
			}))
			.extendActions((set, get, api) => ({
				reset: (name: string) => {
					set.validName(name);
					set.stars(0);
				},
			}));

		const altStore = createAltStore('repo')({
			name: 'zustandX',
			stars: 0,
		})
			.withComputed((store) => ({
				setValidName: (name: string) => {
					store.name.set(name.trim());
				},
			}))
			.withComputed((store) => ({
				resetStore: (name: string) => {
					store.setValidName(name);
					store.stars.set(0);
				},
			}));

		it('should be', () => {
			store.set.reset('test ');

			expect(store.get.state()).toEqual({
				name: 'test',
				stars: 0,
			});
		});

		it('ALT should be', () => {
			altStore.resetStore('test ');

			expect(altStore.get()).toEqual({
				name: 'test',
				stars: 0,
			});
		});
	});

	describe('when extending selectors', () => {
		const store = createStore('repo')({
			name: 'zustandX ',
			stars: 0,
		})
			.extendSelectors((set, get, api) => ({
				validName: () => get.name().trim(),
			}))
			.extendSelectors((set, get, api) => ({
				title: (prefix: string) =>
					`${prefix + get.validName()} with ${get.stars()} stars`,
			}));

		const altStore = createAltStore('repo')({
			name: 'zustandX ',
			stars: 0,
		})
			.withComputed((store) => ({
				getValidName: () => store.name.get().trim(),
			}))
			.withComputed((store) => ({
				getTitle: (prefix: string) =>
					`${prefix + store.getValidName()} with ${store.stars.get()} stars`,
			}));

		it('should be', () => {
			expect(store.get.title('Repository: ')).toBe(
				'Repository: zustandX with 0 stars'
			);

			expect(altStore.getValidName()).toBe('zustandX');
			expect(altStore.getTitle('Repository: ')).toBe(
				'Repository: zustandX with 0 stars'
			);
		});
	});

	describe('when set.state', () => {
		const store = createStore('repo')({
			name: 'zustandX',
			stars: 0,
		});

		const altStore = createAltStore('repo')({
			name: 'zustandX',
			stars: 0,
		});

		it('should be', () => {
			store.set.state((draft) => {
				draft.name = 'test';
				draft.stars = 1;
			});

			expect(store.get.state()).toEqual({
				name: 'test',
				stars: 1,
			});
		});
		it('ALT should be', () => {
			altStore.set((draft) => {
				draft.name = 'test';
				draft.stars = 1;
			});

			expect(altStore.get()).toEqual({
				name: 'test',
				stars: 1,
			});
		});

		describe('deletes a property', () => {
			it('should delete that property', () => {
				const repoStore = createStore('repo')<{
					name?: string;
					stars: number;
				}>({
					name: 'zustandX',
					stars: 0,
				});

				repoStore.set.state((draft) => {
					delete draft.name;
				});

				expect(repoStore.get.state()).toEqual({
					stars: 0,
				});

				const altRepoStore = createAltStore('repo')({
					name: 'zustandX' as string | undefined,
					stars: 0,
				});

				altRepoStore.set((draft) => {
					delete draft.name;
				});

				expect(altRepoStore.get()).toEqual({
					stars: 0,
				});
			});
		});
	});
});
