import { enableMapSet, setAutoFreeze } from 'immer';
import { createTrackedSelector } from 'react-tracked';
import {
	devtools as devtoolsMiddleware,
	persist as persistMiddleware,
} from 'zustand/middleware';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { createStore as createVanillaStore } from 'zustand/vanilla';

import { immerMiddleware } from './middlewares/immer.middleware';
import {
	DynamicStateMethods,
	ImmerStoreApi,
	MergeState,
	SetImmerState,
	State,
	StoreApi,
	UseImmerStore,
} from './types';
import { CreateStoreOptions } from './types/CreateStoreOptions';
import { generateStateActions } from './utils/generateStateActions';
import { generateStateGetSelectors } from './utils/generateStateGetSelectors';
import { generateStateHookSelectors } from './utils/generateStateHookSelectors';
import { generateStateTrackedHooksSelectors } from './utils/generateStateTrackedHooksSelectors';
import { pipe } from './utils/pipe';

import React from 'react';
import type { StateCreator } from 'zustand';
export const createStore = <TState extends State, TName extends string>(
	initialState: TState,
	options: CreateStoreOptions<TState, TName> = {}
): StoreApi<TName, TState, {}> => {
	const { middlewares: _middlewares = [], devtools, persist, immer } = options;

	setAutoFreeze(immer?.enabledAutoFreeze ?? false);
	if (immer?.enableMapSet) {
		enableMapSet();
	}

	const name = options.name ?? JSON.stringify(Object.keys(initialState));

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

	let extensions: Array<
		(store: StoreApi<TName, TState, {}>) => Record<string, any>
	> = [];

	const pipeMiddlewares = (
		// @ts-expect-error
		createState: StateCreator<TState, SetImmerState<TState>>
	) => pipe(createState as any, ...middlewares) as ImmerStoreApi<TState>;

	const createInnerStore = (initialState: TState) => {
		const immerStoreApi = pipeMiddlewares(() => initialState);
		const useStore = ((selector, equalityFn) =>
			useStoreWithEqualityFn(
				immerStoreApi as any,
				selector as any,
				equalityFn as any
			)) as UseImmerStore<TState>;

		const setState: SetImmerState<TState> = (fn, actionName) => {
			immerStoreApi.setState(fn, actionName || `@@${name}/setState`);
		};

		const stateActions = generateStateActions(immerStoreApi, name);
		const hookSelectors = generateStateHookSelectors(useStore, immerStoreApi);
		const getterSelectors = generateStateGetSelectors(immerStoreApi);
		const useTrackedStore = createTrackedSelector(useStore);
		const trackedHooksSelectors = generateStateTrackedHooksSelectors(
			useTrackedStore,
			immerStoreApi
		);

		const innerSelectors = Object.fromEntries(
			Object.entries(initialState).map(([key, value]) => {
				return [
					key,
					{
						get: () => getterSelectors[key](),
						// @ts-expect-error TODO: fix this
						set: (...args: any[]) => stateActions[key](...args),
						use: (...args: any[]) => hookSelectors[key](...args),
						useTracked: (...args: any[]) => trackedHooksSelectors[key](...args),
					},
				];
			})
		) as DynamicStateMethods<TState>;

		const assign: MergeState<TState> = (state, actionName) => {
			immerStoreApi.setState(
				(draft) => {
					Object.assign(draft as any, state);
				},
				actionName || `@@${name}/assign`
			);
		};

		const baseStore = {
			...innerSelectors,
			immerStoreApi,
			storeName: name,
			set: setState,
			get: immerStoreApi.getState,
			use: useStore,
			useTracked: useTrackedStore,
			assign,
		};

		const extendedStore = extensions.reduce((acc, ext) => {
			return {
				...acc,
				// @ts-expect-error
				...ext(acc),
			};
		}, baseStore);

		return extendedStore;
	};

	const globalStore = createInnerStore(initialState);

	const LocalContext = React.createContext<StoreApi<TName, TState, {}> | null>(
		null
	);

	const LocalProvider = ({
		children,
		initialValue: localInitialValue = {},
	}: {
		initialValue?: Partial<TState>;
		children: React.ReactNode;
	}) => {
		const localStore = createInnerStore({
			...initialState,
			...localInitialValue,
		});

		return (
			// @ts-expect-error
			<LocalContext.Provider value={localStore}>
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

	const api = {
		...globalStore,
		extend: <TNewExtendedProps extends Record<string, any>>(
			builder: (store: StoreApi<TName, TState, {}>) => TNewExtendedProps
		): StoreApi<TName, TState, TNewExtendedProps> => {
			extensions.push(builder);
			const extendedStore = createInnerStore(initialState);
			// @ts-expect-error
			return {
				...extendedStore,
				extend: api.extend,
				LocalProvider,
				useLocalStore,
			};
			// const extendedStore = extensions.reduce((acc, ext) => {
			// 	return {
			// 		...acc,
			// 		// @ts-expect-error
			// 		...ext(acc),
			// 	};
			// }, globalStore);
			// // @ts-expect-error
			// return {
			// 	...extendedStore,
			// 	extend: api.extend,
			// 	LocalProvider,
			// 	useLocalStore,
			// };
		},
		LocalProvider,
		useLocalStore,
	};
	return api as unknown as StoreApi<TName, TState, {}>;
};
