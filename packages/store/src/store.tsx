/* eslint-disable no-unused-vars */
import { enableMapSet, setAutoFreeze } from 'immer';
import {
	devtools as devtoolsMiddleware,
	persist as persistMiddleware,
} from 'zustand/middleware';
import { createStore as createVanillaStore } from 'zustand/vanilla';

import { immerMiddleware } from './middlewares/immer.middleware';
import { ImmerStoreApi, SetImmerState, State, StoreApi } from './types';
import { StoreOptions } from './types/CreateStoreOptions';
import { pipe } from './utils/pipe';

import React from 'react';
import type { StateCreator } from 'zustand';
import { createNestedMethods } from './utils/create-methods';
import {
	computed,
	ComputedBuilder,
	ComputedProps,
} from './utils/create-computed-methods';

import { subscribeWithSelector } from 'zustand/middleware';
export const store = <TState extends State>(
	initialState: TState,
	options: StoreOptions<TState> = {}
): StoreApi<TState, {}> => {
	const { middlewares: _middlewares = [], devtools, persist, immer } = options;

	const name =
		options.name ??
		JSON.stringify(
			isObject(initialState) ? Object.keys(initialState) : initialState
		);

	const createInnerStore = (initialState: TState) => {
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
	): StoreApi<TState, TNewExtendedProps> {
		extensions.push(builder);
		Object.assign(globalStore, builder(globalStore));
		return globalStore as unknown as StoreApi<TState, TNewExtendedProps>;
	}

	function createInstance(
		instanceInitialValue?: Partial<TState>,
		options?: StoreOptions<TState>
	) {
		// if is object then merge, otherwise use the localInitialValue and fallback to initialState
		const mergedInitialState = isObject(initialState)
			? {
					...initialState,
					...(instanceInitialValue as object),
				}
			: ((instanceInitialValue ?? initialState) as TState);

		const innerStore = createInnerStore(mergedInitialState as any);

		const methods = createNestedMethods({
			immerStore: innerStore,
			storeName: name,
		});

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
			computed: innerComputed,
		});

		function innerComputed<TComputedProps extends ComputedProps>(
			computedCallback: ComputedBuilder<TState, TComputedProps>
		): StoreApi<TState, TComputedProps> {
			// @ts-expect-error
			const computedMethods = computed(methods, computedCallback);

			// @ts-expect-error
			return extend((store) => computedMethods);
		}

		return methods as StoreApi<TState>;
	}

	const globalStore = createInstance(initialState);

	return globalStore as unknown as StoreApi<TState, {}>;
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
		// probably want a use ref in here
		const storeInstance = store._.createInstance(localInitialValue as TState);

		return (
			<Context.Provider value={storeInstance as any}>
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
