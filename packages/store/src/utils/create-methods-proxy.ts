/* eslint-disable no-unused-vars */
import { useStoreWithEqualityFn } from 'zustand/traditional';
import {
	ImmerStoreApi,
	NestedStoreMethods,
	OnChangeOptions,
	SetImmerState,
	State,
	StoreMethods,
	UseImmerStore,
} from '../types';
import { EqualityChecker } from '../types';
import { isObject } from '../store';
import { createRecursiveProxy } from './create-recursive-proxy';
//import { createRecursiveProxy, ProxyCallback } from './create-recursive-proxy';

// export type StoreMethodKeys<T> = keyof NestedStoreMethods<T>;
export type StoreMethodKey = 'get' | 'set' | 'onChange' | 'use' | 'assign';

export const createMethod = <T extends State>(options: {
	immerStore: ImmerStoreApi<T>;
	storeName: string;
	path: string[];
	method: StoreMethodKey;
}) => {
	const { immerStore, storeName, path, method } = options;

	const isRootPath = path.length === 0;

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

	const methods = {
		set,
		get: () => getPathValue(immerStore.getState(), path),
		onChange: (listener: any, options: OnChangeOptions<T> = {}) => {
			return immerStore.subscribe(
				(state) => {
					if (options?.customSelector) {
						return options?.customSelector(state);
					}

					const baseDependency = getPathValue(state, path);
					// return baseDependency;

					if (!options?.additionalDeps || !options.additionalDeps.length)
						return baseDependency;

					const deps = [baseDependency];

					options.additionalDeps.forEach((dep) => {
						const value = getPathValue(state, [dep as string]);
						deps.push(value);
					});
					return deps;
				},
				// @ts-expect-error
				(...args) => {
					// console.log('INSIDE SUBSCRIBE:', { args });
					return listener(...args);
				},
				{
					fireImmediately: options?.fireImmediately,
					equalityFn: options?.equalityFn,
				}
				// equality fn
			);
		},
		use: (equalityFn?: EqualityChecker<any>) => {
			return useStore((state) => {
				return getPathValue(state, path);
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
	} as StoreMethods<T, T>;

	return methods[method];
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
}) =>
	createRecursiveProxy((opts) => {
		const path = [...opts.path];
		const method = path.pop()! as StoreMethodKey;
		const args = opts.args;

		if (!['get', 'set', 'onChange', 'use', 'assign'].includes(method)) {
			// @ts-expect-error
			return opts.target[method](...args);
		}

		const methodFn = createMethod({
			immerStore,
			storeName,
			path,
			method,
		});

		// @ts-expect-error
		return methodFn(...args);
	}, {}) as TStore;
