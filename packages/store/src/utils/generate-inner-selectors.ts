import { isObject } from '../createStore';
import {
	EqualityChecker,
	GetRecord,
	ImmerStoreApi,
	State,
	UseImmerStore,
} from '../types';

export const generateInnerSelectors = <T extends State>(options: {
	useStore: UseImmerStore<T>;
	immerStore: ImmerStoreApi<T>;
	storeName: string;
	storeValues?: T;
	path?: string[];
}): DynamicStateMethods<T> => {
	const {
		useStore,
		immerStore,
		storeValues = immerStore.getState(),
		path = [],
		storeName,
	} = options;

	if (!isObject(storeValues)) {
		return {} as any;
	}

	return Object.fromEntries(
		Object.entries(storeValues).map(([key, value]) => {
			const currentPath = [...path, key]; // Append the current key to the path

			const methods = {
				get: () => getPathValue(immerStore.getState(), currentPath),
				set: (newValueOrFn: any) => {
					const isCallback = isFunction(newValueOrFn);
					const isValue = !isCallback;

					const prevValue = getPathValue(immerStore.getState(), currentPath);
					// if is value and the value is the same as the current value, return early
					if (isValue) {
						const noChange = prevValue === newValueOrFn;
						if (noChange) return;
					}

					const actionKey = key.replace(/^\S/, (s) => s.toUpperCase());
					return immerStore.setState((draft) => {
						if (isValue) {
							setPathValue(draft, currentPath, newValueOrFn);
						}

						if (isCallback) {
							setPathValue(draft, currentPath, newValueOrFn(prevValue));
						}
					}, `@@${storeName}/set${actionKey}`);
				},

				use: (equalityFn?: EqualityChecker<any>) => {
					return useStore((state) => {
						return getPathValue(state, currentPath);
					}, equalityFn);
				},
			};

			// Recursively handle nested objects
			const nestedSelectors = isObject(value)
				? generateInnerSelectors({
						useStore,
						immerStore,
						storeValues: value as T,
						path: currentPath, // Pass the updated path for nested selectors
						storeName,
					})
				: {};

			return [key, Object.assign(methods, nestedSelectors)];
		})
	) as unknown as DynamicStateMethods<T>;
};

export type DynamicStateMethods<TState> = {
	[TKey in keyof TState]: {
		get: () => TState[TKey];
		set: (
			newValueOrFn: TState[TKey] | ((prev: TState[TKey]) => TState[TKey])
		) => void;
		use: () => TState[TKey];
	};
};

function getPathValue<T>(state: T, path: string[]): any {
	return path.reduce((acc, key) => acc[key], state as any);
}

function setPathValue<T>(draft: T, path: string[], value: any): void {
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
