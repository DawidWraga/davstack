import { describe, expect, test } from 'vitest';
import { store } from '../../src';

describe('computed with selector', () => {
	type User = {
		id: string;
		firstName: string;
		lastName: string;
	};

	const usersStore = store({
		users: [] as User[],
	})
		.computed((store) => ({
			userById: (id: string) => {
				return store.users.use((users) => users.find((user) => user.id === id));
			},
		}))
		.computed((store) => ({
			fullNameById: (id: string) => {
				const user = store.userById.use(id);
				if (!user) return undefined;
				return `${user.firstName} ${user.lastName}`;
			},
		}));

	test('initial computed property value', () => {
		const storeInstance = usersStore.create({
			users: [
				{ id: '1', firstName: 'John', lastName: 'Doe' },
				{ id: '2', firstName: 'Jane', lastName: 'Doe' },
			],
		});

		expect(storeInstance.userById.get('1')).toEqual({
			id: '1',
			firstName: 'John',
			lastName: 'Doe',
		});

		expect(storeInstance.fullNameById.get('1')).toBe('John Doe');
	});
});
describe('computed with selector v2', () => {
	type User = {
		id: string;
		firstName: string;
		lastName: string;
	};

	const usersStore = store({
		users: [] as User[],
	}).extend(($) => ({
		userById: (id: string) =>
			store(
        // the get here is not dynamic, so you have to choose get/use
				$.users.get((users) => users.find((user) => user.id === id))
			).computed((store) => ({
				fullName: () => {
					const user = store.get();
					if (!user) return undefined;
					return `${user.firstName} ${user.lastName}`;
				},
			})),
	}));

	test('initial computed property value', () => {
		const storeInstance = usersStore.create({
			users: [
				{ id: '1', firstName: 'John', lastName: 'Doe' },
				{ id: '2', firstName: 'Jane', lastName: 'Doe' },
			],
		});

		expect(storeInstance.userById('1').get()).toEqual({
			id: '1',
			firstName: 'John',
			lastName: 'Doe',
		});

		expect(storeInstance.userById('1').fullName.get()).toBe('John Doe');
	});
});
