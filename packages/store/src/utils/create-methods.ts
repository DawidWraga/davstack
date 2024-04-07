/* eslint-disable no-unused-vars */
import { useStoreWithEqualityFn } from 'zustand/traditional';

import {
	ImmerStoreApi,
	MergeState,
	SetImmerState,
	State,
	UseImmerStore,
} from '../types';

import { isObject } from '../store';
import { EqualityChecker } from '../types';
export const createGlobalMethods = <TState extends State>(options: {
	immerStore: ImmerStoreApi<TState>;
	storeValues?: TState;
	storeName: string;
}): GlobalMethods<TState> => {
	const { immerStore, storeValues, storeName } = options;

	const useStore = ((selector, equalityFn) =>
		useStoreWithEqualityFn(
			immerStore as any,
			selector as any,
			equalityFn as any
		)) as UseImmerStore<TState>;

	const setState: SetImmerState<TState> = (fnOrNewValue, actionName) => {
		immerStore.setState(fnOrNewValue, actionName || `@@${storeName}/setState`);
	};

	const assign: MergeState<TState> = (state, actionName) => {
		immerStore.setState(
			// @ts-expect-error
			isObject(storeValues)
				? (draft) => {
						Object.assign(draft as any, state);
					}
				: state,
			actionName || `@@${storeName}/assign`
		);
	};

	const globalMethods: GlobalMethods<TState> = {
		set: setState,
		get: immerStore.getState,
		use: useStore,
		assign: assign,
	};

	return globalMethods;
};

export type GlobalMethods<TState> = {
	set: SetImmerState<TState>;
	get: () => TState;
	use: UseImmerStore<TState>;
	assign: MergeState<TState>;
};

const createInnerMethods = <T extends State>(options: {
	globalMethods: GlobalMethods<T>;
	storeName: string;
	currentPath: string[];
	key: string;
	value: any;
}): InnerStateMethods<T> => {
	const { globalMethods, storeName, currentPath, key, value } = options;

	const methods = {
		get: () => getPathValue(globalMethods.get(), currentPath),
		set: (newValueOrFn: any) => {
			const isCallback = isFunction(newValueOrFn);
			const isValue = !isCallback;

			const prevValue = getPathValue(globalMethods.get(), currentPath);
			if (isValue && prevValue === newValueOrFn) {
				return;
			}

			const actionKey = key.replace(/^\S/, (s) => s.toUpperCase());

			return globalMethods.set((draft) => {
				if (isValue) {
					setPathValue(draft, currentPath, newValueOrFn);
				}

				if (isCallback) {
					setPathValue(draft, currentPath, newValueOrFn(prevValue));
				}
			}, `@@${storeName}/set${actionKey}`);
		},

		use: (equalityFn?: EqualityChecker<any>) => {
			return globalMethods.use((state) => {
				return getPathValue(state, currentPath);
			}, equalityFn);
		},
	};

	return methods as unknown as InnerStateMethods<T>;
};

export const createMethods = <T extends State>(options: {
	globalMethods?: GlobalMethods<T>;
	immerStore: ImmerStoreApi<T>;
	storeName: string;
	storeValues?: T;
	path?: string[];
}): GlobalMethods<T> | InnerStateMethods<T> => {
	const {
		immerStore,
		storeName,
		storeValues = immerStore.getState(),
		globalMethods = createGlobalMethods({
			immerStore,
			storeValues,
			storeName,
		}),
		path = [],
	} = options;

	const isGlobal = path.length === 0;

	if (!isObject(storeValues)) {
		// handle primitive values here
		if (isGlobal) {
			return globalMethods;
		}
		return {} as InnerStateMethods<T>;
	}

	const innerMethods = Object.fromEntries(
		Object.entries(storeValues).map(([key, value]) => {
			const currentPath = [...path, key];
			const currentMethods = createInnerMethods({
				globalMethods,
				storeName,
				currentPath,
				key,
				value,
			});

			const nestedMethods = createMethods({
				globalMethods,
				immerStore,

				storeValues: value as T,
				path: currentPath,
				storeName,
			});

			return [key, Object.assign(currentMethods, nestedMethods)];
		})
	);

	if (isGlobal) {
		return Object.assign(globalMethods, innerMethods);
	}

	return innerMethods as InnerStateMethods<T>;

	// return Object.assign(globalMethods, innerMethods);
};
export type InnerStateMethods<TState> = {
	[TKey in keyof TState]: {
		get: () => TState[TKey];
		set: (
			newValueOrFn: TState[TKey] | ((prev: TState[TKey]) => TState[TKey])
		) => void;
		use: () => TState[TKey];
	};
};

function getPathValue<T>(state: T, path: string[]): any {
	// console.log('GETTING PATH VALUE: ', {
	// 	state,
	// 	path,
	// });
	return path.reduce((acc, key) => acc[key], state as any);
}

function setPathValue<T>(draft: T, path: string[], value: any): void {
	// console.log('INSIDE SET PATH VALUE', {
	// 	draft,
	// 	path,
	// 	value,
	// });
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
