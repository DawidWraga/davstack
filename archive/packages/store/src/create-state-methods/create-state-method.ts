/* eslint-disable no-unused-vars */
import { shallow } from 'zustand/shallow';
import {
	UseBoundStoreWithEqualityFn,
	useStoreWithEqualityFn,
} from 'zustand/traditional';

import { isDraftable, produce } from 'immer';
import { EqualityChecker, StateValue, ZustandStoreApi } from '../types';
import { isFunction, isObject } from '../utils/assertions';
import { OnChangeOptions } from './state.types';

export const stateMethodKeys = [
	'get',
	'set',
	'onChange',
	'use',
	'assign',
] as const;
export type StateMethodKey = (typeof stateMethodKeys)[number];

export const createStateMethod = <TStateValue extends StateValue>(options: {
	zustandStore: ZustandStoreApi<TStateValue>;
	storeName: string;
	path: string[];
	method: StateMethodKey;
}) => {
	const { zustandStore, storeName, path, method } = options;

	const isRootPath = path.length === 0;

	const get = (selector?: (state: TStateValue) => unknown | undefined) => {
		const pathValue = getPathValue(zustandStore.getState(), path);
		return selector ? selector(pathValue) : pathValue;
	};

	if (method === 'get') return get;

	if (method === 'use') {
		const useStore = ((selector, equalityFn) =>
			useStoreWithEqualityFn(
				zustandStore as any,
				selector as any,
				equalityFn as any
			)) as UseBoundStoreWithEqualityFn<ZustandStoreApi<TStateValue>>;

		return (selector: any, equalityFn?: EqualityChecker<any>) => {
			return useStore((state) => {
				const pathValue = getPathValue(state, path);
				return selector ? selector(pathValue) : pathValue;
			}, equalityFn);
		};
	}

	if (method === 'onChange') {
		return (listener: any, options: OnChangeOptions<TStateValue> = {}) => {
			return zustandStore.subscribe(
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

	const set = (newValueOrFn: any) => {
		const isCallback = isFunction(newValueOrFn);
		const isValue = !isCallback;

		const prevValue = get();
		if (isValue && prevValue === newValueOrFn) {
			return;
		}
		const isNestedPath = !isRootPath;

		zustandStore.setState((state) => {
			if (isRootPath && isValue) {
				return newValueOrFn;
			}

			if (isRootPath && isCallback) {
				if (isDraftable(state)) {
					return produce(state, newValueOrFn);
				} else {
					return newValueOrFn(state);
				}
			}

			if (isNestedPath && isValue) {
				return produce(state, (draft) => {
					setPathValue(draft, path, newValueOrFn);
				});
			}

			if (isNestedPath && isCallback) {
				return produce(state, (draft) => {
					const draftValue = getPathValue(draft, path);

					const isDraftableValue = isDraftable(draftValue);
					const callbackReturnValue = newValueOrFn(draftValue);

					// must check whether the NESTED PATH VALUE is draftable, not the state itself
					// eg  store({ count: number }) ; store.count.set will actually try to turn the count NUMBER into a draftable object, not the entire store. This is why we need to check the pathValue

					if (!isDraftableValue) {
						setPathValue(draft, path, callbackReturnValue);
					}
				});
			}

			return state;
		}, true);
	};
	if (method === 'set') return set;

	if (method === 'assign')
		return (state: Partial<TStateValue>) => {
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
 *
 * @example
 * ```ts
 * const pathValue = getPathValue({a:{b:{c:1}}}, ['a', 'b', 'c']);
 * console.log(pathValue); // 1
 * ```
 */
function getPathValue<T>(state: T, path: string[]): any {
	return path.reduce((acc, key) => acc[key], state as any);
}

/**
 * Set a value in a nested object using a path array
 *
 * @example
 * ```ts
 * const state = {a:{b:{c:1}}};
 * const value1 = getPathValue(state, ['a', 'b', 'c']);
 * console.log(value1); // 1
 * setPathValue(state, ['a', 'b', 'c'], 2);
 * const value2 = getPathValue(state, ['a', 'b', 'c']);
 * console.log(value2); // 2
 *
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
