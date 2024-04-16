/* eslint-disable no-unused-vars */
import { shallow } from 'zustand/shallow';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { isObject } from '../store';
import {
	EqualityChecker,
	ImmerStoreApi,
	SetImmerState,
	State,
	UseImmerStore,
} from '../types';
import { OnChangeOptions, StoreMethods } from '../types/store-methods';
// import { createRecursiveProxy } from './create-recursive-proxy';

export type StoreMethodKey = 'get' | 'set' | 'onChange' | 'use' | 'assign';

export const createMethod = <T extends State>(options: {
	immerStore: ImmerStoreApi<T>;
	storeName: string;
	path: string[];
	method: StoreMethodKey;
}) => {
	const { immerStore, storeName, path, method } = options;

	const isRootPath = path.length === 0;

	if (method === 'get') {
		return () => getPathValue(immerStore.getState(), path);
	}

	if (method === 'use') {
		const useStore = ((selector, equalityFn) =>
			useStoreWithEqualityFn(
				immerStore as any,
				selector as any,
				equalityFn as any
			)) as UseImmerStore<T>;

		return (equalityFn?: EqualityChecker<any>) => {
			return useStore((state) => {
				return getPathValue(state, path);
			}, equalityFn);
		};
	}

	if (method === 'onChange') {
		return (listener: any, options: OnChangeOptions<T> = {}) => {
			return immerStore.subscribe(
				(state) => {
					if (!options.deps) {
						// default to subscribing to the part of the store which is being dot-notated
						// if store().onChange subscribes to the top level store, it will always fire
						// but store({parent:{child:1}}).parent.onChange will only fire when parent changes

						return getPathValue(state, path);
					}

					if (isFunction(options.deps)) {
						// if deps is a callback then allow for fully custom dependencies
						return options.deps(state as object);
					}

					// if deps is an array then subscribe to those dependencies

					return options.deps.map((dep) => {
						const value = state[dep];
						return value;
					});
				},
				// @ts-expect-error
				(...args) => {
					return listener(...args);
				},
				{
					fireImmediately: options?.fireImmediately,

					/**
					 * defaults to using zustand shallow equality checker
					 *
					 * This is NEEDED for deps to work as expected, otherwise will always fire
					 *
					 * however, if you want to use a custom equality checker, you can pass it in
					 */
					equalityFn: options?.equalityChecker ?? shallow,
				}
				// equality fn
			);
		};
	}

	const setState: SetImmerState<T> = (fnOrNewValue, actionName) => {
		immerStore.setState(fnOrNewValue, actionName || `@@${storeName}/setState`);
	};

	const set = (newValueOrFn: any) => {
		const isCallback = isFunction(newValueOrFn);
		const isValue = !isCallback;

		const prevValue = getPathValue(immerStore.getState(), path);
		if (isValue && prevValue === newValueOrFn) {
			return;
		}

		const actionKey = method.replace(/^\S/, (s) => s.toUpperCase());

		return setState((draft) => {
			if (isRootPath && isValue) {
				draft = newValueOrFn;
				return draft;
			}

			if (isValue) {
				setPathValue(draft, path, newValueOrFn);
			}

			if (isCallback) {
				if (isRootPath) {
					newValueOrFn(draft);
					return;
				}

				setPathValue(draft, path, newValueOrFn(prevValue));
				return;
			}
		}, `@@${storeName}/set${actionKey}`);
	};

	if (method === 'set') return set;

	if (method === 'assign')
		return (state: Partial<T>) => {
			if (!isObject(state)) {
				return set(state);
			}
			// @ts-expect-error
			return set((draft) => {
				return Object.assign(draft, state);
			});
		};

	console.error(`Method ${method} not found`);
	return undefined;
};

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

export const createMethodsProxy = <TStore extends ImmerStoreApi<any>>({
	immerStore,
	storeName,
}: {
	immerStore: TStore;
	storeName: string;
}) => {
	interface ProxyCallbackOptions {
		target?: unknown;
		path: string[];
		args: unknown[];
	}
	type ProxyCallback = (opts: ProxyCallbackOptions) => unknown;

	const noop = () => {
		// noop
		// dummy no-op function since we don't have any
		// client-side target we want to remap to
	};

	function createInnerProxy(
		callback: ProxyCallback,
		path: string[],
		// py passing the innerObj, we allow for the proxy to be used as a normal object
		// this is useful for accessing the target methods of store directly eg store.extend()
		innerObj: any = noop
	) {
		const proxy: unknown = new Proxy(innerObj, {
			get(target, key, receiver) {
				if (typeof key !== 'string' || key === 'then') {
					// special case for if the proxy is accidentally treated
					// like a PromiseLike (like in `Promise.resolve(proxy)`)
					return undefined;
				}

				const isActualKeyOfTarget =
					key in target && !excludedKeys.includes(key);
				if (isActualKeyOfTarget) {
					// pass through to the target object
					return Reflect.get(target, key, receiver);
				}

				const isStoreMethod = [
					'get',
					'set',
					'onChange',
					'use',
					'assign',
				].includes(key);

				if (isStoreMethod) {
					const isUse = key === 'use';

					const shouldReplaceUseWithGet = isUse && innerObj._replaceUseWithGet;

					const actualkey = shouldReplaceUseWithGet ? 'get' : key;

					// if we pass the innerObj it will throw error that the store method is not defined, since it doesn't actually exist. By passing the noop, we are able to complete composing the path and call the callback function inside apply.

					return createInnerProxy(callback, [...path, actualkey], noop);
				}

				// Recursively compose the full path until a function is invoked
				return createInnerProxy(callback, [...path, key], innerObj);
			},
			set(target, key, value) {
				if (typeof key === 'string') {
					target[key] = value;
					return true;
				}
				return false;
			},
			apply(target, _thisArg, args) {
				// Call the callback function with the entire path we
				// recursively created and forward the arguments
				const isApply = path[path.length - 1] === 'apply';

				if (isApply) {
					return callback({
						args: args.length >= 2 ? args[1] : [],
						path: path.slice(0, -1),
						target,
					});
				}

				return callback({ path, args, target });
			},
		});

		return proxy;
	}

	const final = createInnerProxy(
		(opts) => {
			const path = [...opts.path];
			const method = path.pop()! as StoreMethodKey;
			const args = opts.args;

			// really this should never trigger, it's just a safety net
			// all non-store methods should be passed through to the target inside the createRecursiveProxy
			if (!['get', 'set', 'onChange', 'use', 'assign'].includes(method)) {
				// @ts-expect-error
				return opts.target[method](...args);
			}

			// const isUse = method === 'use';
			// const actualMethod = isUse && final._replaceUseWithGet ? 'get' : method;

			const methodFn = createMethod({
				immerStore,
				storeName,
				path,
				method,
			});

			// @ts-expect-error
			return methodFn(...args);
		},
		[],
		{}
	) as TStore;

	return final;
};

// this means that you cannot acess the following properties on the proxy object
// this is to avoid name conflicts with the nested proxy properties
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
