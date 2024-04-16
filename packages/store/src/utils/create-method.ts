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


export const storeMethodKeys = ['get', 'set', 'onChange', 'use', 'assign'] as const;
export type StoreMethodKey = typeof storeMethodKeys[number];

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
