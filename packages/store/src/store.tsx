/* eslint-disable no-unused-vars */
import { enableMapSet, setAutoFreeze } from 'immer';
import {
	devtools as devtoolsMiddleware,
	persist as persistMiddleware,
} from 'zustand/middleware';
import { createStore as createVanillaStore } from 'zustand/vanilla';

import { immerMiddleware } from './middlewares/immer.middleware';
import { ImmerStoreApi, SetImmerState, State, StoreApi } from './types';
import { storeOptions } from './types/CreateStoreOptions';
import { pipe } from './utils/pipe';

import React from 'react';
import type { StateCreator } from 'zustand';
import { createNestedMethods } from './utils/create-methods';
export const store = <TState extends State, TName extends string>(
	initialState: TState,
	options: storeOptions<TState, TName> = {}
): StoreApi<TName, TState, {}> => {
	const { middlewares: _middlewares = [], devtools, persist, immer } = options;

	const name =
		options.name ??
		JSON.stringify(
			isObject(initialState) ? Object.keys(initialState) : initialState
		);

	// function

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

	middlewares.push(createVanillaStore);

	/**
	 * Store the applied extensions to be applied later
	 * This allows us to ensure that the local store has the same extensions as the global store
	 */
	let extensions: Array<
		(store: StoreApi<TName, TState, {}>) => Record<string, any>
	> = [];

	const pipeMiddlewares = (
		// @ts-expect-error
		createState: StateCreator<TState, SetImmerState<TState>>
	) => pipe(createState as any, ...middlewares) as ImmerStoreApi<TState>;

	/**
	 * By extracting this logic we are able to recreate the store again in the LocalProvider
	 * Otherwise the localStore setters would actually set the global store
	 */
	const createInnerStore = (initialState: TState) => {
		const immerStoreApi = pipeMiddlewares(() => initialState);

		const innerMethods = createNestedMethods({
			immerStore: immerStoreApi,
			storeName: name,
		});

		return {
			storeName: name,
			immerStoreApi,
			// ...globalMethods,
			...innerMethods,
		};
	};

	const applyExtensions = (store: StoreApi<TName, TState, {}>) => {
		return extensions.reduce((acc, ext) => {
			// should avoid using spread operator here as it reduce + spread harms performance
			return Object.assign(acc, ext(acc));
		}, store);
	};
	const globalStore = createInnerStore(initialState);

	function createInstance<TState extends State, TName extends string>(
		instanceInitialValue?: Partial<TState>,
		options?: storeOptions<TState, TName>
	) {
		// if is object then merge, otherwise use the localInitialValue and fallback to initialState
		const mergedInitialState = isObject(initialState)
			? {
					...initialState,
					...(instanceInitialValue as object),
				}
			: ((instanceInitialValue ?? initialState) as TState);

		const storeInstance = createInnerStore(mergedInitialState as any);

		applyExtensions(storeInstance as any);

		return storeInstance as any;
	}

	const api = {
		...globalStore,
		createInstance,
		extend: <TNewExtendedProps extends Record<string, any>>(
			builder: (store: StoreApi<TName, TState, {}>) => TNewExtendedProps
		): StoreApi<TName, TState, TNewExtendedProps> => {
			extensions.push(builder);
			// Object.assign(globalStore, builder(globalStore));
			// applyExtensions(api as any);
			// const extendedStore = applyExtensions(api as any);
			Object.assign(api, builder(api as any));
			return api as unknown as StoreApi<TName, TState, TNewExtendedProps>;
		},
	};
	return api as unknown as StoreApi<TName, TState, {}>;
};

export function createStoreContext<
	TName extends string,
	TState extends State,
	TExtensions extends object,
>(store: StoreApi<TName, TState, TExtensions>) {
	const LocalContext = React.createContext<StoreApi<
		TName,
		TState,
		TExtensions
	> | null>(null);

	const LocalProvider = ({
		children,
		initialValue: localInitialValue = {},
	}: {
		initialValue?: Partial<TState>;
		children: React.ReactNode;
	}) => {
		const storeInstance = store.createInstance(localInitialValue as TState);

		return (
			<LocalContext.Provider value={storeInstance as any}>
				{children}
			</LocalContext.Provider>
		);
	};

	const useLocalStore = () => {
		const localStore = React.useContext(LocalContext);

		if (localStore) {
			return localStore;
		}

		throw new Error('useLocalStore must be used within a LocalProvider');
	};

	return {
		Provider: LocalProvider,
		useStore: useLocalStore,
	};
}

export function isObject(value: any): value is Record<string, any> {
	return value instanceof Object && !(value instanceof Array);
}
