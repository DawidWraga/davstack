/* eslint-disable no-unused-vars */

import { ZustandStoreApi } from '../types';
import {
	createStateMethod,
	StateMethodKey,
	stateMethodKeys,
} from './create-state-method';

export const createMethodsProxy = <TStore extends ZustandStoreApi<any>>({
	zustandStore,
	storeName,
}: {
	zustandStore: TStore;
	storeName: string;
}) => {
	function createInnerProxy(
		path: string[] = [],
		// py passing the innerObj, we allow for the proxy to be used as a normal object
		// this is useful for accessing the target methods of store directly eg store.extend()
		innerObj: any = {
			// __STORE_META__: {
			// 	isDavstackStore: true,
			// },
		}
	) {
		const proxy: unknown = new Proxy(innerObj, {
			get(target, key, receiver) {
				// If the accessed key is not a string or is 'then', return undefined to avoid promise-like behavior
				if (typeof key !== 'string' || key === 'then') {
					return undefined;
				}

				// if they key actually exists on the target eg `.extend` then we should allow the access to the target object by using Reflect.get to pass through
				const isActualKeyOfTarget =
					key in target && !excludedKeys.includes(key);
				if (isActualKeyOfTarget) {
					return Reflect.get(target, key, receiver);
				}

				// @ts-expect-error
				const isStoreMethodKey = stateMethodKeys.includes(key);

				if (isStoreMethodKey) {
					const shouldReplaceUseWithGet =
						key === 'use' && innerObj._replaceUseWithGet;

					const actualkey = shouldReplaceUseWithGet ? 'get' : key;

					// if we pass the innerObj it will throw error that the store method is not defined, since it doesn't actually exist. By passing the noop, we are able to complete composing the path and call the callback function inside apply.

					return createInnerProxy([...path, actualkey], noop);
				}

				// Recursively compose the full path until a function is invoked
				// this is necesssary are proxies will otherwise not give you the FULL path, only the last key. So we need to build up the path as we go along until we reach a store method.
				return createInnerProxy([...path, key], innerObj);
			},

			apply(target, _thisArg, args) {
				const method = path.pop()! as StateMethodKey;

				// now the path is fully formed eg ["user","address","get"], we can pass it to the createMethod function

				// Create the store method function using the createMethod utility
				const methodFn = createStateMethod({
					zustandStore,
					storeName,
					path,
					method,
				});

				// @ts-expect-error
				return methodFn(...args);
			},
		});

		return proxy as object;
	}

	return createInnerProxy();
};

/**
 * We check if key in target to allow for fluent API whene building the store
 * eg store().extend().extend()
 *
 * By checking if the key is in the target, we can allow for the fluent API to work as expected
 *
 * However, this means means that hidden keys such as .length, .name, .toString, etc. could conflict with the stores nested properties eg store({user:{ name: "" }, book: { length: 5 }}) would not work as expected
 *
 * To avoid this, we exclude the following keys from the proxy object
 *
 * However because we check if method !== get/set/assign/onChange/use , we can still access these properties eg store({books: [1,2,3	]}); store.books.get().length would work as expected
 */
const excludedKeys = [
	'constructor',
	'prototype',
	'__proto__',
	'toString',
	'valueOf',
	'toLocaleString',
	'hasOwnProperty',
	'isPrototypeOf',
	'propertyIsEnumerable',
	'length',
	'caller',
	'callee',
	'arguments',
	'name',
	Symbol.toPrimitive,
	Symbol.toStringTag,
	Symbol.iterator,
];

/**
 * When we pass a noop to the proxy then it stops trying to access the target object and instead just returns the value of the path, allowing us to compose the path and call the callback function inside apply.
 */
const noop = () => {};
