import { isFunction } from '../src/utils/create-methods-proxy';
import { createRecursiveProxy } from '../src/utils/create-recursive-proxy';
import { describe, expect, expectTypeOf, test } from 'vitest';

describe('recursive proxy', () => {
	describe('basic checks', () => {
		const methods = createMethods<{
			user: {
				address: {
					get: () => string;
					set: (address: string) => void;
				};
			};
		}>();

		test('.get() correct value', async () => {
			const result = methods.user.address.get();

			expect(result).toStrictEqual({
				path: ['user', 'address'],
				method: 'get',
				args: [],
			});
		});

		test('.get() correct type', async () => {
			expectTypeOf(methods.user.address).toEqualTypeOf<{
				get: () => string;
				set: (address: string) => void;
			}>();
			const result = methods.user.address.get();

			expectTypeOf(result).toEqualTypeOf<string>();
		});

		test('.set() correct value', async () => {
			const result = methods.user.address.set('123 Main St');

			expect(result).toStrictEqual({
				path: ['user', 'address'],
				method: 'set',
				args: ['123 Main St'],
			});
		});

		test('.set() correct type', async () => {
			const result = methods.user.address.set('123 Main St');

			expectTypeOf(result).toEqualTypeOf<void>();
		});
	});
	describe('redefine checks', () => {
		const methods = createMethods<{
			user: {
				address: {
					get: () => string;
					set: (address: string) => void;
				};
			};
		}>();

		Object.assign(methods, {
			test: {
				get: () => 'test',
			},
		});

		test('.get() correct value', async () => {
			const result = methods.user.address.get();

			expect(result).toStrictEqual({
				path: ['user', 'address'],
				method: 'get',
				args: [],
			});
		});

		test('.get() correct type', async () => {
			expectTypeOf(methods.user.address).toEqualTypeOf<{
				get: () => string;
				set: (address: string) => void;
			}>();
			const result = methods.user.address.get();

			expectTypeOf(result).toEqualTypeOf<string>();
		});

		test('.set() correct value', async () => {
			const result = methods.user.address.set('123 Main St');

			expect(result).toStrictEqual({
				path: ['user', 'address'],
				method: 'set',
				args: ['123 Main St'],
			});
		});

		test('.set() correct type', async () => {
			const result = methods.user.address.set('123 Main St');

			expectTypeOf(result).toEqualTypeOf<void>();
		});

		// describe('assign new method and access it', () => {
		// 	const createMethods2 = <TStore extends object>() =>
		// 		createRecursiveProxy((opts) => {
		// 			const path = [...opts.path];
		// 			const method = path.pop()! as 'get' | 'set';
		// 			const args = opts.args;

		// 			if (method === 'get') {
		// 				return 'GET-RETURN';
		// 			}
		// 			if (method === 'set') {
		// 				return 'SET-RETURN';
		// 			}
		// 		}) as TStore;

		// 	test("can access 'test' method", async () => {
		// 		// @ts-expect-error
		// 		const result = methods2.test.get();

		// 		expect(result).toBe('test');
		// 	});
		// });
	});
});

export const createMethods = <TStore extends object>() =>
	createRecursiveProxy((opts) => {
		const path = [...opts.path];
		const method = path.pop()! as 'get' | 'set';
		const args = opts.args;

		return {
			path,
			method,
			args,
		};
	}) as TStore;
