/* eslint-disable no-unused-vars */

import {
	EffectBuilder,
	State,
	StoreApi,
	StoreBuilderApi,
	StoreDef,
} from './types';
import { StoreOptions } from './types/CreateStoreOptions';

import React from 'react';
import {
	createComputedMethods,
	ComputedBuilder,
	ComputedProps,
} from './utils/create-computed-methods';
import { createStore } from './utils/create-inner-store';
import { createSplitProps } from './utils/split-props';

export const storeBuilder = <TState extends State>() => {
	const _def = {
		initialState: undefined,
		input: {},
		extensions: [],
		options: {},
		get name() {
			if (_def.options.name) return _def.options.name;
			const defaultName = `(davstack/store)initialValue=${
				_def.initialState ? JSON.stringify(_def.initialState) : 'no-state'
			}`;
			Object.assign(_def.options, { name: defaultName });
			return defaultName;
		},
	} as StoreDef<TState>;

	function extend<TNewExtendedProps extends Record<string, any>>(
		builder: (store: StoreApi<TState, {}>) => TNewExtendedProps
	) {
		_def.extensions.push(builder);

		if (_def.options.onExtend) {
			return _def.options.onExtend(builder);
		}
		return builderMethods;
	}

	const builderMethods = {
		options: (newOpts: any) => {
			Object.assign(_def.options, newOpts);
			return builderMethods;
		},
		state: (initialValue: TState) => {
			Object.assign(_def, { initialState: initialValue });
			return builderMethods;
		},

		name: (newName: string) => {
			Object.assign(_def.options, { name: newName });
			return builderMethods;
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
			// @ts-expect-error
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

				// subscribe to the effects when the store is created
				subscribeToEffects();

				return extraProps;
			});
		},
		computed: <TComputedProps extends ComputedProps>(
			computedCallback: ComputedBuilder<TState, TComputedProps>
			// ): StoreApi<TState, TComputedProps> => {
		) => {
			return extend((store) =>
				// @ts-expect-error
				createComputedMethods(store, computedCallback)
			);
		},
		create: (initialValue: Partial<TState> & Record<string, any>) => {
			if (!initialValue) {
				return createStore(_def);
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
	};

	return Object.assign(builderMethods, {
		_def,
	}) as unknown as StoreBuilderApi<TState>;
};

export const store = <TState extends State>(
	initialState?: TState,
	options?: StoreOptions<TState>
): StoreBuilderApi<TState> => {
	let globalStore = {} as unknown as StoreBuilderApi<TState>;

	const _options = {
		...options,
		onExtend: (builder: any) => {
			if (options?.onExtend) {
				options.onExtend(store);
			}

			Object.assign(globalStore, builder(globalStore));
			return globalStore as unknown as StoreApi<TState, {}>;
		},
	};

	if (initialState !== undefined) {
		const builder = storeBuilder()
			.options(_options as any)
			.state(initialState);

		const instance = builder.create() as StoreApi<TState>;

		Object.assign(instance, builder);

		// @ts-expect-error
		globalStore = instance;
	} else {
		const stateFn = (_initialState: any) => {
			const builder = storeBuilder()
				.options(_options as any)
				.state(_initialState);

			const instance = builder.create() as StoreApi<TState>;

			Object.assign(instance, builder);

			// @ts-expect-error
			globalStore = instance;
			return globalStore as StoreBuilderApi<TState>;
		};

		// @ts-expect-error
		globalStore = {
			state: stateFn,
		};
	}

	return globalStore as unknown as StoreBuilderApi<TState>;

	// return storeBuilder()
	// 	.state(initialState)
	// 	.options(options ?? {})
	// 	.create() as StoreApi<TState>;

	// if (initialState !== undefined && options !== undefined)
	// 	return storeBuilder()
	// 		.options(options as any)
	// 		.state(initialState) as StoreApi<TState>;

	// if (initialState !== undefined) {
	// 	return storeBuilder().state(initialState).create() as StoreApi<TState>;
	// }

	// if (options !== undefined) {
	// 	return storeBuilder().options(options as any) as StoreApi<TState>;
	// }

	// return storeBuilder() as StoreApi<TState>;
};

export function createStoreContext<
	TState extends State,
	TExtensions extends object,
>(store: StoreBuilderApi<TState, TExtensions>) {
	const Context = React.createContext<StoreApi<TState, TExtensions> | null>(
		null
	);

	const Provider = ({
		children,
		initialValue: localInitialValue = {},
	}: {
		initialValue?: Partial<TState>;
		children: React.ReactNode;
	}) => {
		const storeInstance = React.useRef<StoreApi<TState, TExtensions>>(
			store.create(localInitialValue as TState)
		);

		React.useEffect(() => {
			return () => {
				if (
					storeInstance.current &&
					'unsubscribeFromEffects' in storeInstance.current
				) {
					// @ts-expect-error
					storeInstance.current?.unsubscribeFromEffects?.();
				}
			};
		}, []);

		return (
			<Context.Provider value={storeInstance.current as any}>
				{children}
			</Context.Provider>
		);
	};

	const useStore = () => {
		const localStore = React.useContext(Context);

		if (localStore) {
			return localStore;
		}

		throw new Error('useLocalStore must be used within a LocalProvider');
	};

	return {
		Provider,
		useStore,
		Context,
	};
}

export function isObject(value: any): value is Record<string, any> {
	return value instanceof Object && !(value instanceof Array);
}
