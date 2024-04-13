/* eslint-disable no-unused-vars */
import { enableMapSet, setAutoFreeze } from 'immer';
import {
	devtools as devtoolsMiddleware,
	persist as persistMiddleware,
} from 'zustand/middleware';
import { createStore as createVanillaStore } from 'zustand/vanilla';

import { immerMiddleware } from './middlewares/immer.middleware';
import {
	EffectBuilder,
	ImmerStoreApi,
	SetImmerState,
	State,
	StoreApi,
} from './types';
import { StoreOptions } from './types/CreateStoreOptions';
import { pipe } from './utils/pipe';

import React from 'react';
import type { StateCreator } from 'zustand';
import {
	computed,
	ComputedBuilder,
	ComputedProps,
} from './utils/create-computed-methods';

import { subscribeWithSelector } from 'zustand/middleware';
import { createMethodsProxy } from './utils/create-methods-proxy';

export type StoreBuilderApi<TState extends State> = StoreApi<TState, {}> & {
	options: (options: StoreOptions<TState>) => StoreBuilderApi<TState>;
	state: <TNewState>(initialValue: TNewState) => StoreApi<TNewState, {}>;
};

export const storeBuilder = <TState extends State>() => {
	let initialState: TState;
	let options: StoreOptions<TState> = {};

	const getName = () => {
		if (options.name) return options.name;

		const defaultName = `(davstack/store)initialValue=${
			initialState ? JSON.stringify(initialState) : 'no-state'
		}`;
		Object.assign(options, { name: defaultName });
		return defaultName;
	};

	function optionFn(newOpts: any) {
		options = newOpts;
		return { state };
	}

	function state<TNewState extends State>(initialValue: TNewState) {
		initialState = initialValue as any;

		const storeInstance = createInstance(initialState);
		globalStore = storeInstance;
		return globalStore;
	}

	let globalStore = {
		options: optionFn,
		state,
	} as unknown as StoreApi<TState, {}>;

	/** creates the internal store with middlwares */
	const createInnerStore = (initialState: TState) => {
		const {
			middlewares: _middlewares = [],
			devtools,
			persist,
			immer,
		} = options;
		const name = getName();
		const pipeMiddlewares = (
			// @ts-expect-error
			createState: StateCreator<TState, SetImmerState<TState>>
		) => pipe(createState as any, ...middlewares) as ImmerStoreApi<TState>;

		setAutoFreeze(immer?.enabledAutoFreeze ?? false);
		if (immer?.enableMapSet) {
			enableMapSet();
		}

		const middlewares: any[] = [immerMiddleware, ..._middlewares];

		if (persist?.enabled) {
			const opts = {
				...persist,
				name: persist.name ?? name,
			};

			middlewares.push((config: any) => persistMiddleware(config, opts));
		}

		if (devtools?.enabled) {
			middlewares.push((config: any) =>
				devtoolsMiddleware(config, { ...devtools, name })
			);
		}

		middlewares.push(subscribeWithSelector);
		middlewares.push(createVanillaStore);

		const immerStoreApi = pipeMiddlewares(() => initialState);

		return immerStoreApi;
	};

	/**
	 * Store the applied extensions to be applied later
	 * This allows us to ensure that the local store has the same extensions as the global store
	 */
	let extensions: Array<(store: StoreApi<TState, {}>) => Record<string, any>> =
		[];

	const applyExtensions = (store: StoreApi<TState, {}>) => {
		if (!extensions.length) return store;
		return extensions.reduce((acc, ext) => {
			// should avoid using spread operator here as it reduce + spread harms performance
			return Object.assign(acc, ext(acc));
		}, store);
	};

	function extend<TNewExtendedProps extends Record<string, any>>(
		builder: (store: StoreApi<TState, {}>) => TNewExtendedProps
		//@ts-expect-error
	): StoreApi<TState, TNewExtendedProps> {
		extensions.push(builder);
		if (globalStore) {
			Object.assign(globalStore, builder(globalStore));
			return globalStore as unknown as StoreApi<TState, TNewExtendedProps>;
		}
	}

	function effects<TBuilder extends EffectBuilder<TState, {}>>(
		builder: TBuilder
	): StoreApi<TState, {}> {
		// @ts-expect-error
		return globalStore.extend((store) => {
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
	}

	function createInstance(instanceInitialValue?: Partial<TState>) {
		const name = getName();

		// if is object then merge, otherwise use the localInitialValue and fallback to initialState
		const mergedInitialState = isObject(initialState)
			? {
					...initialState,
					...(instanceInitialValue as object),
				}
			: ((instanceInitialValue ?? initialState) as TState);

		const innerStore = createInnerStore(mergedInitialState as any);

		const methods = createMethodsProxy({
			immerStore: innerStore,
			storeName: name,
		});

		function innerComputed<TComputedProps extends ComputedProps>(
			computedCallback: ComputedBuilder<TState, TComputedProps>
		): StoreApi<TState, TComputedProps> {
			// @ts-expect-error
			return extend((store) => computed(store, computedCallback));
		}

		applyExtensions(methods as any);

		const internals = {
			name,
			extensions,
			applyExtensions,
			createInnerStore,
			createInstance,
			innerStore,
		};

		Object.assign(methods, {
			_: internals,
			extend,
			actions: extend,
			computed: innerComputed,
			effects,
			state,
		});

		return methods as unknown as StoreApi<TState>;
	}

	return globalStore as unknown as StoreBuilderApi<TState>;
};

export const store = <TState extends State>(
	initialState?: TState,
	options?: StoreOptions<TState>
): StoreBuilderApi<TState> => {
	if (initialState !== undefined && options !== undefined)
		return storeBuilder()
			.options(options as any)
			.state(initialState) as StoreBuilderApi<TState>;

	if (initialState !== undefined) {
		return storeBuilder().state(initialState) as StoreBuilderApi<TState>;
	}

	if (options !== undefined) {
		return storeBuilder().options(options as any) as StoreBuilderApi<TState>;
	}

	return storeBuilder() as StoreBuilderApi<TState>;
};

export function createStoreContext<
	TState extends State,
	TExtensions extends object,
>(store: StoreApi<TState, TExtensions>) {
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
			store._.createInstance(localInitialValue as TState)
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
