/* eslint-disable no-unused-vars */

import { EffectBuilder, State, StoreApi, StoreDef } from './types';
import { StoreOptions } from './types/CreateStoreOptions';

import {
	ComputedBuilder,
	ComputedProps,
	createComputedMethods,
} from './utils/create-computed-methods';
import { createStore } from './utils/create-inner-store';
import { createStoreApiProxy } from './utils/create-store-proxy';
import { createSplitProps } from './utils/split-props';

export function getDefaultStoreDef<TState extends State>(
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

			const defaultName = `(davstack/store)initialValue=${
				_def.initialState ? JSON.stringify(_def.initialState) : 'no-state'
			}`;
			Object.assign(_def.options, { name: defaultName });
			return defaultName as string;
		},
	};

	return _def satisfies StoreDef<TState>;
}

export const store = <TState extends State>(
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
		state: (initialValue: TState) => {
			Object.assign(_def, { initialState: initialValue });
			return storeApi;
		},

		identify: (newName: string) => {
			Object.assign(_def.options, { name: newName });
			return storeApi;
		},

		devtools: (enabled = true) => {
			Object.assign(_def.options, { devtools: { enabled } });
			return storeApi;
		},

		/**
		 * extend based methods:
		 */
		extend,
		actions: extend,
		input: (initialInput: Record<string, any>) => {
			return extend((store) => initialInput);
		},
		effects: <TBuilder extends EffectBuilder<StoreApi<TState, {}>>>(
			builder: TBuilder
		): StoreApi<TState, {}> => {
			return extend((store) => {
				const effectNameToFn = builder(store);
				const unsubMethods: Record<string, () => void> = {};

				const subscribeToEffects = () => {
					Object.entries(effectNameToFn).forEach(([key, fn]) => {
						// @ts-expect-error
						unsubMethods[key] = fn();
					});
				};

				const unsubscribeFromEffects = () => {
					Object.values(unsubMethods).forEach((fn) => fn());
				};

				const extraProps = {
					_effects: effectNameToFn,
					subscribeToEffects,
					unsubscribeFromEffects,
				};

				return extraProps;
			});
		},
		computed: <TComputedProps extends ComputedProps>(
			computedCallback: ComputedBuilder<TState, TComputedProps>
		) => {
			return extend((store) =>
				// @ts-expect-error
				createComputedMethods(store, computedCallback)
			);
		},
		create: (initialValue: Partial<TState> & Record<string, any>) => {
			if (!initialValue) {
				const instance = createStore(_def);

				Object.assign(instance, storeApi);
				return instance;
			}

			if (!isObject(_def.initialState)) {
				console.warn(
					'WARNING: passing if your initial state is not an object then input props passed to the create funciton will be ignored. To use input props you must pass an object as the initial state.'
				);
				return createStore(_def, initialValue);
			}

			const splitInputFromState = createSplitProps(
				Object.keys(_def.initialState as object)
			);

			const [stateInitialValue, inputInitialValue] =
				splitInputFromState(initialValue);

			// @ts-expect-error
			return createStore(_def, stateInitialValue, inputInitialValue);
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

export function isObject(value: any): value is Record<string, any> {
	return value instanceof Object && !(value instanceof Array);
}
