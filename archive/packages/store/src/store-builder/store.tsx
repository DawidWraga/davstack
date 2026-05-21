/* eslint-disable no-unused-vars */

import { StoreOptions } from '../create-store/create-store-options';
import { EffectBuilder, StateValue, StoreApi, StoreDef } from '../types';

import {
	ComputedBuilder,
	ComputedProps,
	createComputedMethods,
} from '../create-computed/create-computed-methods';
import { createEffectMethods } from '../create-effects';
import { createStoreApiProxy } from '../create-store/create-store-proxy';
import { createStore } from '../create-store/create-zustand-store';

export const store = <TState extends StateValue>(
	initialState?: TState,
	options?: StoreOptions<TState>
): StoreApi<TState> => {
	const _def = getDefaultStoreDef(initialState) as StoreDef<TState>;

	function extend<TNewExtendedProps extends Record<string, any>>(
		builder: (store: StoreApi<TState, {}>) => TNewExtendedProps
	) {
		_def.extensions.push(builder);
		return storeApi;
	}

	const storeApi = createStoreApiProxy({
		_def,
		options: (newOpts: any) => {
			Object.assign(_def.options, newOpts);
			return storeApi;
		},
		state: (initialState: TState) => {
			Object.assign(_def, { initialState: initialState });
			return storeApi;
		},
		/**
		 * extend based methods:
		 */
		extend,
		actions: extend,
		effects: <TBuilder extends EffectBuilder<StoreApi<TState, {}>>>(
			builder: TBuilder
		): StoreApi<TState, {}> => {
			return extend((store) => {
				const effectDefs = builder(store);
				return { _effects: effectDefs };
			});
		},
		computed: <TComputedProps extends ComputedProps>(
			builder: ComputedBuilder<TState, TComputedProps>
		) => {
			return extend((store) =>
				// @ts-expect-error
				createComputedMethods(store, builder)
			);
		},
		create: (initialState: Partial<TState>) => {
			if (!initialState) {
				const instance = createStore(_def);

				Object.assign(instance, storeApi);
				return instance;
			}

			return createStore(_def, initialState);
		},
	});

	// must check for undefined to allow for 0 as a valid initial state
	if (initialState !== undefined) {
		Object.assign(_def, { initialState });
	}

	if (options) {
		Object.assign(_def, { options });
	}

	return storeApi as unknown as StoreApi<TState>;
};

export function getDefaultStoreDef<TState extends StateValue>(
	initialState?: TState
) {
	const _def = {
		initialState,
		extensions: [],
		options: {},
		get name() {
			const options = _def.options as StoreOptions<TState>;
			const name = options.name as string;
			if (name) return name;

			const stateString = _def.initialState
				? JSON.stringify(_def.initialState)
				: 'no-state';
			const defaultName = `(davstack/store)initialState=${stateString}`;
			Object.assign(_def.options, { name: defaultName });
			return defaultName as string;
		},
	};

	return _def satisfies StoreDef<TState>;
}
