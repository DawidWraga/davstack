/* eslint-disable no-unused-vars */
import { useStoreWithEqualityFn } from 'zustand/traditional';
import {
	ImmerStoreApi,
	NestedStoreMethods,
	SetImmerState,
	State,
	UseImmerStore,
} from '../types';
import { EqualityChecker } from '../types';
import { isObject } from '../store';

export const createMethods = <T extends State>(options: {
	immerStore: ImmerStoreApi<T>;
	storeName: string;
	currentPath: string[];
	key: string;
	value: any;
}): NestedStoreMethods<T> => {
	const { immerStore, storeName, currentPath, key, value } = options;

	const isGlobal = currentPath.length === 0;

	const useStore = ((selector, equalityFn) =>
		useStoreWithEqualityFn(
			immerStore as any,
			selector as any,
			equalityFn as any
		)) as UseImmerStore<T>;

	const setState: SetImmerState<T> = (fnOrNewValue, actionName) => {
		immerStore.setState(fnOrNewValue, actionName || `@@${storeName}/setState`);
	};

	const set = (newValueOrFn: any) => {
		const isCallback = isFunction(newValueOrFn);
		const isValue = !isCallback;

		const prevValue = getPathValue(immerStore.getState(), currentPath);
		if (isValue && prevValue === newValueOrFn) {
			return;
		}

		const actionKey = key.replace(/^\S/, (s) => s.toUpperCase());

		return setState((draft) => {
			if (isGlobal && isValue) {
				draft = newValueOrFn;
				return draft;
			}

			if (isValue) {
				setPathValue(draft, currentPath, newValueOrFn);
			}

			if (isCallback) {
				if (isGlobal) {
					newValueOrFn(draft);
					return;
				}

				setPathValue(draft, currentPath, newValueOrFn(prevValue));
				return;
			}
		}, `@@${storeName}/set${actionKey}`);
	};

	const methods = {
		set,
		get: () => getPathValue(immerStore.getState(), currentPath),
		onChange: (listener: any) =>
			immerStore.subscribe(
				(state) => {
					return getPathValue(state, currentPath);
				},
				// @ts-expect-error
				(...args) => {
					// console.log('INSIDE SUBSCRIBE:', { args });
					return listener(...args);
				}
				// equality fn
			),
		use: (equalityFn?: EqualityChecker<any>) => {
			return useStore((state) => {
				return getPathValue(state, currentPath);
			}, equalityFn);
		},
		assign: (state: Partial<T>) => {
			if (!isObject(state)) {
				return set(state);
			}
			// @ts-expect-error
			return set((draft) => {
				return Object.assign(draft, state);
			});
		},
	};

	return methods as unknown as NestedStoreMethods<T>;
};

export const createNestedMethods = <T extends State>(options: {
	immerStore: ImmerStoreApi<T>;
	storeName: string;
	storeValues?: T;
	path?: string[];
}): NestedStoreMethods<T> => {
	const {
		immerStore,
		storeName,
		storeValues = immerStore.getState(),
		path = [],
	} = options;

	const isParent = path.length === 0;
	const valueIsObject = isObject(storeValues);
	const valueIsPrimitive = !valueIsObject;

	// STOP RECURSION AT 2 levels deep. This is temporary solution to avoid damaging performance with deeply nested objects. Long term solution is to implement proxies. I have tried for a long time and have to move on for now.
	if (path.length > 1) {
		return {} as NestedStoreMethods<T>;
	}

	// support parent primitive values
	if (valueIsPrimitive && isParent) {
		return createParentMethods();
	}

	// if not global primitive, then must be the deepest level, so stop recursive loop
	if (!isParent && valueIsPrimitive) {
		return {} as NestedStoreMethods<T>;
	}

	// if the value is an object AND it the selected path is the parent, then initiate the recursive loop to create child methods
	if (valueIsObject && isParent) {
		return Object.assign(createParentMethods(), createMethodsForAllChildren());
	}

	// if the value is an object and the selected path is not the root, then recursively create child methods for all children
	return createMethodsForAllChildren() as NestedStoreMethods<T>;

	function createParentMethods() {
		return createMethods({
			immerStore,
			storeName,
			currentPath: [],
			key: '',
			value: storeValues,
		});
	}

	function createMethodsForAllChildren() {
		return Object.fromEntries(
			Object.entries(storeValues as object).map(([key, value]) => {
				const currentPath = [...path, key];
				const currentMethods = createMethods({
					immerStore,
					storeName,
					currentPath,
					key,
					value,
				});

				const nestedMethods = createNestedMethods({
					immerStore,
					storeValues: value as T,
					path: currentPath,
					storeName,
				});

				return [key, Object.assign(currentMethods, nestedMethods)];
			})
		);
	}
};

// UTILS

/**
 * Get a value from a nested object using a path array
 */
function getPathValue<T>(state: T, path: string[]): any {
	return path.reduce((acc, key) => acc[key], state as any);
}

/**
 * Set a value in a nested object using a path array
 */
function setPathValue<T>(draft: T, path: string[], value: any): void {
	if (path.length === 0) {
		draft = value;
		return;
	}

	let current = draft;
	for (let i = 0; i < path.length - 1; i++) {
		const key = path[i];
		// @ts-expect-error
		if (current[key] === undefined) {
			// @ts-expect-error
			current[key] = {};
		}
		// @ts-expect-error
		current = current[key];
	}
	// @ts-expect-error
	current[path[path.length - 1]] = value;
}

export function isFunction<T extends Function = Function>(
	value: any
): value is T {
	return typeof value === 'function';
}

// OLD ATTMEPTS TO CREATE PROXY STORE METHODS

// // export const createProxyStoreMethods = <T extends State>(options: {
// // 	internalMethods?: InternalMethods<T>;
// // 	immerStore: ImmerStoreApi<T>;
// // 	storeName: string;
// // 	storeValues?: T;
// // 	path?: string[];
// // }): MainStoreMethods<T> => {
// // 	const {
// // 		immerStore,
// // 		storeName,
// // 		storeValues = immerStore.getState(),
// // 		internalMethods = createInternalMethods({
// // 			immerStore,
// // 			storeName,
// // 		}),
// // 		path = [],
// // 	} = options;

// // console.log('STARTING createProxyStoreMethods', {
// // 	storeValues,
// // 	path,
// // 	immerStore,
// // 	storeName,
// // 	internalMethods,
// // });

// //// @ts-expect-error
// // 	const createMethodsProxy = (target: any, currentPath: string[]) => {
// // 		console.log('INSIDE CREATE METHODS PROXY:', { target, currentPath });
// // 		return new Proxy(target, {
// // 			get(target, key) {
// // 				if (typeof key !== 'string') {
// // 					return target[key];
// // 				}

// // 				const nextPath = [...currentPath, key];

// // 				const value = getPathValue(storeValues as object, nextPath);

// // 				console.log('INSIDE PROXY:', {
// // 					target,
// // 					key,
// // 					value,
// // 					nextPath,
// // 				});

// // 				if (['get', 'set', 'use', 'assign'].includes(key)) {
// // 					const methods = createMethods({
// // 						internalMethods,
// // 						storeName,
// // 						currentPath: nextPath,
// // 						key,
// // 						value,
// // 					});

// // 					// @ts-expect-error
// // 					const final = methods[key];

// // 					console.log('GOTA METHOD: ', {
// // 						methods,
// // 						key,
// // 						value,
// // 						nextPath,
// // 						currentPath,
// // 						final,
// // 					});

// // 					return final;

// // 					// return methods[key]?.(value);
// // 				}

// // 				if (isObject(value)) {
// // 					const value = getPathValue(storeValues as object, nextPath);
// // 					return createMethodsProxy(value, nextPath);
// // 				}

// // 				return;
// // 			},
// // 		});
// // 	};

// // 	const rootMethods = createMethods({
// // 		internalMethods,
// // 		storeName,
// // 		currentPath: [],
// // 		key: '',
// // 		value: storeValues,
// // 	});

// // 	const nested = createMethodsProxy(storeValues, path);
// // 	// return nested;
// // 	return Object.assign(rootMethods, nested);
// // };

// // export const createProxyStoreMethods = <T extends State>(options: {
// // 	internalMethods?: InternalMethods<T>;
// // 	immerStore: ImmerStoreApi<T>;
// // 	storeName: string;
// // 	storeValues?: T;
// // 	path?: string[];
// // }): MainStoreMethods<T> => {
// // 	const {
// // 		immerStore,
// // 		storeName,
// // 		storeValues = immerStore.getState(),
// // 		internalMethods = createInternalMethods({
// // 			immerStore,
// // 			storeName,
// // 		}),
// // 		path = [],
// // 	} = options;

// // 	// @ts-expect-error
// // 	const createMethodsProxy = (target: any, path: string[]) => {
// // 		return new Proxy(target, {
// // 			get(target, key) {
// // 				if (typeof key !== 'string') {
// // 					return target[key];
// // 				}

// // 				const currentPath = [...path, key];
// // 				const value = getPathValue(storeValues as object, currentPath);

// // 				console.log('INSIDE PROXY:', {
// // 					target,
// // 					key,
// // 					value,
// // 					path,
// // 					currentPath,
// // 				});

// // 				if (isObject(value)) {
// // 					return createMethodsProxy({}, currentPath);
// // 				}

// // 				return createMethods({
// // 					// @ts-expect-error
// // 					internalMethods,
// // 					storeName,
// // 					path: currentPath,
// // 					key,
// // 					value,
// // 				});
// // 			},
// // 		});
// // 	};

// // 	const rootMethods = createMethods({
// // 		internalMethods,
// // 		storeName,
// // 		currentPath: [],
// // 		key: '',
// // 		value: storeValues,
// // 	});

// // 	return createMethodsProxy(storeValues, path);
// // };

// export const createProxyStoreMethods = <T extends State>(options: {
// 	internalMethods?: InternalMethods<T>;
// 	immerStore: ImmerStoreApi<T>;
// 	storeName: string;
// 	storeValues?: T;
// 	path?: string[];
// }): MainStoreMethods<T> => {
// 	const {
// 		immerStore,
// 		storeName,
// 		storeValues = immerStore.getState(),
// 		internalMethods = createInternalMethods({
// 			immerStore,
// 			storeName,
// 		}),
// 		path = [],
// 	} = options;

// 	// @ts-expect-error
// 	const createMethodsProxy = (path: string[]) => {

// 		const handler = {
// 			// @ts-expect-error
// 			get(_: any, key: string | symbol, receiver: any) {
// 				if (typeof key !== 'string') {
// 					return Reflect.get(_, key, receiver);
// 				}

// 				console.log('INSIDE PROXY GET:', { key, path, storeValues });

// 				// Handling for methods like get, set, use, assign
// 				if (key in rootMethods) {
// 					const method = (rootMethods as any)[key];
// 					return (...args: any) => method(...args, path);
// 				}

// 				// Default handling for nested objects or values
// 				const newPath = path.concat(key);
// 				const newValue = getPathValue(storeValues, newPath);

// 				console.log('INSIDE PROXY:', {
// 					path,
// 					newPath,
// 					newValue,
// 					key,
// 					storeValues,
// 					isObject: isObject(newValue),
// 				});

// 				// If the new value is an object, continue proxying. Otherwise, return the value directly.
// 				if (isObject(newValue)) {
// 					return createMethodsProxy(newPath);
// 				} else {
// 					// If accessing a primitive value or non-object, we might return a getter or similar mechanism
// 					// to access the value, depending on your store's requirements.
// 					return newValue;
// 				}
// 			},
// 		};

// 		return new Proxy({}, handler);
// 	};

// 	const rootMethods = createMethods({
// 		internalMethods,
// 		storeName,
// 		currentPath: [],
// 		key: '',
// 		value: storeValues,
// 	});

// 	return createMethodsProxy(path);

// 	// return Object.assign(rootMethods, createMethodsProxy(path));

// 	// return createMethodsProxy([]);
// };

// export const createProxyStoreMethods = <T extends State>(options: {
// 	internalMethods?: InternalMethods<T>;
// 	immerStore: ImmerStoreApi<T>;
// 	storeName: string;
// 	storeValues?: T;
// 	path?: string[];
// }): MainStoreMethods<T> => {
// 	const {
// 		immerStore,
// 		storeName,
// 		storeValues = immerStore.getState(),
// 		internalMethods = createInternalMethods({ immerStore, storeName }),
// 		path = [],
// 	} = options;

// 	// This proxy handler will intercept get operations on any nested path
// 	const proxyHandler: ProxyHandler<any> = {
// 		get(target: any, key: PropertyKey, receiver: any): any {
// 			// Convert key to string to handle cases where it might not be (e.g., Symbols)
// 			if (typeof key !== 'string') return Reflect.get(target, key, receiver);

// 			// Construct the new path for nested properties
// 			const newPath = path.concat(key);
// 			const newPathValue = getPathValue(storeValues, newPath);

// 			console.log('INSIDE PROXY:', {
// 				target,
// 				key,
// 				newPath,
// 				newPathValue,
// 				storeValues,
// 				path,
// 			});
// 			// If accessing a method directly on the store, return it
// 			if (
// 				path.length === 0 &&
// 				internalMethods[key as keyof InternalMethods<T>]
// 			) {
// 				return (...args: any[]) =>
// 					(internalMethods[key as keyof InternalMethods<T>] as any)(...args);
// 			}

// 			// Create methods for this path if it's not a nested object (end of recursion)
// 			if (!isObject(newPathValue)) {
// 				// @ts-expect-error
// 				return createMethods({
// 					internalMethods,
// 					storeName,
// 					currentPath: newPath,
// 					key,
// 					value: newPathValue,
// 				})[key];
// 			}

// 			// If the new path value is an object, return a new proxy for it (recursion)
// 			return new Proxy({}, createProxyHandler(newPath, newPathValue));
// 		},
// 	};

// 	// Creates a proxy handler for a given path and its value
// 	const createProxyHandler = (
// 		path: string[],
// 		value: any
// 	): ProxyHandler<any> => {
// 		return {
// 			...proxyHandler, // Spread the original handler to inherit its behavior
// 			get(target: any, key: PropertyKey, receiver: any): any {
// 				// Override or extend behavior here if needed for nested paths

// 				console.log('INSIDE PROXY HANDLER:', {
// 					target,
// 					key,
// 					path,
// 					value,
// 				});

// 				// @ts-expect-error
// 				return proxyHandler.get(target, key, receiver);
// 			},
// 		};
// 	};

// 	// Start with a proxy at the root of the store
// 	return new Proxy({}, createProxyHandler(path, storeValues));
// };
